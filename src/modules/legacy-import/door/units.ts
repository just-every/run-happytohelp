import {Buffer} from 'node:buffer'
import type {D1Database} from '../../import-kit/src/d1/types'
import type {DoorPackageFile,ImportDoorPackageUpload} from '../../import-kit/src/door/types'
import type {ReaderLimits} from '../../import-kit/src/types'
import {canonicalJson} from '../../import-kit/src/provenance/identity'
import {limitsFor} from '../../import-kit/src/readers/records'
import {DoorError} from '../../import-kit/src/door/protocol'
import {prepareLegacy,recordKey,type PreparedLegacy} from './bridge'
import {decodeLegacy,type DecodedLegacy} from './format'
import {LEGACY_LIMITS} from './limits'
import {legacyUnitDependencies,type LegacyUnitDependencies} from './unit-dependencies'
import {legacyUnitCustody} from './unit-custody'
import {legacyUnitNative} from './unit-native'
import {unitGroups,unitHash,unitRefusal} from './unit-graph'

/** Pure source compilation. This is neither a census reader nor a bounded
 * runtime adapter: the existing complete preparation has already admitted the
 * entire eager snapshot. No authority, plan, import or success receipt exists. */
export function compileLegacyUnits(prepared:PreparedLegacy,decoded:DecodedLegacy,dependencies:LegacyUnitDependencies,files:readonly DoorPackageFile[],input:ReaderLimits={}){
 const limits=limitsFor(input),records=new Map(prepared.records.map(record=>[recordKey(record.kind,record.sourceId),record])),maxRecords=Math.min(limits.maxRecords,LEGACY_LIMITS.records)
 if(records.size!==prepared.records.length||records.size!==prepared.mapping.size||[...prepared.mapping.keys()].some(key=>!records.has(key)))return unitRefusal('Prepared source identities and mapping do not cover each other exactly.')
 if(dependencies.preparedHash!==unitHash([...prepared.mapping].sort(([a],[b])=>a.localeCompare(b))))return unitRefusal('Dependency context differs from the prepared projection.')
 if(prepared.records.length>LEGACY_LIMITS.records||prepared.nativeRows>LEGACY_LIMITS.records)throw new DoorError('plan_exceeds_grant_quota',413)
 const expected=Object.values(decoded.bundle.tables).reduce((n,rows)=>n+rows.length,0)+decoded.objects.length+1
 if(records.size!==expected||canonicalJson(records.get(recordKey('legacy-manifest',String(decoded.manifest.source.projectId)))?.payload)!==canonicalJson(decoded.manifest))return unitRefusal('Prepared source does not cover the complete decoded snapshot.')
 for(const object of decoded.objects){const record=records.get(recordKey('legacy-object',String(object.metadata.mediaId)));if(!record||Object.entries(object.metadata).some(([key,value])=>canonicalJson((record.payload as Record<string,unknown>)[key])!==canonicalJson(value)))return unitRefusal('Prepared object custody differs from the decoded object.')}
 const allEffects=[...prepared.mapping.values()].flatMap(value=>value.effects),lineage=unitHash([dependencies.destination,String(decoded.manifest.source.projectId)])
 for(const [id,mapping] of prepared.mapping)for(const effect of mapping.effects){const source=(effect.value as {source?:{table:string;id:string;project:string}}).source;if(!source||recordKey(source.table,source.id)!==id||source.project!==lineage)return unitRefusal('A projection is outside its primary source lineage.')}
 if(allEffects.length!==prepared.nativeRows||allEffects.filter(effect=>(effect.value as {table?:string})?.table==='legacy_door_blob_chunks').length!==prepared.blobChunks)return unitRefusal('Prepared native accounting disagrees with its effects.')
 const {groups,owner}=unitGroups([...records.keys()].sort(),dependencies.edges),custody=legacyUnitCustody(prepared,decoded,files,owner,dependencies.destination),ids=new Map(groups.map(members=>[members[0],'legacy-unit:'+unitHash(members)])),fingerprints=new Map<string,string>(),owned=new Set<string>()
 const units=groups.map(members=>{
  const group=members[0],source=members.map(id=>records.get(id)!),effects=members.flatMap(id=>prepared.mapping.get(id)!.effects),native=legacyUnitNative(effects,dependencies.destination)
  for(const row of native){const key=recordKey(row.table,row.key);if(owned.has(key))return unitRefusal('Two source units own the same physical native row.');owned.add(key)}
  const dependsOn=[...new Set(dependencies.edges.filter(edge=>owner.get(edge.from)===group&&owner.get(edge.to)!==group).map(edge=>ids.get(owner.get(edge.to)!)!))].sort(),evidence=dependencies.edges.filter(edge=>owner.get(edge.from)===group).map(edge=>({...edge})).sort((a,b)=>canonicalJson(a).localeCompare(canonicalJson(b)))
  const relationshipsHash=unitHash({edges:evidence,anchors:dependencies.anchors.filter(anchor=>owner.get(anchor.from)===group),dependencies:dependsOn.map(id=>[id,fingerprints.get(id)])}),{files:unitFiles,aliases}=custody.get(group)!
  const unit={id:ids.get(group)!,dependsOn,records:source,files:unitFiles,aliases,relationshipsHash},projectionHash=unitHash(native),fingerprint=unitHash({unit,native,custody:unitFiles.map(file=>files.find(declared=>declared.path===file.path)),dispositions:members.map(id=>[id,prepared.mapping.get(id)!.unmapped??[],prepared.mapping.get(id)!.rejection??null])})
  const sourceBytes=source.reduce((n,record)=>n+Buffer.byteLength(canonicalJson(record)),0),nativeBytes=native.reduce((n,row)=>n+row.storedBytes,0)
  if(source.length>maxRecords||native.length>maxRecords||sourceBytes>Math.min(limits.maxBytes,LEGACY_LIMITS.bytes)||unitFiles.reduce((n,file)=>n+file.logicalBytes,0)>Math.min(limits.maxBytes,LEGACY_LIMITS.bytes)||source.some(record=>Buffer.byteLength(canonicalJson(record))>Math.min(limits.maxRecordBytes,LEGACY_LIMITS.recordBytes))||sourceBytes*2+nativeBytes>LEGACY_LIMITS.eagerBytes)throw new DoorError('legacy_indivisible_unit_exceeds_limit',413,{source:source.length,native:native.length,sourceBytes,nativeBytes})
  fingerprints.set(unit.id,fingerprint)
  return {unit,native,projectionHash,fingerprint,sourceBytes,nativeBytes}
 })
 const native=units.flatMap(entry=>entry.native),fileList=units.flatMap(entry=>entry.unit.files),totals={source:prepared.records.length,native:native.length,aliases:units.reduce((n,entry)=>n+entry.unit.aliases.length,0),objects:decoded.objects.length,logicalBytes:fileList.reduce((n,file)=>n+file.logicalBytes,0),storedBytes:files.reduce((n,file)=>n+file.bytes,0),nativeBytes:native.reduce((n,row)=>n+row.storedBytes,0),blobBytes:native.reduce((n,row)=>n+row.blobBytes,0),contextBytes:fileList.filter(file=>file.role==='context').reduce((n,file)=>n+file.logicalBytes,0)}
 if(totals.blobBytes!==decoded.objects.reduce((n,object)=>n+object.bytes.length,0))return unitRefusal('Native readable bytes differ from complete object custody.')
 return {units,totals,relationshipsHash:unitHash(units.map(entry=>entry.unit.relationshipsHash)),fingerprint:unitHash(units.map(entry=>entry.fingerprint))}
}

/** Read-only preparation through the existing decoder and native mapper. The
 * ordinary complete-snapshot grant and native-set preflights are unchanged. */
export async function prepareLegacyUnits(db:D1Database,upload:ImportDoorPackageUpload,destination:string,ownerId:string,input:ReaderLimits={}){
 const limits=limitsFor(input),maxRecords=Math.min(limits.maxRecords,LEGACY_LIMITS.records),decoded=await decodeLegacy(upload,maxRecords),prepared=await prepareLegacy(db,decoded,destination,ownerId,maxRecords),dependencies=await legacyUnitDependencies(db,prepared,decoded,destination,ownerId)
 return compileLegacyUnits(prepared,decoded,dependencies,upload.files,limits)
}
