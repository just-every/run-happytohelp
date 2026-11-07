import type { Row } from './types'
// D1 statement shapes shared by full and delta imports. Rows travel as one JSON array
// value per statement, so no statement nears D1's 100 bound parameters or 100 KB of SQL.
export const sqlName=(value:string)=>{if(!/^[a-z][a-z0-9_]*$/.test(value))throw new Error('Unsafe table or column name');return '"'+value+'"'}
// D1 limits a bound value to 2 MB. A group binds at most 1.25 MB in any one of its
// JSON parameters; a single source row too large for that is refused by insertJson.
export const groupBytes=1_250_000,parameterBytes=2_000_000
const utf8=new TextEncoder()
export const jsonBytes=(value:unknown)=>utf8.encode(JSON.stringify(value)).length
export const identity=(table:string,values:unknown[])=>table+'\u0000'+JSON.stringify(values)
export function groupBy<T,V>(items:T[],key:(item:T)=>string,value:(item:T)=>V){const groups=new Map<string,V[]>();for(const item of items){const k=key(item);if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(value(item))}return groups}
/** Consecutive groups of at most groupBytes (by `size`) and, when given, `maxItems` items. */
export function byteSlices<T>(items:T[],size:(item:T)=>number,maxItems=Infinity){const result:T[][]=[];let part:T[]=[],bytes=0;for(const item of items){const n=size(item);if(part.length&&(bytes+n>groupBytes||part.length>=maxItems)){result.push(part);part=[];bytes=0}part.push(item);bytes+=n}if(part.length)result.push(part);return result}
export function insertJson(db:D1Database,into:string,width:number,rows:unknown[][]){const json=JSON.stringify(rows);if(utf8.encode(json).length>parameterBytes)throw new Error('Legacy import group exceeds the D1 bound value limit');return db.prepare(`${into} SELECT ${Array.from({length:width},(_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?)`).bind(json)}
/** Rows matching a JSON array of key tuples, through the key's index. */
export function selectJson(db:D1Database,table:string,keys:string[],tuples:unknown[][]){return db.prepare(`SELECT * FROM ${sqlName(table)} WHERE (${keys.map(sqlName).join(',')}) IN (SELECT ${keys.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?))`).bind(JSON.stringify(tuples))}
/** Every row of `table` whose key tuple is listed, keyed by identity; null where none exists. */
export async function lookupRows(db:D1Database,table:string,keys:string[],tuples:unknown[][],into=new Map<string,Row|null>()){
 for(const part of byteSlices(tuples,jsonBytes)){
  const found=await selectJson(db,table,keys,part).all<Row>()
  for(const values of part)if(!into.has(identity(table,values)))into.set(identity(table,values),null)
  for(const row of found.results)into.set(identity(table,keys.map(k=>row[k])),row)
 }
 return into
}
const schemaCache=new WeakMap<D1Database,Map<string,Set<string>>>()
export async function targetSchemas(db:D1Database,tables:string[]){
 const schemas=schemaCache.get(db)??new Map<string,Set<string>>();schemaCache.set(db,schemas)
 for(const table of new Set(tables))if(!schemas.has(table)){const schema=await db.prepare(`PRAGMA table_info(${sqlName(table)})`).all<{name:string}>();if(!schema.results.length)throw new Error(`Target migration missing: ${table}`);schemas.set(table,new Set(schema.results.map(c=>c.name)))}
 return schemas
}
