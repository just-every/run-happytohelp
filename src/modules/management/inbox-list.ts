import {HTTPException} from 'hono/http-exception'
import type {Actor} from '../../platform/env'
import {conversationsData} from './dashboard-data'
import {inboxView} from './inbox-filters'
import {inboxAccess,clauses,type Clause} from './inbox-entries'
import {driver,onEntry,tagSet,talliedCondition,walkedSort,type Condition} from './inbox-conditions'
import {compileFilters,parseFilters,queryJSON} from '../tickets/filters'
import {compileSort,parseSort} from '../tickets/sort'
import {savedQueue} from '../tickets/views'

/** A condition that holds for an inbox entry, a tally row or an unread row alike (alias `x`). */
type Flag=(x:string)=>Clause
const flag=(sql:(x:string)=>string,...params:unknown[]):Flag=>x=>({sql:sql(x),params})
const fieldIndex:Record<string,string>={status_category:'inbox_entries_status',priority:'inbox_entries_priority',channel:'inbox_entries_channel'}
const pinnedField=(sql:string)=>sql.match(/^c\.(status_category|priority|channel)=\?$/)?.[1]

/** The unsearched inbox list (both doors): the answers of filtering every conversation, read from the inbox
 * entries (src/modules/management/README.md, "Inbox reads at scale"). A total is a tally sum where tallies
 * count it, otherwise the matching rows of the smallest candidate set an index gives; a page walks an index in
 * its order and stops after its rows, or sorts that candidate set when the walk would read more. */
export async function inboxList(c:any,a:Actor,project:string|undefined,page:number){
 const query=(name:string)=>c.req.query(name) as string|undefined
 const saved=await savedQueue(c.env,a,project,query('saved_view'))
 const requestedFilters=queryJSON(query('filters'),'filters'),requestedSort=queryJSON(query('sort'),'sort')
 const structured=saved!==undefined||requestedFilters!==undefined
 // Flags and the assignee hold for entries, tallies and unread rows; conditions name conversation columns.
 const flags:Flag[]=[],conditions:Condition[]=[]
 let assigned=false,ai:number|undefined,unread=false
 if(structured)conditions.push(...(await compileFilters(c.env,a,project,saved?.filters??parseFilters(requestedFilters))).parts)
 else{
  const view=inboxView(query)
  if(view.status==='ai'){flags.push(flag(x=>`${x}.ai=1`));ai=1}
  if(view.category)conditions.push({field:'status_category',operator:'eq',sql:'c.status_category=?',params:[view.status]})
  for(const [field,value] of view.fields)conditions.push({field,operator:'eq',sql:`c.${field}=?`,params:[value]})
  if(view.status==='unresolved'||view.status==='resolved'){const unresolved=view.status==='resolved'?0:1;flags.push(flag(x=>`${x}.unresolved=${unresolved}`),flag(x=>`${x}.ai=0`));ai=0}
  if(view.assignment==='myself'){flags.push(flag(x=>`${x}.assigned_to=?`,a.id));assigned=true}
  if(view.assignment==='none'){flags.push(flag(x=>`${x}.assigned_to IS NULL`));assigned=true}
  if(!['myself','none','anyone'].includes(view.assignment)){flags.push(flag(x=>`${x}.assigned_to=?`,view.assignment));assigned=true}
  unread=view.view==='unread'
 }
 const sortItems=requestedSort===undefined?saved?.sort??[]:parseSort(requestedSort)
 const sort=await compileSort(c.env,a,project,sortItems)
 const company=query('company')
 const tag=query('tag')
 if(tag&&(!project||!await c.env.DB.prepare('SELECT id FROM workspace_tags WHERE id=? AND project_id=?').bind(tag,project).first()))throw new HTTPException(404)
 const before=query('last_message_before'),beforeId=query('last_conversation_before')
 let cursor:[number,string]|undefined
 if(before&&beforeId){
  if(saved?.sort.length||requestedSort!==undefined)throw new HTTPException(400,{message:'Use page pagination with a custom sort'})
  const stamp=Date.parse(before);if(!Number.isFinite(stamp))throw new HTTPException(400)
  cursor=[stamp,beforeId]
 }
 const snoozed=query('snoozed')
 if(snoozed==='only')flags.push(flag(x=>`${x}.snoozed=1`))
 else if(snoozed!=='include')flags.push(flag(x=>`${x}.snoozed=0`))
 const db=c.env.DB,custom=sortItems.length>0,offset=(page-1)*30
 // A member's unread rows drive the unread view; an entry is joined only when a condition, company or sort names it.
 const d=unread?'u':'e',joined=unread&&(conditions.length>0||Boolean(company)||custom)
 const access=(x:string)=>inboxAccess(x,a.id,{project,deleted:true})
 const companyClause:Clause[]=company?[{sql:'e.company_id=? AND e.project_id IN (SELECT account.project_id FROM companies account WHERE account.id=? AND account.merged_into IS NULL)',params:[company,company]}]:[]
 const tagClause:Clause[]=tag?[{sql:`EXISTS(SELECT 1 FROM conversation_tags tagged WHERE tagged.conversation_id=${d}.conversation_id AND tagged.project_id=${d}.project_id AND tagged.tag_id=?)`,params:[tag]}]:[]
 const onEntries=(list:Condition[],x:string)=>list.map(clause=>({sql:onEntry(clause.sql,x),params:clause.params}))
 const matching=(more:Clause[]=[])=>clauses([...(unread?[{sql:'u.user_id=?',params:[a.id]}]:[]),...access(d),...flags.map(f=>f(d)),...onEntries(conditions,'e'),...companyClause,...more])
 const after:Clause[]=cursor?[{sql:`(${d}.sort_at,${d}.conversation_id)<(?,?)`,params:cursor}]:[]
 const order=custom?onEntry(sort.sql,'e'):`${d}.sort_at DESC,${d}.conversation_id DESC`
 // The tag sets a request names (the tag control, or a tags condition), and the conditions on ticket columns.
 const tagSets=[...(tag?[{values:[tag],negative:false}]:[]),...conditions.map(tagSet).filter(set=>set!==undefined)]
 const columns=conditions.filter(condition=>!tagSet(condition))
 const field=columns.map(clause=>pinnedField(clause.sql)).find(Boolean)
 // In the inbox order, each index leads with the workspace and what the request pins.
 const pinned=company?'inbox_entries_company':field?fieldIndex[field]:assigned?'inbox_entries_assignee':ai!==undefined&&snoozed!=='include'?'inbox_entries_flags':'inbox_entries_order'
 const from=(index:string)=>unread?`inbox_unread u INDEXED BY inbox_unread_view${joined?' CROSS JOIN inbox_entries e INDEXED BY inbox_entries_conversation ON e.conversation_id=u.conversation_id':''}`:`inbox_entries e INDEXED BY ${index}`
 const tally=(table:string,withFlags:boolean,more:Clause[]=[])=>{const sum=clauses([...access('t'),...(withFlags?flags.map(f=>f('t')):[]),...more]);return {sql:`(SELECT COALESCE(SUM(t.total),0) FROM ${table} t WHERE ${sum.sql})`,params:sum.params}}
 const sizes=async(parts:Record<string,{sql:string;params:unknown[]}>)=>{const names=Object.keys(parts);const row=await db.prepare(`SELECT ${names.map(name=>`${parts[name].sql} ${name}`).join(',')}`).bind(...names.flatMap(name=>parts[name].params)).first();return Object.fromEntries(names.map(name=>[name,Number(row[name])]))}
 const counted=async(source:string,where:{sql:string;params:unknown[]})=>Number((await db.prepare(`SELECT count(*) total FROM ${source} WHERE ${where.sql}`).bind(...where.params).first()).total)
 // One read of a candidate set (the rows its index holds for `candidates`): its size and how many match.
 const candidates=async(source:string,within:Clause[],where:{sql:string;params:unknown[]})=>{const base=clauses(within);const row=await db.prepare(`SELECT count(*) candidates,COALESCE(SUM(${where.sql}),0) total FROM ${source} WHERE ${base.sql}`).bind(...where.params,...base.params).first();return {size:Number(row.candidates),total:Number(row.total)}}
 // A walk in an order reads about (offset+30)·all/matching rows.
 const walk=(all:number,matched:number)=>(offset+30)*all/Math.max(1,matched)
 const members:Clause[]=[{sql:'tagged.project_id IN (SELECT tag_member.project_id FROM memberships tag_member WHERE tag_member.user_id=?)',params:[a.id]},...(project?[{sql:'tagged.project_id=?',params:[project]}]:[])]
 // The entries a tag set's links name: a superset of its matches, each looked up by its conversation.
 const linked=(values:string[]):Clause=>{const list=clauses([...members,{sql:'tagged.tag_id IN (SELECT value FROM json_each(?))',params:[JSON.stringify(values)]}]);return {sql:`e.conversation_id IN (SELECT tagged.conversation_id FROM conversation_tags tagged INDEXED BY conversation_tags_filter WHERE ${list.sql})`,params:list.params}}
 const byLinks='inbox_entries e INDEXED BY inbox_entries_conversation'
 const scoped=matching(tagClause)
 // The candidate set a page may sort instead of walking: its source, the clause that bounds it and its size.
 let total:number,talliedTotal=false,drive:{source:string;clause:Clause[];size:number;perRow:number}|undefined,listedIds:string[]|undefined
 if(unread)total=await counted(from(pinned),matching([...tagClause,...after]))
 else if(!company&&tagSets.length<=1&&columns.every(talliedCondition)){
  // Tallies count it: workspace, group, assignee, flags, ticket status, priority, channel (and a tag's links).
  talliedTotal=true
  const onTally=onEntries(columns,'t'),set=tagSets[0]
  const counts=()=>tally(columns.length?'inbox_field_tallies':'inbox_tallies',true,onTally)
  if(!set)total=(await sizes({matched:counts()})).matched
  else{
   const values=[...new Set(set.values)],where=clauses([...access('t'),...flags.map(f=>f('t')),...onTally,{sql:'t.tag_id IN (SELECT value FROM json_each(?))',params:[JSON.stringify(values)]}])
   const perTag=new Map(((await db.prepare(`SELECT t.tag_id tag,SUM(t.total) total FROM inbox_tag_tallies t WHERE ${where.sql} GROUP BY t.tag_id`).bind(...where.params).all()).results as any[]).map(row=>[String(row.tag),Number(row.total)]))
   // The largest tag's matches, then each other tag's matches that no tag before it has (a tag that matches
   // nothing here adds nothing, and its links are not read).
   const ordered=values.filter(value=>(perTag.get(value)??0)>0).sort((x,y)=>perTag.get(y)!-perTag.get(x)!||(x<y?-1:1))
   let union=ordered.reduce((sum,value)=>sum+(perTag.get(value)??0),0)
   if(ordered.length>1){
    const list=clauses([...members,...access('e'),...flags.map(f=>f('e')),...onEntries(columns,'e')]),json=JSON.stringify(ordered)
    // An entry's tag comes before `later` when it is found earlier in the list (each JSON-quoted between commas).
    const position=(value:string)=>`instr((SELECT ','||group_concat(json_quote(listed.value),',')||',' FROM json_each(?1) listed),','||json_quote(${value})||',')`
    union-=Number((await db.prepare(`SELECT count(*) total FROM json_each(?1) later CROSS JOIN conversation_tags tagged INDEXED BY conversation_tags_filter CROSS JOIN inbox_entries e INDEXED BY inbox_entries_conversation WHERE later.key>0 AND tagged.tag_id=later.value AND e.conversation_id=tagged.conversation_id AND e.project_id=tagged.project_id AND ${list.sql} AND EXISTS(SELECT 1 FROM json_each(e.tags_key) mine WHERE ${position('mine.value')} BETWEEN 1 AND ${position('later.value')}-1)`).bind(json,...list.params).first()).total)
   }
   total=set.negative?(await sizes({matched:counts()})).matched-union:union
   if(!set.negative){const links=await sizes({links:tally('inbox_tag_tallies',true,[{sql:'t.tag_id IN (SELECT value FROM json_each(?))',params:[JSON.stringify(ordered)]}])});drive={source:byLinks,clause:[linked(ordered)],size:links.links,perRow:3}}
  }
 }else{
  // Otherwise count the matches within the smallest candidate set an index gives: a company's entries, a tag
  // set's links, or the entries a ticket column's own index holds for its condition.
  const positive=tagSets.find(set=>!set.negative),column=driver(columns)
  if(company)drive={source:from('inbox_entries_company'),clause:companyClause,size:0,perRow:2}
  else if(positive)drive={source:byLinks,clause:[linked([...new Set(positive.values)])],size:0,perRow:3}
  else if(column)drive={source:`inbox_entries e INDEXED BY ${column.index}`,clause:onEntries([column.condition],'e'),size:0,perRow:2}
  // A tag set's links, and entries created or updated before a time (they lie at the far end of the inbox order,
  // which follows activity, so a walk would read all of it), are read once, in order, for the total and the page.
  const oldest=column&&!custom&&['created_at','updated_at'].includes(column.condition.field!)&&['lt','lte'].includes(column.condition.operator!)
  if(!company&&(positive||oldest)){
   const list=clauses([...access('e'),...drive!.clause,scoped,...after])
   const all=((await db.prepare(`SELECT e.conversation_id id FROM ${drive!.source} WHERE ${list.sql} ORDER BY ${order}`).bind(...list.params,...(custom?sort.params:[])).all()).results as any[]).map(row=>String(row.id))
   total=all.length;listedIds=all.slice(offset,offset+30)
  }else{
   const read=await candidates(drive?.source??from(pinned),[...access('e'),...(drive?drive.clause:flags.map(f=>f('e')))],clauses([scoped,...after]))
   total=read.total
   if(drive)drive.size=read.size
  }
 }
 if(talliedTotal&&cursor){
  // A total after a cursor counts what lies past it: the tally less the matching entries before it.
  total-=await counted(from(pinned),{sql:`${scoped.sql} AND (e.sort_at,e.conversation_id)>=(?,?)`,params:[...scoped.params,...cursor]})
 }
 let source=from(pinned),listed=clauses([scoped,...after])
 if(!unread&&!listedIds&&total>offset){
  // The page walks its order when that reads less than sorting the candidates: a custom sort led by a ticket
  // column or tags walks that column's own index (sorting only within its equal values).
  // A ticket column's own index and the inbox order hold every entry of the workspace; the others its view's.
  const {everything,viewed}=await sizes({everything:tally('inbox_tallies',false),viewed:tally('inbox_tallies',true)})
  const sorting=drive?drive.perRow*drive.size:2*(pinned==='inbox_entries_order'||pinned==='inbox_entries_flags'?everything:total)
  const walked=custom?walkedSort(sortItems):pinned
  if(walked&&walk(custom||pinned==='inbox_entries_order'?everything:viewed,total)<sorting)source=from(walked)
  else if(drive){source=drive.source;listed=clauses([...drive.clause,scoped,...after])}
 }
 const ids:string[]=listedIds??(total<=offset?[]:(await db.prepare(`SELECT ${d}.conversation_id id FROM ${source} WHERE ${listed.sql} ORDER BY ${order} LIMIT 30 OFFSET ?`).bind(...listed.params,...(custom?sort.params:[]),offset).all()).results.map((row:any)=>String(row.id)))
 const found=ids.length?(await db.prepare('SELECT * FROM conversations WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all()).results:[]
 const byId=new Map(found.map((row:any)=>[String(row.id),row])),rows=ids.map(id=>byId.get(id)).filter(Boolean)
 return {data:await conversationsData(c.env,rows,a.id),meta:{pagination:{total,current_page:page,total_pages:Math.max(1,Math.ceil(total/30))}}}
}
