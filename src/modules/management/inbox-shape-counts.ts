import {clauses,type Clause} from './inbox-entries'
import {onEntry,type Condition} from './inbox-conditions'
import {bucketed,tagClause,tagFormula,timeBuckets,type Families,type FieldCondition,type TimeCondition} from './inbox-families'
import type {Shape} from './inbox-shapes'

/** The counts a shaped inbox list reads (inbox-shapes.ts): exact totals summed from migration 319's inbox_counts for
 * each family, and the sizes of the candidate sets and index ranges its pages may read. */
// One D1 round trip of counts: each statement answers `m` (rows matching the request), `a` (rows the role may see)
// and `w` (rows of the request's workspaces, what walking or reading an index range of them reads).
// `grouped` is the same count by the walked sort group (inbox-sort-groups.ts): rows of g (the group's column), k (its
// sort key) and m.
export type Read={name:string;sql:string;params:unknown[];grouped?:{sql:string;params:unknown[]}}
export type Sizes={m:number;a:number;w:number;p:number;g?:string|null}
export type Measured=Record<string,Sizes>
export async function measure(s:Shape,reads:Read[]):Promise<Measured>{
 const results=await s.db.batch(reads.map(read=>s.db.prepare(read.sql).bind(...read.params)))
 return Object.fromEntries(reads.map((read,i)=>{const row=(results[i].results as any[])[0]??{};return [read.name,{m:Number(row.m??0),a:Number(row.a??0),w:Number(row.w??0),p:Number(row.p??0),g:row.g}]}))
}
// inbox_counts' slots and the ticket columns each keeps (migration 319); the others are empty in its rows.
export const slotted=['status_category','status_id','assigned_to','priority','channel']
const slots:[string,string[]][]=[['',[]],['status_category',['status_category']],['assigned_to',['assigned_to']],['channel',['channel']],['status_id',['status_category','status_id']],['priority',['status_category','priority']],['sa',['status_category','assigned_to']],['sia',['status_category','status_id','assigned_to']],['*',slotted]]
/** The narrowest slot keeping every named ticket column, with the columns it leaves empty. */
export function slotFor(named:Iterable<string>){
 const wanted=[...named]
 const [slot,kept]=slots.find(([,kept])=>wanted.every(column=>kept.includes(column)))!
 return {slot,empty:slotted.filter(column=>!kept.includes(column))}
}
// The ticket columns a request's flags and tallied conditions name (and a sort group's column, when one is walked).
export function slotOf(s:Shape,f:Families,also:string[]=[]){
 const sql=[...s.flags.map(flag=>flag('t').sql),...f.tallied.map(condition=>onEntry(condition.sql,'t'))].join(' ')
 return slotFor([...new Set([...[...sql.matchAll(/\bt\.([a-z_]+)\b/g)].map(match=>match[1]),...also])].filter(column=>slotted.includes(column)))
}
// A count of one family key (or a range of keys): its rows matching the request's flags and tallied conditions in
// `m`, and every visible row in `a` (the size of a candidate set).
// A range of keys (index 'range') is read through inbox_counts_range, which seeks the slot's columns before the key:
// for the request's own slot when it pins each column the slot keeps to values, and always for the sizes (slot '').
export function countRead(s:Shape,f:Families,name:string,family:string,keys:Clause[],sized:boolean|'w'=false,index='inbox_counts_key'):Read{
 const {slot,empty}=slotOf(s,f),blank=(columns:string[])=>columns.map(column=>({sql:`t.${column} IS NULL`,params:[]}))
 const ranged=index==='range',keyed=ranged?'inbox_counts_key':index,held=new Set(f.tallied.map(condition=>pinnedBy(condition)?.field))
 const seekable=ranged&&slotted.every(column=>empty.includes(column)||held.has(column))
 const counts=`inbox_counts t INDEXED BY ${seekable?'inbox_counts_range':keyed}`,sizes=`inbox_counts t INDEXED BY ${ranged?'inbox_counts_range':keyed}`
 const matched=clauses([...s.access('t'),{sql:'t.family=? AND t.slot=?',params:[family,slot]},...keys,...blank(empty),...s.flags.map(flag=>flag('t')),...f.tallied.map(condition=>({sql:onEntry(condition.sql,'t'),params:condition.params}))])
 const all=clauses([...s.access('t'),{sql:"t.family=? AND t.slot=''",params:[family]},...keys,...blank(slotted)])
 const anywhere=clauses([...s.workspace('t'),{sql:"t.family=? AND t.slot=''",params:[family]},...keys,...blank(slotted)])
 // The same count by sort group, in the slot that also keeps the group's column.
 const grouped=s.group&&(()=>{
  const {column,key}=s.group,by=slotOf(s,f,[column]),k=key('t')
  const list=clauses([...s.access('t'),{sql:'t.family=? AND t.slot=?',params:[family,by.slot]},...keys,...blank(by.empty),...s.flags.map(flag=>flag('t')),...f.tallied.map(condition=>({sql:onEntry(condition.sql,'t'),params:condition.params}))])
  return {sql:`SELECT t.${column} g,${k.sql} k,COALESCE(SUM(t.total),0) m FROM inbox_counts t INDEXED BY ${keyed} WHERE ${list.sql} GROUP BY t.${column}`,params:[...k.params,...list.params]}
 })()
 // Sizes are read only where a page's choice of walk needs them; a count read by group sums its groups instead of
 // reading its own total (measureGroups).
 const m=grouped?{sql:'0',params:[]}:{sql:`(SELECT COALESCE(SUM(t.total),0) FROM ${counts} WHERE ${matched.sql})`,params:matched.params}
 if(!sized)return {name,grouped,sql:`SELECT ${m.sql} m,0 a,0 w`,params:m.params}
 if(sized==='w')return {name,grouped,sql:`SELECT ${m.sql} m,0 a,(SELECT COALESCE(SUM(t.total),0) FROM ${sizes} WHERE ${anywhere.sql}) w`,params:[...m.params,...anywhere.params]}
 return {name,grouped,sql:`SELECT ${m.sql} m,(SELECT COALESCE(SUM(t.total),0) FROM ${sizes} WHERE ${all.sql}) a,(SELECT COALESCE(SUM(t.total),0) FROM ${sizes} WHERE ${anywhere.sql}) w`,params:[...m.params,...all.params,...anywhere.params]}
}
// Rows of a source counted one by one.
export function rowRead(s:Shape,f:Families,name:string,source:string,x:string,keys:Clause[],more:Clause[]=[]):Read{
 const seen=clauses(s.access(x)),cond=clauses([...s.access(x),...s.flags.map(flag=>flag(x)),...f.tallied.map(condition=>({sql:onEntry(condition.sql,x),params:condition.params})),...more]),within=clauses([...s.workspace(x),...keys])
  const k=s.group?.key(x),grouped=s.group&&k&&{sql:`SELECT ${x}.${s.group.column} g,${k.sql} k,COALESCE(SUM(iif(${cond.sql},1,0)),0) m FROM ${source} WHERE ${within.sql} GROUP BY ${x}.${s.group.column}`,params:[...k.params,...cond.params,...within.params]}
 return {name,grouped,sql:`SELECT COALESCE(SUM(iif(${cond.sql},1,0)),0) m,COALESCE(SUM(iif(${seen.sql},1,0)),0) a,count(*) w FROM ${source} WHERE ${within.sql}`,params:[...cond.params,...seen.params,...within.params]}
}

export const json=(values:unknown[])=>({sql:`json_array(${values.map(()=>'?').join(',')})`,params:values})
// The custom field counts a field condition sums: its non-null values ('n'), and the values it names ('v').
export function fieldReads(s:Shape,f:Families,field:FieldCondition):{reads:Read[];total:(r:Measured)=>number;facet?:Clause[];real?:boolean}{
 const valued=countRead(s,f,'valued','n',[{sql:"t.k1=? AND t.k2=''",params:[field.field]}],true)
 const named=(sql:string,params:unknown[])=>countRead(s,f,'named','v',[{sql:'t.k1=?',params:[field.field]},{sql,params}],true,sql.startsWith('CAST(')?'inbox_counts_real':'inbox_counts_key')
 const base=talliedBase(s,f)
 switch(field.mode){
  case 'eq':return {reads:[named('t.k2=?',[field.value])],total:r=>r.named.m,facet:[{sql:'f.value=?',params:[field.value]}]}
  case 'real':return {reads:[named('CAST(t.k2 AS REAL)=?',[field.value])],total:r=>r.named.m,facet:[{sql:'CAST(f.value AS REAL)=?',params:[field.value]}],real:true}
  case 'in':return {reads:[named('t.k2 IN (SELECT value FROM json_each(?))',[field.value])],total:r=>r.named.m,facet:[{sql:'f.value IN (SELECT value FROM json_each(?))',params:[field.value]}]}
  case 'ne':return {reads:[valued,named('t.k2=?',[field.value])],total:r=>r.valued.m-r.named.m}
  case 'ne-real':return {reads:[valued,named('CAST(t.k2 AS REAL)=?',[field.value])],total:r=>r.valued.m-r.named.m}
  case 'not_in':return {reads:[valued,named('t.k2 IN (SELECT value FROM json_each(?))',[field.value])],total:r=>r.valued.m-r.named.m}
  case 'nonnull':return {reads:[valued],total:r=>r.valued.m,facet:[]}
  case 'null':return {reads:[valued,base],total:r=>r.base.m-r.valued.m}
  case 'nonempty':return {reads:[valued,named("t.k2=''",[])],total:r=>r.valued.m-r.named.m,facet:[]}
  case 'empty':return {reads:[valued,named("t.k2=''",[]),base],total:r=>r.base.m-r.valued.m+r.named.m}
 }
}
// Every entry the request admits before its families.
export const talliedBase=(s:Shape,f:Families)=>countRead(s,f,'base','a',[{sql:"t.k1='' AND t.k2=''",params:[]}])
// The general walk's index holds every entry of the workspaces (the inbox order, a sort's own index) or of its view's
// flags (`m`); `p` is what a pinned inbox-order index holds (313's: the flags of its own columns), `a` what the role
// sees, and whether it sees one group alone (`g`).
export const indexColumns:Record<string,string[]>={inbox_entries_flags:['ai','snoozed'],inbox_entries_assignee:['assigned_to']}
export const generalSize=(s:Shape):Read=>{
 const flags=clauses(s.flags.map(flag=>flag('t'))),seen=clauses(s.access('t')),groups=clauses(s.access('v')),within=clauses(s.workspace('t'))
 const held=clauses(s.flags.map(flag=>flag('t')).filter(flag=>(indexColumns[s.pinned]??[]).some(column=>new RegExp(`\\bt\\.${column}\\b`).test(flag.sql))))
 return {name:'general',sql:`SELECT COALESCE(SUM(iif(${flags.sql},t.total,0)),0) m,COALESCE(SUM(iif(${held.sql},t.total,0)),0) p,COALESCE(SUM(iif(${seen.sql},t.total,0)),0) a,COALESCE(SUM(t.total),0) w,(SELECT iif(count(DISTINCT coalesce(v.group_id,''))=1 AND min(v.group_id IS NULL)=0,max(v.group_id),NULL) FROM inbox_tallies v WHERE ${groups.sql}) g FROM inbox_tallies t WHERE ${within.sql}`,params:[...flags.params,...held.params,...seen.params,...groups.params,...within.params]}
}

/** The time counts a bound sums: whole years, months and days on the side it admits (some subtracted, see
 * timeBuckets), the entries of its own day, and entries whose times are not bucketed, one by one. */
export function timeReads(s:Shape,f:Families,bound:TimeCondition){
 const buckets=timeBuckets(bound)
 if(!buckets)return undefined
 const family=bound.column==='created_at'?'c':'u',cast=`CAST(e.${bound.column} AS REAL)`,own={sql:onEntry(bound.condition.sql,'e'),params:bound.condition.params}
 const reads:Read[]=buckets.ranges.map(([level,from,to],i)=>countRead(s,f,'bucket'+i,family,[{sql:'t.k1=? AND t.k2 BETWEEN ? AND ?',params:[level,from,to]}],'w','range'))
 const signs=[...buckets.ranges.map(range=>range[3]),1,1]
 reads.push(rowRead(s,f,'day',`inbox_entries e INDEXED BY inbox_entries_by_${bound.column}_asc`,'e',[{sql:`${cast}>=? AND ${cast}<?`,params:buckets.day},own,{sql:bucketed('e',bound.column),params:[]}]))
 reads.push(rowRead(s,f,'unbucketed',`inbox_entries e INDEXED BY inbox_entries_unbucketed_${bound.column}`,'e',[{sql:`e.${bound.column} IS NOT NULL AND NOT ${bucketed('e',bound.column)}`,params:[]},own]))
 const sum=(r:Measured,key:'m'|'a'|'w')=>reads.reduce((total,read,i)=>total+signs[i]*r[read.name][key],0)
 return {reads,signs,total:(r:Measured)=>sum(r,'m'),size:(r:Measured,key:'a'|'w')=>sum(r,key)}
}

/** Tag sets: the matches are a signed sum of the counts of entries holding each subset of the named tags
 * (inbox_counts family 's', entries with at most eight tags), and entries with more tags are counted one by one. */
export function tagReads(s:Shape,f:Families){
 const formula=tagFormula(f.tags)
 if(!formula)return undefined
 const reads:Read[]=[],sets=[...formula.coefficients.keys()].filter(set=>set)
 // Each named tag's own count sizes its facet, the candidates a page may walk.
 const singles=formula.tags.map((_,i)=>1<<i)
 for(const set of new Set([...sets,...singles]))reads.push(countRead(s,f,'set'+set,'s',[{sql:`t.k1=${json(formula.subset(set)).sql} AND t.k2=''`,params:formula.subset(set)}],singles.includes(set)))
 const all=formula.coefficients.has(0)
 if(all)reads.push(talliedBase(s,f))
 const matched=clauses(f.tags.map(set=>tagClause('f',set)))
 reads.push(rowRead(s,f,'wide','inbox_facets f INDEXED BY inbox_facets_order','f',[{sql:"f.kind='w' AND f.ref='' AND f.value IS NULL",params:[]}],[matched]))
 const wideAll=all?rowRead(s,f,'wideAll','inbox_facets f INDEXED BY inbox_facets_order','f',[{sql:"f.kind='w' AND f.ref='' AND f.value IS NULL",params:[]}]):undefined
 if(wideAll)reads.push(wideAll)
 const total=(r:Measured)=>sets.reduce((sum,set)=>sum+formula.coefficients.get(set)!*r['set'+set].m,0)+(all?formula.coefficients.get(0)!*(r.base.m-r.wideAll.m):0)+r.wide.m
 // Candidate facets: a tag every match holds (a condition naming one tag), with its size.
 const held=f.tags.filter(set=>!set.negative&&set.values.length===1).map(set=>formula.tags.indexOf(set.values[0]))
 // Any of several tags: each tag's own facet holds a part of the matches.
 const any=f.tags.find(set=>!set.negative&&set.values.length>1)
 const tag=(i:number)=>({tag:formula.tags[i],name:'set'+(1<<i),size:(r:Measured,key:'a'|'w')=>r['set'+(1<<i)][key]})
 return {reads,total,held:held.map(tag),any:any&&[...new Set(any.values)].map(value=>tag(formula.tags.indexOf(value)))}
}

// The inbox-order index of each ticket column a request pins to one value (313's, and migration 319's for a status).
export const pins:Record<string,string>={assigned_to:'inbox_entries_assignee',status_category:'inbox_entries_status',priority:'inbox_entries_priority',channel:'inbox_entries_channel',status_id:'inbox_entries_status_id_order',group_id:'inbox_entries_group_order'}
// The facet index pinned to each column a facet's page may pin (migration 319), after the facet's own key.
export const facetPins:Record<string,string>={status_category:'inbox_facets_status_category_order',assigned_to:'inbox_facets_assigned_to_order',group_id:'inbox_facets_group_order'}
/** A condition pinning one ticket column: to one value (an index range in the inbox order), or to a list of values
 * (index ranges whose rows are read whole). */
export function pinnedBy(condition:Condition){
 const field=condition.field
 if(!field||!Object.hasOwn(pins,field))return undefined
 if(condition.operator==='eq'&&new RegExp(`^c\\.${field}(=\\?| IS NULL)$`).test(condition.sql))return {field,list:false}
 if(condition.operator==='in'&&condition.sql===`c.${field} IN (SELECT value FROM json_each(?))`)return {field,list:true}
 return undefined
}
export type Pin={condition:Condition;field:string;list:boolean;name:string}
// The pinned column's slot of inbox_counts, with the slotted columns that slot leaves empty.
export function pinKeys(condition:Condition):Clause[]{
 const {slot,empty}=slotFor(slotted.includes(condition.field!)?[condition.field!]:[])
 return [{sql:'t.slot=?',params:[slot]},...empty.map(other=>({sql:`t.${other} IS NULL`,params:[]})),{sql:onEntry(condition.sql,'t'),params:condition.params}]
}
// How many entries of the request's workspaces hold the pinned value (the rows walking its index reads).
export function pinRead(s:Shape,name:string,condition:Condition):Read{
 const keys=[{sql:"t.family='a' AND t.k1='' AND t.k2=''",params:[]},...pinKeys(condition)]
 const seen=clauses([...s.access('t'),...keys]),all=clauses([...s.workspace('t'),...keys])
 return {name,sql:`SELECT 0 m,(SELECT COALESCE(SUM(t.total),0) FROM inbox_counts t WHERE ${seen.sql}) a,(SELECT COALESCE(SUM(t.total),0) FROM inbox_counts t WHERE ${all.sql}) w`,params:[...seen.params,...all.params]}
}
// How many rows of a facet (its family key) hold the pinned value in the request's workspaces.
export function facetPinRead(s:Shape,name:string,count:Count,condition:Condition):Read{
 const all=clauses([...s.workspace('t'),{sql:'t.family=?',params:[count.family]},...count.keys,...pinKeys(condition)])
 return {name,sql:`SELECT 0 m,0 a,(SELECT COALESCE(SUM(t.total),0) FROM inbox_counts t WHERE ${all.sql}) w`,params:all.params}
}
export type Size=(r:Measured,key:'a'|'w')=>number
// A facet's family key in inbox_counts (what sizes its rows).
export type Count={family:string;keys:Clause[]}
