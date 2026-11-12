import type { Row } from './types'
import {sqlName,identity,byteSlices,jsonBytes} from './d1'
import {identityTables} from './delta-scope'
// What a delta write must not break beyond its own key: the target table's other unique indexes, and its foreign keys.
// Both are read from the seed's schema, so every table a delta writes is guarded without a list of tables
// (README "Delta sweeps" names each index and why). Identity and authority tables are only appended and are
// not guarded here: a delta never updates them, and their append-path clashes are reported, not changed.

interface Unique {table:string;columns:string[]}
interface Reference {columns:string[];table:string;to:string[]}
interface Shape {unique:Unique[];references:Reference[]}
export interface Clash {columns:string[];reason:string}
interface Written {table:string;key:string[];row:Row}

const shapes=new WeakMap<D1Database,Map<string,Shape>>()
/** Full unique indexes on named columns other than the primary key, and foreign keys, of `table` (once per database). */
async function shapeOf(db:D1Database,table:string):Promise<Shape>{
 const cached=shapes.get(db)??new Map<string,Shape>();shapes.set(db,cached)
 let shape=cached.get(table)
 if(shape)return shape
 const unique:Unique[]=[],references=new Map<number,Reference>()
 for(const index of (await db.prepare(`PRAGMA index_list(${sqlName(table)})`).all<{name:string;unique:number;origin:string;partial:number}>()).results){
  if(!index.unique||index.partial||index.origin==='pk')continue
  const columns=(await db.prepare(`PRAGMA index_info("${index.name.replaceAll('"','""')}")`).all<{seqno:number;name:string|null}>()).results.sort((a,b)=>a.seqno-b.seqno).map(c=>c.name)
  // An index on an expression cannot be matched from mapped values; no table a delta writes has one.
  if(columns.length&&columns.every((c):c is string=>typeof c==='string'))unique.push({table,columns})
 }
 const primary=async(parent:string)=>(await db.prepare(`PRAGMA table_info(${sqlName(parent)})`).all<{name:string;pk:number}>()).results.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name)
 for(const fk of (await db.prepare(`PRAGMA foreign_key_list(${sqlName(table)})`).all<{id:number;seq:number;table:string;from:string;to:string|null}>()).results.sort((a,b)=>a.id-b.id||a.seq-b.seq)){
  const reference=references.get(fk.id)??{columns:[],table:fk.table,to:[]};references.set(fk.id,reference)
  reference.columns.push(fk.from);if(fk.to)reference.to.push(fk.to)
 }
 for(const reference of references.values())if(reference.to.length!==reference.columns.length)reference.to=await primary(reference.table)
 shape={unique,references:[...references.values()]};cached.set(table,shape)
 return shape
}

const complete=(row:Row,columns:string[])=>columns.every(c=>row[c]!==undefined&&row[c]!==null)
const tupleId=(index:Unique,row:Row)=>identity(`${index.table}(${index.columns.join(',')})`,index.columns.map(c=>row[c]))
const keyOf=(key:string[],row:Row)=>key.map(k=>row[k]).join(':')

/** Rows of `table` whose `columns` tuple is listed, with their `select` columns, through the index on those columns. */
async function rowsWith(db:D1Database,table:string,columns:string[],select:string[],tuples:unknown[][]){
 const found:Row[]=[]
 for(const part of byteSlices(tuples,jsonBytes,100))found.push(...(await db.prepare(`SELECT ${[...new Set([...select,...columns])].map(sqlName).join(',')} FROM ${sqlName(table)} WHERE (${columns.map(sqlName).join(',')}) IN (SELECT ${columns.map((_,i)=>`json_extract(value,'$[${i}]')`).join(',')} FROM json_each(?))`).bind(JSON.stringify(part)).all<Row>()).results)
 return found
}

/** Decides, for the rows a chunk would write (each as it would stand after the write), whether a unique index
 * of its table already holds the same values on a different row, and whether a row it references exists. It reads
 * the seed once per chunk, then records what each applied decision writes, so two rows of one delta cannot take
 * the same value and a row may reference one appended earlier in the chunk. A value is never treated as freed:
 * a batch runs its inserts before its updates, so a release later in the same delta cannot make room. */
export async function readGuard(db:D1Database,rows:Written[],options:{identityIndexes?:boolean}={}){
 const tables=[...new Set(rows.map(r=>r.table))],shape=new Map<string,Shape>()
 for(const table of tables)shape.set(table,await shapeOf(db,table))
 const guarded=(table:string,key:string[])=>identityTables.has(table)&&!options.identityIndexes?[]:shape.get(table)!.unique.filter(index=>!key.every(k=>index.columns.includes(k)))
 const holders=new Map<string,string>(),present=new Set<string>()
 for(const table of tables){
  const ofTable=rows.filter(r=>r.table===table),key=ofTable[0].key
  for(const index of guarded(table,key)){
   const tuples=[...new Map(ofTable.filter(r=>complete(r.row,index.columns)).map(r=>[tupleId(index,r.row),index.columns.map(c=>r.row[c])])).values()]
   for(const holder of await rowsWith(db,table,index.columns,key,tuples))holders.set(tupleId(index,holder),keyOf(key,holder))
  }
  for(const reference of shape.get(table)!.references){
   const tuples=[...new Map(ofTable.filter(r=>complete(r.row,reference.columns)).map(r=>{const values=reference.columns.map(c=>r.row[c]);return [identity(reference.table,values),values]})).values()]
   for(const found of await rowsWith(db,reference.table,reference.to,reference.to,tuples))present.add(identity(reference.table,reference.to.map(c=>found[c])))
  }
 }
 return {
  /** The first guarded index whose values `row` (keyed `key`) would take from a different row. */
  clash(table:string,key:string[],row:Row):Clash|undefined{
   const own=keyOf(key,row)
   for(const index of guarded(table,key)){
    if(!complete(row,index.columns))continue
    const holder=holders.get(tupleId(index,row))
    if(holder!==undefined&&holder!==own)return {columns:index.columns,reason:`unique ${table}(${index.columns.join(',')}): held by ${table} ${holder}`}
   }
   return undefined
  },
  /** Why `row` cannot be written: a row it references (through `changed` columns, or all) is in neither the seed, this
   * delta's earlier writes nor `own` (identities the same decision appends). */
  missing(table:string,row:Row,own:Set<string>,changed?:string[]):string|undefined{
   for(const reference of shape.get(table)!.references){
    if(!complete(row,reference.columns)||changed&&!reference.columns.some(c=>changed.includes(c)))continue
    const values=reference.columns.map(c=>row[c])
    if(!present.has(identity(reference.table,values))&&!own.has(identity(reference.table,values)))return `references ${reference.table} ${values.join(':')}, which the seed does not hold`
   }
   return undefined
  },
  /** Record a row a decision writes: its key is present and its unique values are held. */
  take(table:string,key:string[],row:Row){
   present.add(identity(table,key.map(k=>row[k])))
   for(const index of guarded(table,key))if(complete(row,index.columns)&&!holders.has(tupleId(index,row)))holders.set(tupleId(index,row),keyOf(key,row))
  },
 }
}
export type Guard=Awaited<ReturnType<typeof readGuard>>
