import {clauses,type Clause} from './inbox-entries'
import {exact,sortRows} from './inbox-order'

/** A page whose entries must satisfy a time bound, in an order led by another time (the inbox order, or a custom
 * sort led by updated_at or created_at): migration 319's week indexes hold the order's week (monotonic in the order's
 * own value) and then the bound's time, so reading the order a few weeks at a time reads only the entries inside the
 * bound. Every entry of each week read is collected, so ordering them gives the page exactly, whatever the weeks hold. */
export type Week='sort'|'updated'|'created'
const expression:Record<Week,string>={
 sort:"(CASE WHEN typeof(e.sort_at) IN ('integer','real') THEN CAST(e.sort_at/604800000 AS INTEGER) END)",
 updated:'CAST(CAST(e.updated_at AS REAL)/604800000 AS INTEGER)',
 created:'CAST(CAST(e.created_at AS REAL)/604800000 AS INTEGER)',
}
const raw:Record<Week,string>={sort:'e.sort_at',updated:'e.updated_at',created:'e.created_at'}
export interface WeekWalk {db:D1Database;projects:string[];pin?:{column:'group_id'|'status_category';value:unknown};week:Week;bound:'created_at'|'updated_at';direction:'asc'|'desc';list:Clause[];keys:{sql:string;params:unknown[];direction:'asc'|'desc'}[];order:{sql:string;params:unknown[]};offset:number}
export async function weekPage(w:WeekWalk){
 // A role that sees one group, or a page of one status category, reads only its weeks (the inbox order only).
 const index=`inbox_entries e INDEXED BY inbox_entries_${w.pin?w.pin.column.replace('_id','')+'_':''}${w.week}_week_${w.bound}`,week=expression[w.week]
 const all=[...w.keys,{sql:'e.conversation_id',params:[],direction:'desc' as const}],need=w.offset+30,descending=w.direction==='desc'
 const rows:Record<string,unknown>[]=[]
 // Each workspace is read on its own (its weeks are one index range): its first `need` matches in the order, and the
 // rest of the week the last of them falls in, outrank every entry it leaves unread.
 for(const project of w.projects){
  const own:Clause[]=[{sql:'e.project_id=?',params:[project]},...(w.pin?[{sql:`e.${w.pin.column}=?`,params:[w.pin.value]}]:[])]
  const read=async(segment:Clause,limit?:number)=>{
   const filter=clauses([...own,segment,...w.list])
   const direction=descending?'DESC':'ASC'
   return (await w.db.prepare(`SELECT e.conversation_id id,${week} wk,CAST(e.${w.bound} AS REAL) bv,${all.map((key,i)=>`${key.sql} k${i}`).join(',')} FROM ${index} WHERE ${filter.sql}${limit===undefined?'':` ORDER BY ${week} ${direction},CAST(e.${w.bound} AS REAL) ${direction} LIMIT ?`}`).bind(...all.flatMap(key=>key.params),...filter.params,...(limit===undefined?[]:[limit])).all<Record<string,unknown>>()).results
  }
  const ends=await w.db.prepare(`SELECT (SELECT ${week} FROM ${index} WHERE ${clauses(own).sql} AND ${week} IS NOT NULL ORDER BY ${week} DESC LIMIT 1) high,(SELECT ${week} FROM ${index} WHERE ${clauses(own).sql} AND ${week} IS NOT NULL ORDER BY ${week} ASC LIMIT 1) low`).bind(...clauses(own).params,...clauses(own).params).first<{high:number|null;low:number|null}>()
  // A value the weeks do not hold sorts above every week (text in the inbox order) or below it (no value).
  const unweeked=(present:boolean)=>({sql:`${week} IS NULL AND ${raw[w.week]} IS ${present?'NOT ':''}NULL`,params:[]})
  const found:Record<string,unknown>[]=[]
  if(descending?w.week==='sort':true)found.push(...await read(unweeked(descending)))
  if(ends?.high!=null&&ends.low!=null){
   // The weeks in the order, a bounded list at a time, read in that order until enough match.
   for(let from=descending?ends.high:ends.low;found.length<need&&(descending?from>=ends.low:from<=ends.high);from+=descending?-256:256){
    const weeks=Array.from({length:256},(_,i)=>descending?from-i:from+i).filter(value=>value>=ends.low!&&value<=ends.high!)
    const got=await read({sql:`${week} IN (SELECT value FROM json_each(?))`,params:[JSON.stringify(weeks)]},need-found.length)
    found.push(...got)
    if(found.length>=need){
     // The rest of the last week: its entries from the last one read on, in the index's order.
     const last=got[got.length-1],seen=new Set(found.map(row=>row.id))
     found.push(...(await read({sql:`${week}=? AND CAST(e.${w.bound} AS REAL) ${descending?'<=':'>='} ?`,params:[last.wk,last.bv]})).filter(row=>!seen.has(row.id)))
    }
   }
  }
  if(found.length<need&&(descending?true:w.week==='sort'))found.push(...await read(unweeked(!descending)))
  rows.push(...found.map(({wk,bv,...row})=>row))
 }
 if(rows.length<=w.offset)return []
 if(rows.every(row=>Object.values(row).every(exact)))return sortRows(rows,all.map(key=>key.direction)).slice(w.offset,need).map(row=>String(row.id))
 const ids=JSON.stringify(rows.map(row=>row.id))
 return (await w.db.prepare(`SELECT e.conversation_id id FROM inbox_entries e WHERE e.conversation_id IN (SELECT value FROM json_each(?)) ORDER BY ${w.order.sql} LIMIT 30 OFFSET ?`).bind(ids,...w.order.params,w.offset).all<{id:string}>()).results.map(row=>String(row.id))
}
