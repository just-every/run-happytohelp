import {Buffer} from 'node:buffer'
import type {TargetEffect} from '../../import-kit/src/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {legacyTargets,LEGACY_TARGET,targetId,type LegacyValue} from './targets'
import {unitCompare,unitHash,unitRefusal} from './unit-graph'

/** Inspect the actual adapter's inert SQL description, never execute it. This
 * describes its two persistent rows, rather than counting an effect as one row.
 * Origin revisions are kit-assigned journal metadata: reserve their SHA-256
 * width but fingerprint only the source-derived origin fields. */
export function legacyUnitNative(effects:readonly TargetEffect[],destination:string){
 return effects.flatMap(effect=>{
  const value=effect.value as unknown as LegacyValue
  if(effect.targetKind!==LEGACY_TARGET||effect.targetId!==targetId(value.table,value.row)||value.row.project_id!==undefined&&value.row.project_id!==destination)return unitRefusal('A native projection has a foreign destination or identity.')
  const revision=unitHash([]),writes=legacyTargets.write({...effect,destination,revision}),persistent=writes.filter(write=>/^INSERT INTO (?!legacy_door_native_fence)/.test(write.sql))
  if(persistent.length!==2)return unitRefusal('The installed native adapter has an unsupported physical expansion.')
  return persistent.map(write=>{
   const match=/^INSERT INTO "?([a-z][a-z0-9_]*)"?\(([^)]+)\)/.exec(write.sql)
   if(!match||!write.params)return unitRefusal('The installed native storage description is unsupported.')
   const table=match[1],names=match[2].split(',').map(name=>name.replaceAll('"','')),image=Object.fromEntries(names.map((name,i)=>[name,write.params![i]]))
   let metadataBytes=0
   if(table==='legacy_door_targets'){if(image.revision!==revision)return unitRefusal('The native origin revision is unsupported.');image.revision='';metadataBytes=revision.length}
   else if(table!==value.table)return unitRefusal('The installed native adapter writes an unrecognized table.')
   const blobBytes=table==='legacy_door_blob_chunks'?Buffer.from(String(image.base64),'base64').length:0
   return {table,key:table==='legacy_door_targets'?canonicalJson([destination,effect.targetId]):effect.targetId,valueHash:unitHash(image),storedBytes:Buffer.byteLength(canonicalJson(image))+metadataBytes,blobBytes}
  })
 }).sort((a,b)=>unitCompare(a.table,b.table)||unitCompare(a.key,b.key))
}
