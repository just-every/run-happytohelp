import {reserveCanonical} from './canonical-custody'
import type {Env} from '../../../platform/env'
import type {LegacyPackageManifest,LegacyObject} from '../worker-contract'
import type {DeltaLease} from '../lease'
import {ofErased,heldByNativeMedia} from '../erased'
import {packageKey} from './manifest'
import {checksum,checkPart} from './reader'
import {hydrate} from './context-read'
import {scopedErased,readDelta} from './delta-context'
import {cursor,checkpoint,type Run} from './state'
import {exportedObjectKey} from '../media-index'
import {refuse} from './errors'
export async function objectScope(env:Env,run:Run,manifest:LegacyPackageManifest,object:LegacyObject){
 if(object.key!==exportedObjectKey(run.source_project_id,String(object.mediaId)))refuse('invalid_scope',422)
 const source=await env.DB.prepare("SELECT row_json FROM legacy_import_context WHERE run_id=? AND kind='record' AND source_table='media' AND source_id=?").bind(run.id,String(object.mediaId)).first<{row_json:string}>();if(!source)refuse('invalid_scope',422)
 const media=JSON.parse(source.row_json),hydrated=await hydrate(env,run,manifest,'media',[media]),erased=await scopedErased(env,run,'media',[media],hydrated.context)
 const erasedObject=ofErased(erased,'media',media,hydrated.context),delta=run.mode==='delta'?await readDelta(env,run,'media',[media],hydrated.context):undefined
 return {withheld:erasedObject||delta?.withheldMedia.has(String(object.mediaId))===true,erased:erasedObject||delta?.erasedMedia.has(String(object.mediaId))===true}
}
export async function inspectObject(env:Env,run:Run,object:LegacyObject){
 await checkPart(env.FILES,run.manifest_sha256,run.project_id,'object',object,run.contract_version as 1|2)
 const existing=await env.FILES.head(object.key)
 if(existing?.customMetadata?.canonicalReservation===run.id)return null
 if(existing){if(existing.size!==object.size)refuse('object_conflict');if(!checksum(existing))refuse('checksum_unavailable');if(checksum(existing)!==object.sha256)refuse('object_conflict')}
 return existing
}
export async function copyObject(env:Env,run:Run,manifest:LegacyPackageManifest,lease:DeltaLease){
 const c=cursor(run),ordinal=Number(c.ordinal??0),object=manifest.objects[ordinal]
 if(!object){await checkpoint(env,run,{phase:'rows',cursor_json:JSON.stringify({ordinal:0,row:0})});return {rows:0,bytes:0,objects:0}}
 const scope=await objectScope(env,run,manifest,object)
 if(scope.withheld){
  const existing=await env.FILES.head(object.key)
  if(scope.erased&&existing?.customMetadata?.legacyImport===run.id&&!await heldByNativeMedia(env.DB,[object.mediaId],object.key)){await lease.confirm();await env.FILES.delete(object.key)}
 }else{
  const existing=await inspectObject(env,run,object)
  if(!existing){
   await lease.confirm()
   const source=await env.FILES.get(packageKey(run.manifest_sha256,'object',object.file));if(!source||source.size!==object.size||checksum(source)!==object.sha256)refuse('digest_mismatch',422)
   let reservation:R2Object|null=null
   if(run.contract_version===2){
    await reserveCanonical(env,run,object,lease)
    const prior=await env.FILES.head(object.key)
    if(prior&&prior.customMetadata?.canonicalReservation!==run.id)refuse('object_conflict')
    reservation=await env.FILES.put(object.key,crypto.randomUUID(),{onlyIf:prior?{etagMatches:prior.etag}:{etagDoesNotMatch:'*'},customMetadata:{canonicalReservation:run.id}})
    if(!reservation)refuse('source_reservation_pending')
    await lease.confirm()
   }
   const stored=await env.FILES.put(object.key,source.body,{sha256:object.sha256,onlyIf:reservation?{etagMatches:reservation.etag}:{etagDoesNotMatch:'*'},customMetadata:{legacyImport:run.id}})
   if(!stored)await inspectObject(env,run,object)
   await lease.confirm()
  }
 }
 // V2 persisted the exact candidate and non-content ancestry BEFORE the nonce.
 // A crash resumes by checksum; erasure can delete the nonce or body meanwhile.
 const statements=[lease.assertion(env.DB)]
 if(!scope.withheld)statements.push(env.DB.prepare('INSERT OR IGNORE INTO legacy_import_objects(run_id,object_key,sha256,size) VALUES(?,?,?,?)').bind(run.id,object.key,object.sha256,object.size))
 statements.push(lease.cleared(env.DB))
 await checkpoint(env,run,{cursor_json:JSON.stringify({ordinal:ordinal+1})},statements)
 return {rows:0,bytes:scope.withheld?0:object.size,objects:1}
}
