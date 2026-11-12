import {refuse} from './errors'
/** Gate aggregate JSON bytes in D1 before allocating an ancestor/history page
 * in the Worker. A LIMIT alone does not bound rows that may each be 2 MiB. */
export async function jsonRows<T extends {row_json:string}>(db:D1Database,sql:string,params:unknown[],fields:string[]=['row_json'],maxRows=250,maxBytes=2097152){
 if(fields.some(field=>!/^\w+$/.test(field)))throw new Error('Invalid internal context projection')
 const count=Math.max(0,Math.floor(maxRows)),bytes=Math.max(0,Math.floor(maxBytes))
 const projection=fields.map(field=>field==='row_json'?`CASE WHEN stats.bytes<=${bytes} AND stats.n<=${count} THEN bounded.row_json ELSE NULL END row_json`:`bounded."${field}"`).join(',')
 const result=await db.prepare(`WITH bounded AS MATERIALIZED (SELECT * FROM (${sql}) LIMIT ${count+1}),stats AS (SELECT coalesce(sum(length(CAST(row_json AS BLOB))),0) bytes,count(*) n FROM bounded) SELECT ${projection},stats.bytes bounded_bytes,stats.n bounded_rows FROM bounded CROSS JOIN stats`).bind(...params).all<T&{bounded_bytes:number;bounded_rows:number}>()
 if(result.results.some(row=>row.bounded_bytes>bytes||row.bounded_rows>count))refuse('row_too_large')
 return result
}
