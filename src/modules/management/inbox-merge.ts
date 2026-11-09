import {clauses,type Clause} from './inbox-entries'
import {compareValues} from './inbox-order'

/** A page sorted by conversation id. Ids may follow creation, so a time bound's matches (or old closed tickets, or any
 * condition that follows time) can lie at the far end of the id order and a walk would read every other entry first. Migration 319's block indexes
 * hold each 30-day block of the bound's time in id order: the blocks inside the bound are walked side by side, each
 * reading its next matches, and merged; a round reads on only from the blocks that may still hold the page, so the
 * rows read stay near the page's own matches however the ids relate to time. Exact: every block's rows before its
 * frontier are read, so the merged rows up to the earliest frontier are all the matches there. A page of some status
 * categories walks each category's blocks apart (a block of closed tickets holds no unsolved one). */
export const BLOCK=2592000000
export const blockOf=(x:string,column:string)=>`CAST(CAST(${x}.${column} AS REAL)/${BLOCK} AS INTEGER)`
const MAX_PARTS=120
export interface BlockMerge {db:D1Database;projects:string[];categories?:string[];column:'created_at'|'updated_at';operator?:'lt'|'lte'|'gt'|'gte';at?:number;direction:'asc'|'desc';list:Clause[];offset:number}
const indexOf=(m:Pick<BlockMerge,'column'|'categories'>)=>`inbox_entries e INDEXED BY inbox_entries_${m.column.replace('_at','')}_${m.categories?'status_':''}block`

/** The blocks of each workspace the bound admits, or all of them (none when there are more than a merge reads side by
 * side). */
export async function blockParts(m:Pick<BlockMerge,'db'|'projects'|'categories'|'column'|'operator'|'at'>){
 const index=indexOf(m),block=blockOf('e',m.column),scopes=m.projects.flatMap(project=>(m.categories??[undefined]).map(category=>({project,category})))
 const ends=await m.db.batch(scopes.map(({project,category})=>{const own=`e.project_id=?1${category===undefined?'':' AND e.status_category=?2'}`;return m.db.prepare(`SELECT (SELECT ${block} FROM ${index} WHERE ${own} AND ${block} IS NOT NULL ORDER BY ${block} ASC LIMIT 1) low,(SELECT ${block} FROM ${index} WHERE ${own} AND ${block} IS NOT NULL ORDER BY ${block} DESC LIMIT 1) high`).bind(project,...(category===undefined?[]:[category]))}))
 const edge=m.at===undefined?undefined:Math.trunc(m.at/BLOCK),below=m.operator==='lt'||m.operator==='lte',parts:{project:string;category?:string;block:number}[]=[]
 ends.forEach((result,i)=>{
  const row=(result.results as {low:number|null;high:number|null}[])[0]
  if(row?.low==null||row.high==null)return
  const from=edge===undefined||below?row.low:Math.max(row.low,edge),to=edge===undefined||!below?row.high:Math.min(row.high,edge)
  for(let block=from;block<=to;block++)parts.push({...scopes[i],block})
 })
 return parts.length>MAX_PARTS?undefined:parts
}

interface Part {project:string;category?:string;block:number;frontier?:string;done:boolean;q:number}
/** The page's conversation ids, merged from the blocks' walks. */
export async function blockMerge(m:BlockMerge,parts:{project:string;category?:string;block:number}[]){
 const reach=m.offset+30,descending=m.direction==='desc',index=indexOf(m)
 // First every block's earliest match (where each block starts in the order).
 const state:Part[]=parts.map(part=>({...part,done:false,q:1}))
 const found:string[]=[],filter=clauses(m.list)
 // Earlier in the page's order.
 const before=(x:string,y:string)=>descending?compareValues(x,y)>0:compareValues(x,y)<0
 let active=state
 while(active.length){
  // One statement per read size: each part's next matches after its frontier.
  const sizes=[...new Set(active.map(part=>part.q))]
  const results=await m.db.batch(sizes.map(q=>{
   const listed=active.filter(part=>part.q===q).map(part=>[part.project,part.block,part.frontier??null,part.category??null])
   return m.db.prepare(`SELECT p.key i,(SELECT json_group_array(id) FROM (SELECT e.conversation_id id FROM ${index} WHERE e.project_id=p.value->>0 AND ${blockOf('e',m.column)}=p.value->>1${m.categories?" AND e.status_category=p.value->>3":''} AND (p.value->>2 IS NULL OR e.conversation_id${descending?'<':'>'}p.value->>2) AND ${filter.sql} ORDER BY e.conversation_id ${descending?'DESC':'ASC'} LIMIT ${q})) ids FROM json_each(?) p`).bind(...filter.params,JSON.stringify(listed))
  }))
  sizes.forEach((q,s)=>{
   const listed=active.filter(part=>part.q===q)
   for(const row of results[s].results as {i:number;ids:string}[]){
    const part=listed[row.i],ids=JSON.parse(row.ids) as string[]
    found.push(...ids)
    if(ids.length)part.frontier=ids.at(-1)
    if(ids.length<q)part.done=true
   }
  })
  const live=state.filter(part=>!part.done)
  found.sort((x,y)=>descending?-compareValues(x,y):compareValues(x,y))
  // Every match up to the earliest frontier is read (each block's unread rows lie past its own): the page is there once
  // that holds `reach` of them.
  const earliest=live.reduce<string|undefined>((first,part)=>first===undefined||before(part.frontier!,first)?part.frontier!:first,undefined)
  const complete=earliest===undefined?found.length:found.filter(id=>!before(earliest,id)).length
  if(complete>=reach||!live.length)break
  // The block with the earliest frontier reads all the matches still missing (when ids follow time it holds them).
  // Once a page's worth is read, every block whose frontier lies before its last match may hold earlier ones and reads
  // its share.
  const provisional=found.length>=reach?found[reach-1]:undefined,missing=reach-complete
  active=live.filter(part=>part.frontier===earliest||provisional!==undefined&&before(part.frontier!,provisional))
  for(const part of active)part.q=part.frontier===earliest?missing:Math.ceil(missing/active.length)+1
 }
 return found.slice(m.offset,reach)
}
