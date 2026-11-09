import {clauses,resolvedInboxAccess,type Clause} from './inbox-entries'
import {onEntry,walkedSort,type Condition} from './inbox-conditions'
import {families,tagClause,tagFormula,type Families,type FieldCondition} from './inbox-families'
import {exact,sortRows} from './inbox-order'
import {weekPage,type Week} from './inbox-weeks'
import {sortGroup,measureGroups,groupWalk,pageGroups,type SortGroup} from './inbox-sort-groups'
import {blockParts,blockMerge} from './inbox-merge'
import type {TicketSort} from '../tickets/sort'
import {type Read,type Measured,measure,slotted,slotOf,countRead,fieldReads,indexColumns,generalSize,timeReads,tagReads,pins,facetPins,pinnedBy,type Pin,pinRead,facetPinRead,type Size,type Count} from './inbox-shape-counts'

type Flag=(x:string)=>Clause
type Part={sql:string;params:unknown[]}
/** What inbox-list.ts resolved for one request. */
export interface Shape {
 db:D1Database;userId:string;project?:string;page:number;offset:number
 // The role's workspaces and scope, and the workspaces alone (what an index walk reads).
 access:(x:string)=>Clause[];workspace:(x:string)=>Clause[];flags:Flag[];members?:string[];conditions:Condition[];tag?:string;cursor?:[number,string]
 sortItems:TicketSort[];sort:{sql:string;params:unknown[];parts:{sql:string;direction:'asc'|'desc';params:unknown[]}[]}
 // The entry index the page walks in the inbox order (what the request pins).
 pinned:string
 // A sort led by a ticket column whose values its counts keep: each count is also read by that column (inbox-sort-groups.ts).
 group?:SortGroup
}

// The entry columns a facet row carries (migration 319); a condition or sort naming only these reads facet rows alone.
const facetColumns=new Set(['conversation_id','project_id','group_id','assigned_to','status_category','priority','channel','status_id','created_at','updated_at','sort_at','unresolved','ai','snoozed','tags_key'])
const onFacets=(sql:string)=>[...sql.matchAll(/\bc\.([a-z_]+)\b/g)].every(match=>facetColumns.has(match[1]==='id'?'conversation_id':match[1]))
// A custom sort led by one of these walks a facet's own index (migration 319).
const facetSorts=new Set(['updated_at','created_at','priority'])
const PAGES=10

/** The unsearched list's totals and pages for the shapes migration 319 bounds (src/modules/management/README.md,
 * "Inbox reads at scale"): a subject term, tags, a custom field or a time bound, each with any conditions the tallies'
 * dimensions answer, on pages 1 to 10. Returns undefined for every other request, which keeps 313's reads. */
export async function shapedList(s:Shape):Promise<{total:number;ids:string[]}|undefined>{
 const f=families(s.conditions,s.tag)
 if(f.other.length||s.page>PAGES||!(f.tags.length||f.fields.length||f.times.length||f.subjects.length))return undefined
 // The role scope is read once and bound in each of the request's statements.
 const resolved=await resolvedInboxAccess(s.db,s.userId,{project:s.project,deleted:true})
 s={...s,access:resolved.access,workspace:resolved.workspace,members:resolved.members}
 if(f.subjects.length)return subjectList(s,f)
 if(f.fields.length>1||f.times.length>1)return candidateList(s,f)
 const named=[f.tags.length>0,f.fields.length>0,f.times.length>0].filter(Boolean).length
 return named===1?talliedList(s,f):candidateList(s,f)
}

// Every condition of the request over a row (alias x): workspace, role scope, flags, tallied columns and families.
// A field's own facet rows hold exactly its matching values, so reading them skips that condition's value lookup.
const where=(s:Shape,f:Families,x:string,held?:FieldCondition):Clause[]=>[
 ...s.access(x),...s.flags.map(flag=>flag(x)),
 ...[...f.tallied,...f.fields.filter(field=>field!==held).map(field=>field.condition),...f.times.map(bound=>bound.condition),...f.subjects].map(condition=>({sql:onEntry(condition.sql,x),params:condition.params})),
 ...f.tags.map(set=>tagClause(x,set)),
]
const after=(s:Shape,x:string):Clause[]=>s.cursor?[{sql:`(${x}.sort_at,${x}.conversation_id)<(?,?)`,params:s.cursor}]:[]
const order=(s:Shape,x:string):Part=>s.sortItems.length?{sql:onEntry(s.sort.sql,x),params:s.sort.params}:{sql:`${x}.sort_at DESC,${x}.conversation_id DESC`,params:[]}
const evaluable=(s:Shape,f:Families)=>[...f.tallied,...f.fields.map(field=>field.condition),...f.times.map(bound=>bound.condition)].every(condition=>onFacets(condition.sql))&&s.sort.parts.every(part=>onFacets(part.sql))

// The page's sort keys over a row (k0..kn, the last the conversation id) and their directions.
function sortKeys(s:Shape,x:string){
 const keys=s.sortItems.length?s.sort.parts.map(part=>({sql:onEntry(part.sql,x),params:part.params,direction:part.direction})):[{sql:`${x}.sort_at`,params:[],direction:'desc' as const}]
 const all=[...keys,{sql:`${x}.conversation_id`,params:[],direction:'desc' as const}]
 return {sql:all.map((key,i)=>`${key.sql} k${i}`).join(','),params:all.flatMap(key=>key.params),directions:all.map(key=>key.direction)}
}
// The page of rows read with their sort keys, ordered as ORDER BY would order them (by SQL when a key's value is
// beyond what a number holds exactly).
async function ordered(s:Shape,rows:Record<string,unknown>[],x:string,directions:('asc'|'desc')[]){
 if(rows.length<=s.offset)return []
 if(rows.every(row=>Object.values(row).every(exact)))return sortRows(rows,directions).slice(s.offset,s.offset+30).map(row=>String(row.id))
 const sorted=order(s,x)
 return (await s.db.prepare(`SELECT ${x}.conversation_id id FROM inbox_entries ${x} WHERE ${x}.conversation_id IN (SELECT value FROM json_each(?)) ORDER BY ${sorted.sql} LIMIT 30 OFFSET ?`).bind(JSON.stringify(rows.map(row=>row.id)),...sorted.params,s.offset).all<{id:string}>()).results.map(row=>String(row.id))
}
/** Reads every candidate a source holds (one row each), with the page's sort keys, and orders them as ORDER BY
 * would; the total is how many match. */
async function readAll(s:Shape,source:string,x:string,list:Clause[]){
 const keys=sortKeys(s,x),filter=clauses(list)
 const rows=(await s.db.prepare(`SELECT ${x}.conversation_id id,${keys.sql} FROM ${source} WHERE ${filter.sql}`).bind(...keys.params,...filter.params).all<Record<string,unknown>>()).results
 return {total:rows.length,ids:await ordered(s,rows,x,keys.directions)}
}

// The workspaces the list reads: the requested one, or every workspace of the member's that is not deleted.
const workspaces=async(s:Shape)=>s.members!
/** A subject term reads the trigram index's matches in the request's workspaces (one row each); every entry column
 * is read from the index's own rows, so the other conditions and the sort keys add no rows. */
async function subjectList(s:Shape,f:Families){
 const listed=await workspaces(s)
 if(!listed.length)return {total:0,ids:[]}
 const term=[...f.subjects].sort((x,y)=>[...String(y.params[0])].length-[...String(x.params[0])].length)[0].params[0]
 const phrases=listed.map(id=>`workspace:"|${id.replaceAll('"','""')}|"`).join(' OR ')
 const match={sql:`inbox_subject_search MATCH 'subject_text:"'||replace(lower(?),'"','""')||'" AND ('||?||')'`,params:[term,phrases]}
 return readAll(s,'inbox_subject_search s','s',[match,...where(s,f,'s'),...after(s,'s')])
}

// A facet's rows: their keys and size, their family key, whether they hold a number field's values as compared (the
// inbox order only), and whether they are a field set's value-less rows that may hold two ranges (see below).
interface Facet {keys:Clause[];size:Size;count?:Count;real?:boolean;blank?:boolean}
type Page={total:number;ids:string[]}
/** One family with tallied conditions: an exact total from counts, then the page from the cheapest of walking a
 * facet in the page's order, merging several facets' first matches, walking the inbox order (or the sort's own index,
 * or a pinned one), walking a time bound a week at a time, or reading a candidate set whole in any order: a facet,
 * every part of an any-of condition, or the rows (of a facet, of every part, or of every entry) holding one pinned
 * status category, assignee or group. */
async function talliedList(s:Shape,f:Families){
 // A time bound's counts span many keys, so they are read by group only for a sort by status.
 const grouping=f.times.length&&s.sortItems[0]?.field==='priority'?undefined:sortGroup(s,column=>slotOf(s,f,[column]).slot)
 if(grouping)s={...s,group:grouping}
 const reads:Read[]=[generalSize(s)]
 // Every pinned condition sizes its candidate sets. A group's own indexes serve custom sorts too (migration 319); the
 // other pinned indexes hold the inbox order only, so they walk only that; a list of values is read whole.
 const pinAll:Pin[]=f.tallied.map(condition=>({condition,pin:pinnedBy(condition)})).filter(({pin})=>pin).map(({condition,pin},i)=>({condition,field:pin!.field,list:pin!.list,name:'pin'+i}))
 pinAll.forEach(pin=>reads.push(pinRead(s,pin.name,pin.condition)))
 const pinned=pinAll.filter(pin=>!pin.list&&(!s.sortItems.length||pin.field==='group_id'))
 let timeSize:Size|undefined,held:FieldCondition|undefined,total:(r:Measured)=>number
 // Facets a page may walk in its order, parts of an any-of condition, and candidate sets it may read whole.
 let facets:Facet[]=[],union:(Facet&{matched:(r:Measured)=>number})[]=[],readable:(Facet&{source:string;group?:string;x:string})[]=[]
 const tagKeys=(tag:string)=>[{sql:"f.kind='t' AND f.ref=? AND f.value IS NULL",params:[tag]}]
 const tagCount=(tag:string):Count=>({family:'s',keys:[{sql:"t.k1=json_array(?) AND t.k2=''",params:[tag]}]})
 if(f.tags.length){
  const tags=tagReads(s,f)
  if(!tags)return undefined
  reads.push(...tags.reads);total=tags.total
  facets=tags.held.map(held=>({keys:tagKeys(held.tag),size:held.size,count:tagCount(held.tag)}))
  union=(tags.any??[]).map(part=>({keys:tagKeys(part.tag),size:part.size,count:tagCount(part.tag),matched:(r:Measured)=>r[part.name].m}))
  readable=tags.held.map(held=>({source:'inbox_facets f INDEXED BY inbox_facets_order',group:'inbox_facets_group_order',x:'f',keys:tagKeys(held.tag),size:held.size,count:tagCount(held.tag)}))
 }else if(f.fields.length){
  const field=f.fields[0],values=fieldReads(s,f,field)
  reads.push(...values.reads);total=values.total
  if(values.facet){
   held=field
   // A field set reads its value-less rows ('n': value NULL unless the value is the empty string); set and not
   // empty reads those whose value is NULL.
   const set=field.mode==='nonnull'||field.mode==='nonempty'
   const size:Size=(r,key)=>(set?r.valued:r.named)[key]
   const keys=set?[{sql:"f.kind='n' AND f.ref=?",params:[field.field]},...(field.mode==='nonempty'?[{sql:'f.value IS NULL',params:[]}]:[])]:[{sql:"f.kind='f' AND f.ref=?",params:[field.field]},...values.facet]
   const count:Count|undefined=set?{family:'n',keys:[{sql:"t.k1=? AND t.k2=''",params:[field.field]}]}:field.mode==='eq'?{family:'v',keys:[{sql:'t.k1=? AND t.k2=?',params:[field.field,field.value]}]}:undefined
   if(field.mode==='in')union=(JSON.parse(String(field.value)) as unknown[]).filter((value,i,all)=>all.indexOf(value)===i).map(value=>{const listed=typeof value==='boolean'?Number(value):value;return {keys:[{sql:"f.kind='f' AND f.ref=? AND f.value=?",params:[field.field,listed]}],size,count:{family:'v',keys:[{sql:'t.k1=? AND t.k2=?',params:[field.field,listed]}]},matched:(r:Measured)=>total(r)}})
   // A field set (not of empty values) holds one range of value-less rows only when no value is the empty string.
   const blank=field.mode==='nonnull'
   if(blank)reads.push(countRead(s,f,'blank','v',[{sql:"t.k1=? AND t.k2=''",params:[field.field]}],'w'))
   if(field.mode!=='in')facets=[{keys,size,real:values.real,count,blank}]
   readable=[{source:`inbox_facets f INDEXED BY ${values.real?'inbox_facets_real':'inbox_facets_order'}`,group:field.mode==='eq'||set?'inbox_facets_group_order':undefined,x:'f',keys,size,count:values.real?undefined:count,blank}]
  }
 }else{
  const time=timeReads(s,f,f.times[0])
  if(!time)return undefined
  reads.push(...time.reads);total=time.total;timeSize=time.size
  const bound=f.times[0],cast=`CAST(e.${bound.column} AS REAL)`
  readable=[{source:`inbox_entries e INDEXED BY inbox_entries_by_${bound.column}_asc`,x:'e',keys:[{sql:`${cast} ${{lt:'<',lte:'<=',gt:'>',gte:'>='}[bound.operator]} ?`,params:[bound.at]}],size:time.size}]
 }
 if(!evaluable(s,f)){facets=[];union=[];readable=readable.filter(source=>source.x==='e')}
 // Each facet's (and any-of part's) rows holding each pinned value: the candidates of reading that facet pinned.
 const counted=[...new Set([...facets,...union,...readable].filter(facet=>facet.count&&!facet.real).map(facet=>JSON.stringify(facet.count)))]
 const facetPin=(facet:Facet,pin:Pin)=>`${pin.name}f${counted.indexOf(JSON.stringify(facet.count))}`
 const pinnable=(facet:Facet,pin:Pin)=>Boolean(facet.count)&&!facet.real&&Object.hasOwn(facetPins,pin.field)
 for(const key of counted)for(const pin of pinAll)if(Object.hasOwn(facetPins,pin.field))reads.push(facetPinRead(s,`${pin.name}f${counted.indexOf(key)}`,JSON.parse(key),pin.condition))
 // A view's flags (resolved or not, AI or not, snoozed or not) all pinned: each facet's rows holding them, which the
 // flags' facet index walks in the inbox order.
 const viewFlags=(x:string)=>s.flags.map(flag=>flag(x)).filter(flag=>new RegExp(`^${x}\\.(unresolved|ai|snoozed)=[01]$`).test(flag.sql))
 const flagged=!s.sortItems.length&&new Set(viewFlags('t').map(flag=>flag.sql.split('=')[0])).size===3
 const facetFlags=(facet:Facet)=>`flags${counted.indexOf(JSON.stringify(facet.count))}`
 if(flagged)for(const key of counted){const all=clauses([...s.workspace('t'),{sql:"t.family=? AND t.slot=''",params:[JSON.parse(key).family]},...JSON.parse(key).keys,...slotted.map(column=>({sql:`t.${column} IS NULL`,params:[]})),...viewFlags('t')]);reads.push({name:`flags${counted.indexOf(key)}`,sql:`SELECT 0 m,0 a,(SELECT COALESCE(SUM(t.total),0) FROM inbox_counts t WHERE ${all.sql}) w`,params:all.params})}
 const r=await measure(s,reads)
 const groups=grouping&&await measureGroups(s,grouping,reads,r,total)
 let matched=total(r)
 // A field set with no empty-string value in the workspaces is one range of value-less rows (value NULL), which its
 // pages walk and read pinned; otherwise its rows are read whole only.
 const oneRange=!reads.some(read=>read.name==='blank')||r.blank.w===0
 const ranged=<T extends Facet>(list:T[])=>list.filter(facet=>!facet.blank||oneRange).map(facet=>facet.blank?{...facet,keys:[...facet.keys,{sql:'f.value IS NULL',params:[]}],blank:false}:facet)
 facets=ranged(facets)
 readable=[...ranged(readable),...readable.filter(source=>source.blank&&!oneRange)]
 // A role that sees one group alone walks that group's own indexes, reading only rows it may see.
 const group=r.general.g??undefined,single=(key:'a'|'w')=>group===undefined?'w':key
 // A walk of entries or of another facet looks a custom field's value up for each row it reads.
 // A walk reads its range in order until the page's last match: by the matches' share of the range, or (where they may
 // cluster at its end) every row of it that does not match first.
 const reach=s.offset+30,looked=f.fields.length?2:1,per=(rows:number)=>reach*rows/Math.max(1,matched),worst=(rows:number,matches:number)=>Math.min(rows,Math.max(0,rows-matches)+reach)
 // Each option's cost is the rows it reads: exactly, for a candidate set read whole; by the matches' share of the rows
 // it walks, for a walk.
 const options:{cost:number;run:()=>Promise<Page>}[]=[]
 const lead=s.sortItems[0]?.field
 /** A page walked in an index's order over its range (an entry walk's range is within the request's workspaces). */
 const walk=(source:string,x:string,range:Clause[],own?:FieldCondition,skip=s.offset)=>async():Promise<Page>=>{
  const scope=x==='e'?[...s.workspace(x),...range]:range,sorted=order(s,x)
  const listed=clauses([...scope,...where(s,f,x,own)])
  // A cursor's total is the tally less the matches before it.
  if(s.cursor)matched-=Number((await s.db.prepare(`SELECT count(*) n FROM ${source} WHERE ${listed.sql} AND (${x}.sort_at,${x}.conversation_id)>=(?,?)`).bind(...listed.params,...s.cursor).first<{n:number}>())!.n)
  if(matched<=s.offset)return {total:matched,ids:[]}
  const page=clauses([...scope,...where(s,f,x,own),...after(s,x)])
  const ids=(await s.db.prepare(`SELECT ${x}.conversation_id id FROM ${source} WHERE ${page.sql} ORDER BY ${sorted.sql} LIMIT 30 OFFSET ?`).bind(...page.params,...sorted.params,skip).all<{id:string}>()).results.map(row=>String(row.id))
  return {total:matched,ids}
 }
 // The leading columns of 313's inbox-order indexes after the workspace: what a walk of one holds pinned.
 const leading:Record<string,string[]>={inbox_entries_flags:['ai','snoozed'],inbox_entries_assignee:['assigned_to'],inbox_entries_status:['status_category'],inbox_entries_priority:['priority'],inbox_entries_channel:['channel'],inbox_entries_status_id_order:['status_id']}
 const leads=(index:string,x:string)=>[...s.flags.map(flag=>flag(x)),...pinned.map(pin=>({sql:onEntry(pin.condition.sql,x),params:pin.condition.params}))].filter(clause=>(leading[index]??[]).some(column=>new RegExp(`^${x}\\.${column}(=| IS )`).test(clause.sql)))
 const inGroup=(x:string)=>({sql:`${x}.group_id=?`,params:[group]})
 const onPin=(pin:Pin,x:string)=>({sql:onEntry(pin.condition.sql,x),params:pin.condition.params})
 // A group's index in the page's order (the inbox order, or a custom sort led by updated_at, created_at or priority).
 const groupOrder=(table:'entries'|'facets')=>!s.sortItems.length?`inbox_${table}_group_order`:facetSorts.has(lead)?`inbox_${table}_group_by_${lead}_${s.sortItems[0].direction}`:undefined
 // A status category's index in a custom sort led by updated_at, created_at or priority (migration 319).
 const statusOrder=(table:'entries'|'facets')=>`inbox_${table}_status_by_${lead}_${s.sortItems[0]?.direction}`
 const statusPins=s.sortItems.length&&facetSorts.has(lead)?pinAll.filter(pin=>pin.field==='status_category'&&!pin.list):[]
 for(const facet of facets){
  const grouped=groupOrder('facets')
  if(grouped&&group!==undefined&&!facet.real)options.push({cost:per(facet.size(r,'a')),run:walk(`inbox_facets f INDEXED BY ${grouped}`,'f',[...facet.keys,inGroup('f')],held)})
  const index=!s.sortItems.length?(facet.real?'inbox_facets_real':'inbox_facets_order'):!facet.real&&facetSorts.has(lead)?`inbox_facets_by_${lead}_${s.sortItems[0].direction}`:undefined
  if(index)options.push({cost:per(facet.size(r,'w')),run:walk(`inbox_facets f INDEXED BY ${index}`,'f',facet.keys,held)})
  // The facet's rows of one pinned value, walked in the inbox order (or a group's in its sort).
  for(const pin of pinned)if(pinnable(facet,pin)){
   const pinIndex=pin.field==='group_id'?groupOrder('facets'):s.sortItems.length?undefined:facetPins[pin.field]
   if(pinIndex)options.push({cost:per(r[facetPin(facet,pin)].w),run:walk(`inbox_facets f INDEXED BY ${pinIndex}`,'f',[...facet.keys,onPin(pin,'f')],held)})
  }
  // The facet's rows of one status category in the page's sort, or of the view's flags in the inbox order.
  for(const pin of statusPins)if(pinnable(facet,pin))options.push({cost:per(r[facetPin(facet,pin)].w),run:walk(`inbox_facets f INDEXED BY ${statusOrder('facets')}`,'f',[...facet.keys,onPin(pin,'f')],held)})
  if(flagged&&facet.count&&!facet.real)options.push({cost:per(r[facetFlags(facet)].w),run:walk('inbox_facets f INDEXED BY inbox_facets_flags_order','f',[...facet.keys,...viewFlags('f')],held)})
 }
 // Any of several tags (or field values): each part's facet holds a part of the matches. The first matches of each in
 // the page's order, merged, hold the page; or every part's rows (of one pinned value) are read whole.
 const facetSort=!s.sortItems.length?'inbox_facets_order':facetSorts.has(lead)?`inbox_facets_by_${lead}_${s.sortItems[0].direction}`:undefined
 // Every part's rows read whole, or each part's first matches in the page's order (merged, they hold the page).
 const parts=(list:{index:string;keys:Clause[]}[],first=false)=>async():Promise<Page>=>{
  const sel=sortKeys(s,'f'),sorted=order(s,'f')
  const results=await s.db.batch(list.map(part=>{const filter=clauses([...part.keys,...where(s,f,'f',held),...after(s,'f')]);return s.db.prepare(`SELECT f.conversation_id id,${sel.sql} FROM inbox_facets f INDEXED BY ${part.index} WHERE ${filter.sql}${first?` ORDER BY ${sorted.sql} LIMIT ?`:''}`).bind(...sel.params,...filter.params,...(first?[...sorted.params,reach]:[]))}))
  const seen=new Set<string>(),rows=results.flatMap(part=>part.results as Record<string,unknown>[]).filter(row=>!seen.has(String(row.id))&&seen.add(String(row.id)))
  return {total:matched,ids:await ordered(s,rows,'f',sel.directions)}
 }
 if(union.length&&!s.cursor){
  const merged=(index:string,more:Clause[],key:'a'|'w')=>options.push({cost:union.reduce((sum,part)=>sum+reach*part.size(r,key)/Math.max(1,part.matched(r)),0),run:parts(union.map(part=>({index,keys:[...part.keys,...more]})),true)})
  if(facetSort)merged(facetSort,[],'w')
  const grouped=groupOrder('facets')
  if(grouped&&group!==undefined)merged(grouped,[inGroup('f')],'a')
  // Each part's rows of one status category in the page's sort, or of the view's flags in the inbox order.
  const pinnedMerge=(index:string,more:Clause[],size:(part:Facet)=>number)=>options.push({cost:union.reduce((sum,part)=>sum+reach*size(part)/Math.max(1,part.matched(r)),0),run:parts(union.map(part=>({index,keys:[...part.keys,...more]})),true)})
  for(const pin of statusPins)if(union.every(part=>pinnable(part,pin)))pinnedMerge(statusOrder('facets'),[onPin(pin,'f')],part=>r[facetPin(part,pin)].w)
  if(flagged&&union.every(part=>part.count&&!part.real))pinnedMerge('inbox_facets_flags_order',viewFlags('f'),part=>r[facetFlags(part)].w)
  const whole=(index:string,more:Clause[],cost:number)=>options.push({cost,run:parts(union.map(part=>({index,keys:[...part.keys,...more]})))})
  whole('inbox_facets_order',[],union.reduce((sum,part)=>sum+part.size(r,'w'),0))
  for(const pin of pinAll)if(union.every(part=>pinnable(part,pin)))whole(facetPins[pin.field],[onPin(pin,'f')],union.reduce((sum,part)=>sum+r[facetPin(part,pin)].w,0))
 }
 const general=s.sortItems.length?walkedSort(s.sortItems):s.pinned
 // A time bound's matches may lie last in the id order (alone, or within a status or priority, by id descending): ids
 // may follow creation, so a bound before a moment lies at the end of a descending order, one after it at the start.
 const idOrder=lead==='id'?s.sortItems[0].direction:['status_id','status_category','priority'].includes(lead)?'desc':undefined,before=['lt','lte'].includes(f.times[0]?.operator)
 const clustered=f.times.length>0&&idOrder!==undefined&&(idOrder==='desc')===before
 // Where the sort's groups are counted (or the order is the id itself) a walk is costed at its worst; a priority's
 // groups are large and uncounted, so it is costed at four times the matches' share, at most its worst.
 const grouped=lead==='id'||Boolean(grouping)
 const walked=(rows:number)=>!clustered?per(rows):grouped?worst(rows,matched):Math.min(worst(rows,matched),4*per(rows))
 // A sort by status or priority: the walk seeks to the page's first group, costed by the groups it crosses.
 const stepped=groups&&grouping&&groupWalk(groups,grouping,s.offset,'e',clustered)
 if(general&&stepped?.range)options.push({cost:looked*stepped.cost,run:walk(`inbox_entries e INDEXED BY ${general}`,'e',stepped.range,undefined,stepped.offset)})
 if(general&&stepped)options.push({cost:looked*stepped.plain,run:walk(`inbox_entries e INDEXED BY ${general}`,'e',[])})
 else if(general)options.push({cost:looked*walked(s.sortItems.length||s.pinned==='inbox_entries_order'?r.general.w:Object.hasOwn(indexColumns,s.pinned)?r.general.p:r.general.m),run:walk(`inbox_entries e INDEXED BY ${general}`,'e',s.sortItems.length?[]:leads(general,'e'))})
 const groupEntries=groupOrder('entries')
 if(groupEntries&&group!==undefined)options.push({cost:looked*walked(r.general.a),run:walk(`inbox_entries e INDEXED BY ${groupEntries}`,'e',[inGroup('e')])})
 for(const pin of statusPins)options.push({cost:looked*walked(r[pin.name].w),run:walk(`inbox_entries e INDEXED BY ${statusOrder('entries')}`,'e',[onPin(pin,'e')])})
 for(const pin of pinned){
  const index=pin.field==='group_id'?groupEntries:pins[pin.field]
  if(index)options.push({cost:looked*walked(r[pin.name].w),run:walk(`inbox_entries e INDEXED BY ${index}`,'e',[onPin(pin,'e')])})
  // A role that sees one group, on a page of one status category: that group's entries of that category.
  if(pin.field==='status_category'&&pin.condition.sql.endsWith('=?')&&group!==undefined&&!s.sortItems.length)options.push({cost:looked*per(r[pin.name].a),run:walk('inbox_entries e INDEXED BY inbox_entries_group_status_order','e',[inGroup('e'),onPin(pin,'e')])})
 }
 // A time bound walks its order a week at a time (only the entries inside the bound), or the bound's own index when the
 // sort is led by the same time.
 if(f.times.length&&timeSize&&!s.cursor){
  const bound=f.times[0],first=s.sortItems[0],size=timeSize
  const week:Week|undefined=!first?'sort':first.field==='updated_at'&&bound.column==='created_at'?'updated':first.field==='created_at'&&bound.column==='updated_at'?'created':undefined
  const keys=s.sortItems.length?s.sort.parts.map(part=>({sql:onEntry(part.sql,'e'),params:part.params,direction:part.direction})):[{sql:'e.sort_at',params:[],direction:'desc' as const}]
  const byWeek=(pin?:{column:'group_id'|'status_category';value:unknown})=>async()=>({total:matched,ids:await weekPage({db:s.db,projects:await workspaces(s),week:week!,bound:bound.column,direction:first?.direction??'desc',list:where(s,f,'e'),keys,order:order(s,'e'),offset:s.offset,pin})})
  if(week){
   options.push({cost:looked*per(size(r,'w')),run:byWeek()})
   // The group's share of the bound's entries, as its share of the workspaces' entries.
   if(week==='sort'&&group!==undefined)options.push({cost:looked*per(size(r,'w')*r.general.a/Math.max(1,r.general.w)),run:byWeek({column:'group_id',value:group})})
   // A page of one status category reads that category's weeks: about its share of the bound's entries.
   if(!s.sortItems.length)for(const pin of pinned)if(week==='sort'&&['status_category','group_id'].includes(pin.field)&&pin.condition.sql.endsWith('=?'))options.push({cost:looked*per(size(r,'w')*r[pin.name].w/Math.max(1,r.general.w)),run:byWeek({column:pin.field as 'group_id'|'status_category',value:pin.condition.params[0]})})
  }
  // A page sorted by status: the statuses holding it, inside the bound, read whole through their categories' time
  // indexes (about the categories' share of the bound's entries) and ordered.
  const held=groups&&grouping&&grouping.column!=='priority'&&pageGroups(groups,s.offset)
  if(held&&!s.cursor){
   const key=grouping!.key('e'),source=`inbox_entries e INDEXED BY inbox_entries_status_by_${bound.column}_asc`
   const list=[{sql:'e.status_category IN (SELECT value FROM json_each(?))',params:[JSON.stringify(held.categories)]},{sql:`${key.sql} IN (SELECT value FROM json_each(?))`,params:[...key.params,JSON.stringify(held.keys)]},...where(s,f,'e')]
   options.push({cost:looked*held.w*size(r,'w')/Math.max(1,r.general.w),run:async()=>({total:matched,ids:(await readAll({...s,offset:held.offset},source,'e',list)).ids})})
  }
  if(first?.field===bound.column&&general)options.push({cost:looked*per(size(r,'w')),run:walk(`inbox_entries e INDEXED BY ${general}`,'e',[{sql:onEntry(bound.condition.sql,'e'),params:bound.condition.params}])})
 }
 // A page sorted by conversation id merges 30-day blocks walked in id order (inbox-merge.ts): the time bound's blocks,
 // or every creation block; a page of some status categories walks each category's blocks. Its rows are about the
 // blocks' share of the entries (the categories', the bound's) per match: every block's first match, and the page
 // read up to about three times over.
 if(s.sortItems.length===1&&s.sortItems[0].field==='id'&&!s.cursor&&(!f.times.length||timeSize)){
  const bound=f.times[0],status=pinAll.find(pin=>pin.field==='status_category'&&pin.condition.params[0]!==null)
  const categories=status&&(status.list?JSON.parse(String(status.condition.params[0])) as string[]:[String(status.condition.params[0])])
  const merge={db:s.db,projects:await workspaces(s),categories,column:bound?.column??'created_at',operator:bound?.operator,at:bound?.at,direction:s.sortItems[0].direction,list:where(s,f,'e'),offset:s.offset}
  const parts=await blockParts(merge)
  const rows=(bound?timeSize!(r,'w'):r.general.w)*(status?r[status.name].w/Math.max(1,r.general.w):1)
  if(parts?.length)options.push({cost:looked*(parts.length+3*reach)*Math.max(1,rows)/Math.max(1,matched),run:async()=>({total:matched,ids:await blockMerge(merge,parts)})})
 }
 const whole=(source:string,x:string,keys:Clause[],own?:FieldCondition)=>()=>readAll(s,source,x,[...keys,...where(s,f,x,own),...after(s,x)])
 for(const source of readable){
  options.push({cost:(source.x==='f'?1:looked)*source.size(r,'w'),run:whole(source.source,source.x,source.keys,source.x==='f'?held:undefined)})
  if(source.group&&group!==undefined&&!source.blank)options.push({cost:source.size(r,single('a')),run:whole(`inbox_facets f INDEXED BY ${source.group}`,'f',[...source.keys,inGroup('f')],held)})
  // The facet's rows of one pinned value, read whole.
  if(source.x==='f'&&!source.blank)for(const pin of pinAll)if(pinnable(source,pin))options.push({cost:r[facetPin(source,pin)].w,run:whole(`inbox_facets f INDEXED BY ${facetPins[pin.field]}`,'f',[...source.keys,onPin(pin,'f')],held)})
 }
 // Every entry of one pinned value, read whole; with a time bound, those of pinned status categories inside it (about
 // their share of the bound's entries).
 for(const pin of pinAll)options.push({cost:looked*r[pin.name].w,run:whole(`inbox_entries e INDEXED BY ${pins[pin.field]}`,'e',[onPin(pin,'e')])})
 if(f.times.length&&timeSize)for(const pin of pinAll)if(pin.field==='status_category'&&pin.condition.params[0]!==null)options.push({cost:looked*timeSize(r,'w')*r[pin.name].w/Math.max(1,r.general.w),run:whole(`inbox_entries e INDEXED BY inbox_entries_status_by_${f.times[0].column}_asc`,'e',[onPin(pin,'e')])})
 if(!s.cursor&&matched<=s.offset)return {total:matched,ids:[]}
 const best=options.sort((x,y)=>x.cost-y.cost)[0]
 return best?.run()
}

/** Two families, or two conditions of one: every candidate of the smallest facet or time range is read once and
 * tested against all of them. */
async function candidateList(s:Shape,f:Families){
 if(f.tags.length&&!tagFormula(f.tags))return undefined
 const sources:{source:string;x:string;keys:Clause[];reads:Read[];size:(r:Measured)=>number;held?:FieldCondition}[]=[]
 const named=(read:Read,name:string)=>({...read,name})
 if(evaluable(s,f)){
  for(const set of f.tags.filter(set=>!set.negative&&set.values.length===1)){
   const name='tag'+sources.length
   sources.push({source:'inbox_facets f INDEXED BY inbox_facets_order',x:'f',keys:[{sql:"f.kind='t' AND f.ref=? AND f.value IS NULL",params:[set.values[0]]}],reads:[countRead(s,f,name,'s',[{sql:"t.k1=json_array(?) AND t.k2=''",params:[set.values[0]]}],true)],size:r=>r[name].w})
  }
  for(const field of f.fields){
   const values=fieldReads(s,f,field),name='field'+sources.length
   if(!values.facet)continue
   // A field set and not empty reads its value-less rows whose value is NULL (migration 319's 'n' rows).
   const set=field.mode==='nonnull'||field.mode==='nonempty',read=values.reads.find(read=>read.name===(set?'valued':'named'))!
   const keys=field.mode==='nonempty'?[{sql:"f.kind='n' AND f.ref=? AND f.value IS NULL",params:[field.field]}]:[{sql:"f.kind='f' AND f.ref=?",params:[field.field]},...values.facet]
   sources.push({source:`inbox_facets f INDEXED BY ${values.real?'inbox_facets_real':'inbox_facets_order'}`,x:'f',keys,reads:[named(read,name)],size:r=>r[name].w,held:field})
  }
 }
 for(const bound of f.times){
  const time=timeReads(s,f,bound),prefix='time'+sources.length
  if(!time)continue
  const reads=time.reads.map(read=>named(read,prefix+read.name))
  sources.push({source:`inbox_entries e INDEXED BY inbox_entries_by_${bound.column}_asc`,x:'e',keys:[{sql:`CAST(e.${bound.column} AS REAL) ${{lt:'<',lte:'<=',gt:'>',gte:'>='}[bound.operator]} ?`,params:[bound.at]}],reads,size:r=>reads.reduce((sum,read,i)=>sum+time.signs[i]*r[read.name].w,0)})
 }
 if(!sources.length)return undefined
 const r=await measure(s,sources.flatMap(source=>source.reads))
 const smallest=sources.sort((x,y)=>x.size(r)-y.size(r))[0]
 return readAll(s,smallest.source,smallest.x,[...smallest.keys,...where(s,f,smallest.x,smallest.held),...after(s,smallest.x)])
}
