import {DoorError} from '../../import-kit/src/door/protocol'
import {Buffer} from 'node:buffer'
import type {D1TargetAdapter,D1Database,D1Sql} from '../../import-kit/src/d1/types'
import type {Json,TargetRow} from '../../import-kit/src/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {columns,keys,quote,tableName,type LegacyTable} from './schema'
import type {Row} from '../types'

export const LEGACY_TARGET='legacy-native'
export interface LegacyValue {table:LegacyTable;columns:string[];generated:string[];row:Row;source:{table:string;id:string;project?:string}}
export const targetId=(table:LegacyTable,row:Row)=>table+':'+encodeURIComponent(canonicalJson(keys[table].map(key=>row[key])))
function identity(id:string){const colon=id.indexOf(':'),table=tableName(id.slice(0,colon));let values:any;try{values=JSON.parse(decodeURIComponent(id.slice(colon+1)))}catch{throw new Error('legacy_native_identity')}if(!Array.isArray(values)||values.length!==keys[table].length||values.some(v=>typeof v!=='string'&&typeof v!=='number'))throw new Error('legacy_native_identity');return {table,values}}
const where=(table:LegacyTable,alias='')=>keys[table].map(key=>`${alias}${quote(key)} IS ?`).join(' AND ')
const image=(names:readonly string[],alias='')=>'json_array('+names.map(name=>alias+quote(name)).join(',')+')'
function valueOf(row:TargetRow):LegacyValue{const value=row.value as unknown as LegacyValue;if(value.table!==identity(row.targetId).table||targetId(value.table,value.row)!==row.targetId||!value.columns.length||value.columns.some(name=>!Object.hasOwn(value.row,name)))throw new Error('legacy_native_value');return value}
const fenced=(sql:D1Sql[])=>[{sql:'INSERT INTO legacy_door_native_fence VALUES(1)'},...sql,{sql:'DELETE FROM legacy_door_native_fence'}]

async function nativeRow(db:D1Database,destination:string,id:string):Promise<TargetRow|undefined>{
 const {table,values}=identity(id),shape=await columns(db,table),names=shape.map(c=>c.name),row=await db.prepare(`SELECT * FROM ${quote(table)} WHERE ${where(table)}`).bind(...values).first<Row>(),origin=await db.prepare('SELECT revision,source_json FROM legacy_door_targets WHERE project_id=? AND target_id=?').bind(destination,id).first<{revision:string;source_json:string}>()
 if(!row&&!origin)return undefined
 if(!row)throw new DoorError('legacy_native_custody_conflict',409)
 if(row.project_id!==undefined&&row.project_id!==destination)throw new Error('legacy_native_foreign_scope')
 return {destination,targetKind:LEGACY_TARGET,targetId:id,revision:origin?.revision??'native',value:{table,columns:names,generated:shape.filter(c=>c.hidden).map(c=>c.name),row,source:origin?JSON.parse(origin.source_json):{table:'native',id}} as unknown as Json}
}
function matches(row:TargetRow|null,destination:string,_kind:string,id:string):D1Sql{
 const {table,values}=identity(id)
 if(!row){const erased=table==='contacts'?` OR EXISTS(SELECT 1 FROM contacts WHERE ${where(table)} AND project_id=? AND name IS NULL AND email IS NULL AND external_id IS NULL AND is_verified=0 AND json_extract(metadata_json,'$.is_erased')=1)`:'';return {sql:`(NOT EXISTS(SELECT 1 FROM ${quote(table)} WHERE ${where(table)})${erased}) AND NOT EXISTS(SELECT 1 FROM legacy_door_targets WHERE project_id=? AND target_id=?)`,params:[...values,...(erased?[...values,destination]:[]),destination,id]}}
 const v=valueOf(row),native=v.columns.map(c=>v.row[c]??null)
 return {sql:`EXISTS(SELECT 1 FROM ${quote(table)} WHERE ${where(table)} AND ${v.columns.map(c=>`${quote(c)} IS ?`).join(' AND ')}) AND `+(row.revision==='native'?'NOT EXISTS(SELECT 1 FROM legacy_door_targets WHERE project_id=? AND target_id=?)':'EXISTS(SELECT 1 FROM legacy_door_targets WHERE project_id=? AND target_id=? AND revision=? AND source_json=?)'),params:[...values,...native,destination,id,...(row.revision==='native'?[]:[row.revision,canonicalJson(v.source)])]}
}

/** Each effect is exactly one fully described native row, including every byte
 * chunk. No R2 effect, hidden write engine or per-record native-set inventory. */
export const legacyTargets:D1TargetAdapter={
 read:async(db,destination,_kind,id)=>nativeRow(db,destination,id),matches,
 write(row){const v=valueOf(row),names=v.columns.filter(c=>!v.generated.includes(c));if(v.row.project_id!==undefined&&v.row.project_id!==row.destination)throw new Error('legacy_native_destination');const updates=names.filter(c=>!(keys[v.table] as readonly string[]).includes(c));return fenced([
  {sql:`INSERT INTO ${quote(v.table)}(${names.map(quote).join(',')}) VALUES(${names.map(()=>'?').join(',')}) ON CONFLICT(${keys[v.table].map(quote).join(',')}) DO UPDATE SET ${updates.length?updates.map(c=>`${quote(c)}=excluded.${quote(c)}`).join(','):keys[v.table].map(c=>`${quote(c)}=excluded.${quote(c)}`).join(',')}`,params:names.map(c=>v.row[c]??null)},
  {sql:'INSERT INTO legacy_door_targets(project_id,target_id,table_name,keys_json,revision,source_json,value_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,target_id) DO UPDATE SET revision=excluded.revision,source_json=excluded.source_json,value_json=excluded.value_json',params:[row.destination,row.targetId,v.table,canonicalJson(keys[v.table].map(k=>v.row[k])),row.revision,canonicalJson(v.source),v.table==='legacy_door_blob_chunks'?canonicalJson(v):null]}
 ])},
 remove(destination,_kind,id){const {table,values}=identity(id);return fenced([{sql:`DELETE FROM ${quote(table)} WHERE ${where(table)}`,params:values},{sql:'DELETE FROM legacy_door_targets WHERE project_id=? AND target_id=?',params:[destination,id]}])},
 async list(db,destination){
  const origins=(await db.prepare('SELECT target_id,table_name,keys_json,revision,source_json FROM legacy_door_targets WHERE project_id=? ORDER BY target_id').bind(destination).all<any>()).results,result:TargetRow[]=[]
  for(const name of [...new Set<string>(origins.map(row=>row.table_name))]){const table=tableName(name),wanted=origins.filter(row=>row.table_name===table),shape=await columns(db,table),names=shape.map(c=>c.name)
   const found=(await db.prepare(`SELECT wanted.key AS legacy_wanted_ordinal,t.* FROM json_each(?) wanted CROSS JOIN ${quote(table)} t ON ${keys[table].map((key,i)=>`t.${quote(key)} IS json_extract(wanted.value,'$[${i}]')`).join(' AND ')}`).bind(canonicalJson(wanted.map(row=>JSON.parse(row.keys_json)))).all<Row>()).results
   const byOrdinal=new Map(found.map(row=>{const {legacy_wanted_ordinal,...value}=row;return [Number(legacy_wanted_ordinal),value]}))
   for(const [i,origin] of wanted.entries()){const row=byOrdinal.get(i);if(!row)throw new DoorError('legacy_native_custody_conflict',409);result.push({destination,targetKind:LEGACY_TARGET,targetId:origin.target_id,revision:origin.revision,value:{table,columns:names,generated:shape.filter(c=>c.hidden).map(c=>c.name),row,source:JSON.parse(origin.source_json)} as unknown as Json})}
  }
  return result
 },
 matchesMany(rows,destination){
  const guards:D1Sql[]=[{sql:'(SELECT COUNT(*) FROM legacy_door_targets WHERE project_id=?)=?',params:[destination,rows.length]}]
  for(const table of Object.keys(keys) as LegacyTable[]){const owned=rows.filter(row=>valueOf(row).table===table)
   guards.push({sql:'(SELECT COUNT(*) FROM legacy_door_targets WHERE project_id=? AND table_name=?)=?',params:[destination,table,owned.length]});if(table==='legacy_door_blob_chunks')guards.push({sql:'(SELECT COUNT(*) FROM legacy_door_blob_chunks WHERE project_id=?)=?',params:[destination,owned.length]});if(!owned.length)continue
   if(table==='legacy_door_blob_chunks'){
    const expected=owned.map(row=>({id:row.targetId,key:identity(row.targetId).values,revision:row.revision,source:valueOf(row).source})),names=valueOf(owned[0]).columns
    guards.push({sql:'(SELECT COUNT(*) FROM legacy_door_blob_chunks WHERE project_id=?)=?',params:[destination,owned.length]})
    guards.push({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM legacy_door_targets o JOIN legacy_door_blob_chunks t ON ${keys[table].map((key,i)=>`t.${quote(key)} IS json_extract(e.value,'$.key[${i}]')`).join(' AND ')} WHERE o.project_id=? AND o.target_id=json_extract(e.value,'$.id') AND o.revision=json_extract(e.value,'$.revision') AND json(o.source_json)=json(json_extract(e.value,'$.source')) AND ${names.map(name=>`t.${quote(name)} IS json_extract(o.value_json,'$.row."${name}"')`).join(' AND ')}))`,params:[canonicalJson(expected),destination]})
    continue
   }
   const values=owned.map(row=>({id:row.targetId,key:identity(row.targetId).values,revision:row.revision,source:valueOf(row).source,image:valueOf(row).columns.map(c=>valueOf(row).row[c]??null)})),names=valueOf(owned[0]).columns
   for(const page of guardPages(values))guards.push({sql:`NOT EXISTS(SELECT 1 FROM json_each(?) e WHERE NOT EXISTS(SELECT 1 FROM legacy_door_targets o WHERE o.project_id=? AND o.target_id=json_extract(e.value,'$.id') AND o.revision=json_extract(e.value,'$.revision') AND json(o.source_json)=json(json_extract(e.value,'$.source'))) OR NOT EXISTS(SELECT 1 FROM ${quote(table)} t WHERE ${keys[table].map((key,i)=>`t.${quote(key)} IS json_extract(e.value,'$.key[${i}]')`).join(' AND ')} AND ${names.map((column,i)=>`t.${quote(column)} IS json_extract(e.value,'$.image[${i}]')`).join(' AND ')}))`,params:[canonicalJson(page),destination]})
  }
  return guards
 }
}

function guardPages<T>(rows:T[]):T[][]{const result:T[][]=[];let page:T[]=[],bytes=2;for(const row of rows){const size=Buffer.byteLength(canonicalJson(row))+1;if(page.length&&bytes+size>512*1024){result.push(page);page=[];bytes=2}page.push(row);bytes+=size}if(page.length)result.push(page);return result}
