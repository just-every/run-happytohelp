import {clauses,type Clause} from './inbox-entries'
import {onEntry} from './inbox-conditions'
import {compareValues} from './inbox-order'
import {slotFor,type Measured,type Read,type Sizes} from './inbox-shape-counts'
import type {Shape} from './inbox-shapes'

/** A page sorted by status, status category or priority walks the sort's own index, which holds every entry in
 * groups of one sort key. A request's matches may all lie in late groups (a view of unsolved tickets sorted by status
 * walks every closed ticket first), so the counts are also read by group: the page's first group is found exactly,
 * the walk seeks to it, and its cost is what the groups it crosses hold (src/modules/management/README.md). */
export interface SortGroup {column:string;direction:'asc'|'desc';key:(x:string)=>{sql:string;params:unknown[]}}
type Value=Parameters<typeof compareValues>[0]
// The ticket columns migration 319's counts keep in a slot, whose sort key is a function of the column.
const columns=new Set(['status_id','status_category','priority'])
// Only where the slot keeping the column and the request's own is narrow (not every column): its counts are few rows.
export function sortGroup(s:Pick<Shape,'sortItems'|'sort'>,slot:(column:string)=>string):SortGroup|undefined{
 const first=s.sortItems[0],part=s.sort.parts[0]
 if(!first||!part||!columns.has(first.field)||slot(first.field)==='*')return undefined
 return {column:first.field,direction:first.direction,key:(x:string)=>({sql:onEntry(part.sql,x),params:part.params})}
}

export interface Group {k:Value;m:number;w:number;categories:string[]}
/** Every count of the request by group (its matches per sort key, as each count's own formula combines them), and how
 * many entries of the request's workspaces each group holds (what walking the group reads). */
// Each grouped count's sum over the groups replaces its own (unread) total in `r`.
export async function measureGroups(s:Shape,group:SortGroup,reads:Read[],r:Measured,total:(r:Measured)=>number):Promise<Group[]>{
 const grouped=reads.filter(read=>read.grouped)
 const {slot,empty}=slotFor([group.column]),key=group.key('t')
 const held=clauses([...s.workspace('t'),{sql:"t.family='a' AND t.k1='' AND t.k2='' AND t.slot=?",params:[slot]},...empty.map(column=>({sql:`t.${column} IS NULL`,params:[]}))])
 const statements=[...grouped.map(read=>s.db.prepare(read.grouped!.sql).bind(...read.grouped!.params)),s.db.prepare(`SELECT t.${group.column} g,${key.sql} k,t.status_category c,COALESCE(SUM(t.total),0) m FROM inbox_counts t INDEXED BY inbox_counts_key WHERE ${held.sql} GROUP BY t.${group.column},t.status_category`).bind(...key.params,...held.params)]
 const results=await s.db.batch(statements)
 // Groups are keyed by their sort key: values sharing one (a priority the sort does not rank) are one group.
 const byKey=new Map<string,{k:Value;r:Measured;w:number;categories:Set<string>}>()
 const at=(k:Value)=>{const id=JSON.stringify(k);if(!byKey.has(id))byKey.set(id,{k,r:{},w:0,categories:new Set()});return byKey.get(id)!}
 results.forEach((result,i)=>{for(const row of result.results as {k:Value;m:number;c?:string}[]){
  const entry=at(row.k)
  if(i===grouped.length){entry.w+=Number(row.m);entry.categories.add(String(row.c))}
  else{const name=grouped[i].name,sizes:Sizes=entry.r[name]??{m:0,a:0,w:0,p:0};sizes.m+=Number(row.m);entry.r[name]=sizes}
 }})
 for(const read of grouped)r[read.name].m=[...byKey.values()].reduce((sum,entry)=>sum+(entry.r[read.name]?.m??0),0)
 const blank:Sizes={m:0,a:0,w:0,p:0}
 const list=[...byKey.values()].map(({k,r,w,categories})=>({k,w,categories:[...categories],m:total(new Proxy(r,{get:(target,name:string)=>target[name]??blank}))}))
 const sorted=list.sort((x,y)=>compareValues(x.k,y.k))
 return group.direction==='asc'?sorted:sorted.reverse()
}

/** Where the page starts: the first group holding a match at or after the offset, the clause seeking a walk of the
 * sort's index to it, the offset within the walk from there, and the rows the walk reads (each group it crosses
 * whole, the last by its matches' share of its rows, or every other row first when they may cluster). `plain` is what a walk from the index's start reads. Without a
 * range when the walk cannot seek past what it skips. */
export function groupWalk(groups:Group[],group:SortGroup,offset:number,x:string,clustered=false){
 const crossing=(from:number,need:number)=>{
  let cost=0
  // Within the last group: by its matches' share of its rows, or (clustered) its other rows first.
  for(let i=from;i<groups.length&&need>0;i++){const {m,w}=groups[i];if(need<=m){cost+=clustered?Math.min(w,Math.max(0,w-m)+need):w*need/Math.max(1,m);need=0}else{cost+=w;need-=m}}
  return cost
 }
 let before=0,first=0
 while(first<groups.length&&before+groups[first].m<=offset)before+=groups[first++].m
 const plain=crossing(0,offset+30)
 if(first>=groups.length||first===0)return {plain}
 const start=groups[first].k,key=group.key(x),rest=offset-before,cost=crossing(first,rest+30)
 // NULL sorts last descending: from it on only NULL lies.
 if(start===null)return {plain,range:[{sql:`${key.sql} IS NULL`,params:key.params}] as Clause[],offset:rest,cost}
 // A descending walk that reaches the NULL group cannot seek with one range.
 const nulls=groups.at(-1)!.k===null?groups.at(-1)!.m:0
 if(group.direction==='desc'&&nulls&&groups.slice(first).reduce((sum,g)=>sum+g.m,0)-nulls<rest+30)return {plain}
 return {plain,range:[{sql:`${key.sql}${group.direction==='asc'?'>=':'<='}?`,params:[...key.params,start]}] as Clause[],offset:rest,cost}
}

/** The groups holding the page (from the first with a match at or after the offset to the one holding its last), the
 * offset within them, their sort keys and status categories, and how many entries those categories hold. */
export function pageGroups(groups:Group[],offset:number){
 let before=0,first=0
 while(first<groups.length&&before+groups[first].m<=offset)before+=groups[first++].m
 const page:Group[]=[]
 for(let i=first,seen=before;i<groups.length&&seen<offset+30;i++){page.push(groups[i]);seen+=groups[i].m}
 if(!page.length||page.some(group=>group.k===null))return undefined
 const categories=[...new Set(page.flatMap(group=>group.categories))]
 // Reading the page's status categories reads every group of them.
 return {offset:offset-before,keys:page.map(group=>group.k),categories,w:groups.filter(group=>group.categories.some(category=>categories.includes(category))).reduce((sum,group)=>sum+group.w,0)}
}
