import {Buffer} from 'node:buffer'
import type {D1Database} from '../../import-kit/src/d1/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {DoorError} from '../../import-kit/src/door/protocol'
import {keys,quote,type LegacyTable} from './schema'
import type {LegacyValue} from './targets'
import type {Row} from '../types'

function pages<T>(values:T[]){const result:T[][]=[];let page:T[]=[],bytes=2;for(const value of values){const n=Buffer.byteLength(canonicalJson(value))+1;if(page.length&&bytes+n>512*1024){result.push(page);page=[];bytes=2}page.push(value);bytes+=n}if(page.length)result.push(page);return result}
/** Trusted destination DDL, not source-selected expressions. */
function checks(sql:string){const result:string[]=[];for(const match of sql.matchAll(/\bCHECK\s*\(/gi)){let depth=1,quoteChar='',end=match.index!+match[0].length;const start=end;for(;end<sql.length&&depth;end++){const c=sql[end];if(quoteChar){if(c===quoteChar){if(sql[end+1]===c)end++;else quoteChar=''}}else if(c==="'"||c==='"'||c==='`')quoteChar=c;else if(c==='(')depth++;else if(c===')')depth--}if(depth)throw new Error('legacy_native_check_schema');result.push(sql.slice(start,end-1))}return result}
const projection=(names:readonly string[])=>names.map(name=>`json_extract(wanted.value,'$."${name}"') AS ${quote(name)}`).join(',')
export async function preflightConstraints(db:D1Database,table:LegacyTable,values:LegacyValue[]){
 const rows=values.map(value=>value.row),schema=await db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").bind(table).first<{sql:string}>(),expressions=checks(schema?.sql??'')
 if(expressions.length)for(const part of pages(rows)){const bad=await db.prepare(`WITH proposed AS (SELECT ${projection(values[0].columns)} FROM json_each(?) wanted) SELECT 1 FROM proposed WHERE ${expressions.map(expression=>`CAST((${expression}) AS NUMERIC)=0`).join(' OR ')} LIMIT 1`).bind(canonicalJson(part)).first();if(bad)throw new DoorError('legacy_native_constraint_conflict',422,{table,reason:'A complete native projection fails the destination schema constraints.'})}
 const indexes=(await db.prepare(`PRAGMA index_list(${quote(table)})`).all<{name:string;unique:number;partial:number}>()).results
 for(const index of indexes.filter(index=>index.unique)){
  const columns=(await db.prepare(`PRAGMA index_xinfo(${quote(index.name)})`).all<{name:string|null;key:number;coll:string}>()).results.filter(column=>column.key)
  if(columns.some(column=>column.name===null))throw new DoorError('legacy_native_unique_index_unsupported',422)
  const names=columns.map(column=>column.name!)
  if(canonicalJson(names)===canonicalJson(keys[table]))continue
  const definition=index.partial?(await db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND name=?").bind(index.name).first<{sql:string}>())?.sql:undefined,predicate=definition?.match(/\bWHERE\s+([\s\S]*)$/i)?.[1],fields=predicate?values[0].columns.filter(name=>new RegExp('\\b'+name+'\\b').test(predicate)):[]
  const needed=[...new Set([...keys[table],...names,...fields])],projected=rows.map(row=>Object.fromEntries(needed.map(name=>[name,row[name]]))),active:Row[]=[]
  for(const part of pages(projected)){if(!predicate)active.push(...part);else {const selected=(await db.prepare(`WITH proposed AS (SELECT wanted.key AS legacy_index,${projection(needed)} FROM json_each(?) wanted) SELECT legacy_index FROM proposed WHERE ${predicate}`).bind(canonicalJson(part)).all<{legacy_index:number}>()).results;active.push(...selected.map(item=>part[item.legacy_index]))}}
  const seen=new Set<string>()
  for(const row of active){const key=names.map((name,i)=>{const value=row[name];return typeof value==='string'&&columns[i].coll==='NOCASE'?value.replace(/[A-Z]/g,c=>c.toLowerCase()):typeof value==='string'&&columns[i].coll==='RTRIM'?value.replace(/ +$/,''):value});if(key.some(value=>value===null))continue;const encoded=canonicalJson(key);if(seen.has(encoded))throw new DoorError('legacy_native_unique_conflict',409);seen.add(encoded)}
  for(const part of pages(active.filter(row=>names.every(name=>row[name]!==null)))){const bad=await db.prepare(`SELECT 1 FROM json_each(?) wanted CROSS JOIN ${quote(table)} native ON ${names.map(name=>`native.${quote(name)} IS json_extract(wanted.value,'$."${name}"')`).join(' AND ')} WHERE NOT (${keys[table].map(name=>`native.${quote(name)} IS json_extract(wanted.value,'$."${name}"')`).join(' AND ')})${predicate?` AND (${predicate})`:''} LIMIT 1`).bind(canonicalJson(part)).first();if(bad)throw new DoorError('legacy_native_unique_conflict',409,{reason:'A native unique identity conflicts with the complete source projection.'})}
 }
}
