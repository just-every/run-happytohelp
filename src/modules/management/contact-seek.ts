import {contactLive,contactSearchable,contactSorts,type ContactQuery} from './contact-order'
import {keyOrder,orderable,type Keyed} from './contact-key-order'
import {keyedMatches,matchQuery} from './contact-matches'

/** Contacts a walk reads before it gives up without a match (a band's walk, and the matches a band is read for
 * before it is walked); a walk starts at twice the rows it needs and goes on only while its matches so far say the
 * rest is within reach. */
const WALK=600,BAND_WALK=150,WALK_MOST=2000,BAND_WALK_MOST=600
/** Bands found and asked about per round. */
const BANDS=48
type Walked=Keyed&{matched:number}
type Band={key:string;band:string;level:number}
/** The matches found (fewer than asked when the order ends) and the rows read, the rows read when the budget ran
 * out first, or undefined when a key is of another type than its sort's (SQLite's own order must then sort them). */
export type Seek={found:Keyed[];spent:number}|{over:number}|undefined

/** Binds only the parameters a statement names (D1 refuses more values than its highest ?NNN). */
const bound=(sql:string,params:unknown[])=>params.slice(0,Math.max(0,...Array.from(sql.matchAll(/\?(\d+)/g),match=>Number(match[1]))))

/** A term's matches past a position in the page's order (or from its start), forward or against it, without reading
 * every match. A walk of the contacts a term can match finds them where they are dense, and goes on while the
 * matches it meets say the rest of the page is within reach. Where they are sparse the term's bands take over
 * (contact-bands.ts): each band past the walk is found with one index step and asked of contact_search for a match,
 * so a stretch without matches costs about two rows a band whatever its contacts. A band holding few matches is read
 * whole with their keys (one row a match, ordered here); one holding many is walked, and where its matches are
 * sparse in it, split into the finer bands of the next level the same way. `budget` bounds the rows read. */
export async function seekMatches(q:ContactQuery,from:Keyed|null,forward:boolean,need:number,budget=Infinity):Promise<Seek>{
 const sort=contactSorts[q.sort],{key,integer,bands}=sort,index=sort.searchable[q.direction],order=keyOrder(integer,q.direction)
 const where=`project_id=?1 AND ${contactLive.sql} AND ${contactSearchable.sql}`,value=(n:number)=>integer?`CAST(?${n} AS INTEGER)`:`?${n}`
 const up=(q.direction==='asc')===forward,byKey=`${key} ${up?'ASC':'DESC'},id ${forward?'ASC':'DESC'}`
 const past=(mark:Keyed)=>(row:Keyed)=>(forward?1:-1)*order.compare(row,mark)>0
 const ordered=(rows:Keyed[])=>{const listed=order.sort(rows);return forward?listed:listed.reverse()}
 const keyed=({id,type,key}:Keyed):Keyed=>({id,type,key})
 const all=async<T>(sql:string,params:unknown[])=>(await q.db.prepare(sql).bind(...bound(sql,params)).all<T>()).results

 // Up to `limit` contacts in order: from `at` inclusive of its key (a band's first key), or past `at` (its ties past
 // its id, then the keys past it), or from the start; within a band if given.
 const term=q.term!
 const read=(range:string,orderBy:string,limit:number,k:string|null,id:string|null,within?:Band)=>{
  const sql=`SELECT id,typeof(${key}) type,CAST(${key} AS TEXT) key,(${term.sql.replace(/\?/g,'?2')}) matched FROM contacts INDEXED BY ${index} WHERE ${where}${range}${within?` AND ${bands.within(value(7),'?6',within.level,up)}`:''} ORDER BY ${orderBy} LIMIT ?5`
  return all<Walked>(sql,[q.projectId,term.params[0],k,id,limit,within?.band,within?.key])
 }
 const step=async(at:{key:string;id?:string}|null,limit:number,wanted:number,within?:Band):Promise<Walked[]>=>{
  if(!at)return read('',byKey,limit,null,null,within)
  if(at.id===undefined)return read(` AND ${key}${up?'>=':'<='}${value(3)}`,byKey,limit,at.key,null,within)
  const tied=await read(` AND ${key}=${value(3)} AND id${forward?'>':'<'}?4`,`id ${forward?'ASC':'DESC'}`,limit,at.key,at.id,within)
  if(tied.length===limit||tied.filter(row=>row.matched).length>=wanted)return tied
  return [...tied,...await read(` AND ${key}${up?'>':'<'}${value(3)}`,byKey,limit-tied.length,at.key,null,within)]
 }
 const found:Keyed[]=[]
 let spent=0
 // Walks from `start`, appending its matches: 'done' when the page or the stretch ends, else the last contact walked
 // once the matches met say walking on would cost more than `reach` rows.
 const walk=async(start:{key:string;id?:string}|null,first:number,reach:number,within?:Band):Promise<Walked|'done'|undefined>=>{
  let at=start,walked=0,met=0,last:Walked|undefined
  for(let limit=Math.min(2*(need-found.length)+20,first,reach);limit>0;){
   const rows=await step(at,limit,need-found.length,within)
   spent+=rows.length;walked+=rows.length
   if(!orderable(rows,integer))return undefined
   const matched=rows.filter(row=>row.matched).map(keyed);met+=matched.length;found.push(...matched)
   if(found.length>=need||rows.length<limit)return 'done'
   last=rows[rows.length-1];at=last
   // Without a match yet the walk widens until it has read `first` contacts.
   if(!met&&walked>=first)break
   limit=met?Math.ceil((need-found.length)*walked/met*1.25)+20:Math.min(3*walked,first-walked)
   if(walked+limit>reach)break
  }
  return last
 }

 // A band's matches past `mark` (all of them without one), from `at` on.
 const bandMatches=async(band:Band,at:{key:string;id?:string},mark?:Keyed):Promise<'read'|'over'|undefined>=>{
  const keep=(rows:Keyed[])=>mark?ordered(rows).filter(past(mark)):ordered(rows),asked={value:band.band,level:band.level}
  // Few matches are read whole.
  const few=await keyedMatches(q,{band:asked,most:BAND_WALK});spent+=few.length
  if(!orderable(few,integer))return undefined
  if(few.length<=BAND_WALK){found.push(...keep(few));return 'read'}
  // Many are walked while they say so (not far where the band can split into finer bands instead).
  const deeper=bands.levels.find(level=>level>band.level),splits=deeper!==undefined&&(integer||Array.from(band.band).length>=band.level)
  const count=found.length,walked=await walk(at,BAND_WALK,Math.max(BAND_WALK,Math.min(splits?BAND_WALK_MOST:Infinity,budget-spent)),band)
  if(walked===undefined||walked==='done')return walked&&'read'
  found.length=count
  // Sparse in a wide band: its finer bands; in one that cannot split (a key shorter than the level, or the last
  // level), read whole.
  if(splits)return stretch(deeper,at,mark,band)
  const most=budget===Infinity?undefined:Math.max(0,budget-spent),rows=await keyedMatches(q,{band:asked,most});spent+=rows.length
  if(most!==undefined&&rows.length>most)return 'over'
  if(!orderable(rows,integer))return undefined
  found.push(...keep(rows));return 'read'
 }
 // The matches from `at` on (past `mark`) through the end of the order, or of the `parent` band: those in the band of
 // `at` at this level, then those in each band past it.
 const stretch=async(level:number,at:{key:string;id?:string},mark:Keyed|undefined,parent?:Band):Promise<'read'|'over'|undefined>=>{
  const own=String((await all<{b:unknown}>(`SELECT ${bands.at(value(1),level)} b`,[at.key]))[0].b)
  const first=await bandMatches({key:at.key,band:own,level},at,mark)
  if(first!=='read')return first
  const stepPast=(k:string,b:string)=>`(SELECT ${key} FROM contacts INDEXED BY ${index} WHERE ${where} AND ${bands.past(k,b,level,up)}${parent?` AND ${bands.within(value(5),'?6',parent.level,up)}`:''} ORDER BY ${key} ${up?'ASC':'DESC'} LIMIT 1)`
  const sql=`WITH RECURSIVE seek(k,n) AS (SELECT ${stepPast(value(2),'?3')},1 UNION ALL SELECT ${stepPast('seek.k',bands.at('seek.k',level))},n+1 FROM seek WHERE seek.k IS NOT NULL AND n<?4) SELECT typeof(k) type,CAST(k AS TEXT) key,${bands.at('k',level)} band FROM seek WHERE k IS NOT NULL`
  let last={key:at.key,band:own}
  while(found.length<need){
   if(spent>budget)return 'over'
   const next=await all<{type:string;key:string;band:string}>(sql,[q.projectId,last.key,last.band,BANDS,parent?.key,parent?.band])
   spent+=next.length
   if(!next.length)break
   if(!orderable(next.map(row=>({...row,id:''})),integer))return undefined
   // Which of them hold a match: one row at most each.
   const holding=(await all<{i:number}>('SELECT CAST(key AS INTEGER) i FROM json_each(?1) WHERE EXISTS(SELECT 1 FROM contact_search WHERE contact_search MATCH json_each.value) ORDER BY i',[JSON.stringify(next.map(row=>matchQuery(q,{value:String(row.band),level})))])).map(row=>row.i)
   spent+=next.length+holding.length
   for(const i of holding){
    if(found.length>=need)break
    if(spent>budget)return 'over'
    const read=await bandMatches({key:next[i].key,band:String(next[i].band),level},{key:next[i].key})
    if(read!=='read')return read
   }
   if(next.length<BANDS)break
   last={key:next[next.length-1].key,band:String(next[next.length-1].band)}
  }
  return 'read'
 }

 const started=await walk(from,WALK,Math.min(WALK_MOST,budget))
 if(started===undefined)return undefined
 if(started!=='done'){const rest=await stretch(bands.levels[0],started,started);if(rest!=='read')return rest&&{over:spent}}
 return {found:found.slice(0,need),spent}
}
