import {preflightNativeBounds} from './bounds'
import {preflightConstraints} from './constraints'
import type {D1Database} from '../../import-kit/src/d1/types'
import type {TargetEffect} from '../../import-kit/src/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {DoorError} from '../../import-kit/src/door/protocol'
import {keys,quote,type LegacyTable} from './schema'
import {targetId,type LegacyValue} from './targets'

/** Whole-projection admission, before the kit persists a plan or any business
 * row. Queries follow table/relationship shapes, never the row count. */
export async function preflightLegacy(db:D1Database,destination:string,effects:TargetEffect[],maxRecords:number){
 await preflightNativeBounds(db,destination,effects,maxRecords)
 const byTable=new Map<LegacyTable,LegacyValue[]>()
 for(const effect of effects){const value=effect.value as unknown as LegacyValue,rows=byTable.get(value.table)??[];rows.push(value);byTable.set(value.table,rows)}
 for(const [table,values] of byTable){
  await preflightConstraints(db,table,values)
  const wanted=values.map(value=>({id:targetId(table,value.row),key:keys[table].map(key=>value.row[key])}))
  for(let start=0;start<wanted.length;start+=1000){
   const conflict=await db.prepare(`SELECT 1 FROM json_each(?1) wanted CROSS JOIN ${quote(table)} t ON ${keys[table].map((key,i)=>`t.${quote(key)} IS json_extract(wanted.value,'$.key[${i}]')`).join(' AND ')} WHERE NOT EXISTS(SELECT 1 FROM legacy_door_targets o WHERE o.project_id=?2 AND o.target_id=json_extract(wanted.value,'$.id')) LIMIT 1`).bind(canonicalJson(wanted.slice(start,start+1000)),destination).first()
   if(conflict)throw new DoorError('legacy_native_identity_conflict',409,{reason:'A complete native projection collides with data outside this legacy lineage.'})
  }
  const foreign=(await db.prepare(`PRAGMA foreign_key_list(${quote(table)})`).all<{id:number;seq:number;table:string;from:string;to:string|null}>()).results,groups=new Map<number,typeof foreign>()
  for(const fk of foreign){const group=groups.get(fk.id)??[];group.push(fk);groups.set(fk.id,group)}
  for(const group of groups.values()){
   group.sort((a,b)=>a.seq-b.seq);const parent=group[0].table
   // SQLite's implicit parent key is obtained from the actual destination schema.
   const parentColumns=(await db.prepare(`PRAGMA table_info(${quote(parent)})`).all<{name:string;pk:number}>()).results,implicit=group.some(fk=>fk.to===null)?parentColumns.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>c.name):[],scope=parent==='projects'?' AND p.id=?2':parentColumns.some(c=>c.name==='project_id')?' AND p.project_id=?2':parent==='knowledge_versions'?' AND EXISTS(SELECT 1 FROM knowledge_datasets d WHERE d.id=p.dataset_id AND d.project_id=?2)':''
   const refs=values.map(value=>group.map(fk=>value.row[fk.from])).filter(row=>row.every(value=>value!==null&&value!==undefined)),unique=new Map(refs.map(row=>[canonicalJson(row),row]))
   const proposed=new Set((byTable.get(parent as LegacyTable)??[]).map(value=>canonicalJson(group.map((fk,i)=>value.row[fk.to??implicit[i]])))),pending=[...unique.values()].filter(ref=>!proposed.has(canonicalJson(ref)))
   for(let start=0;start<pending.length;start+=1000){const absent=await db.prepare(`SELECT 1 FROM json_each(?) reference WHERE NOT EXISTS(SELECT 1 FROM ${quote(parent)} p WHERE ${group.map((fk,i)=>`p.${quote(fk.to??implicit[i])} IS json_extract(reference.value,'$[${i}]')`).join(' AND ')}${scope}) LIMIT 1`).bind(canonicalJson(pending.slice(start,start+1000)),...(scope?[destination]:[])).first();if(absent)throw new DoorError('legacy_native_relationship_missing',422,{reason:'A native relationship is absent from the complete source and destination.'})}
  }
 }
}
