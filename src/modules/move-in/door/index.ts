import {legacyPlanQuota} from '../../legacy-import/door/quota'
import {indexCompletedLegacyUpload} from '../../legacy-import/door/upload-custody'
import {legacyHeaderRefusal} from '../../legacy-import/door/refusal'
import {legacyUndoGuards} from '../../legacy-import/door/undo'
import {legacyPackageSource} from '../../legacy-import/door/source'
import {LEGACY_LIMITS,LEGACY_NAMESPACE} from '../../legacy-import/door/limits'
import {publicationPredicates,publicationContact} from '../publication'
import {undoReferencesClear} from '../undo-references'
import type {Run} from '../types'
import {DoorError} from '../../import-kit/src/door/index'
import {loadSnapshot} from '../../import-kit/src/door/store'
import {importedTargets} from '../../import-kit/src/door/inventory'
import type {DoorRequest,DoorPlanRow} from '../../import-kit/src/door/types'
import type {Env} from '../../../platform/env'
import {createImportDoorHandler} from '../../import-kit/src/door/index'
import {claimConfiguration,claimedDestination,ownerPredicate,authorizedDatabase} from './authority'
import {nativeTargets} from '../targets'
import {zendeskSource} from './source'
import type {D1Sql} from '../../import-kit/src/d1/types'
import {doorBody,discardUnreadRequest} from './request-body'

const closed=()=>Response.json({error:'not_found'},{status:404,headers:{'Cache-Control':'no-store'}})
export async function handleImportDoor(request:Request,env:Env):Promise<Response|null>{
 if(!new URL(request.url).pathname.startsWith('/api/rer/import/'))return null
 const claim=claimConfiguration(env,new URL(request.url).origin);if(!claim){await discardUnreadRequest(request);return closed()}
 const binding=await claimedDestination(env,claim);if(!binding){await discardUnreadRequest(request);return closed()}
 const input=request.clone() as unknown as Request
 const extra:D1Sql[]=[],freshIndex:D1Sql={sql:'NOT EXISTS(SELECT 1 FROM move_in_contact_keys WHERE project_id=? AND email_digest IS NULL)',params:[binding.project_id]};let prepared=false
 const native=ownerPredicate(claim,binding),database=authorizedDatabase(env.DB,native,()=>extra),reader=zendeskSource({...env,DB:database as D1Database},binding.project_id,binding.owner_id,()=>{prepared=true;extra.push(freshIndex)})
 const legacy=legacyPackageSource({...env,DB:database as D1Database},binding.project_id,binding.owner_id,async()=>{const body=await doorBody(input);if(typeof body.uploadId!=='string')throw new DoorError('invalid_upload_id',400);const row=await database.prepare('SELECT bundle_sha256 FROM ik_door_uploads WHERE id=? AND installation_id=? AND namespace=?').bind(body.uploadId,claim.installationId,LEGACY_NAMESPACE).first<{bundle_sha256:string}>();if(!row)throw new DoorError('upload_not_found',404);return row.bundle_sha256})
 let activeNamespace='zendesk'
 const handler=createImportDoorHandler({database,targets:nativeTargets,claim,installationId:claim.installationId,ownerPrincipalId:binding.owner_id,destination:binding.project_id,format:'raw',reversalPolicy:'strict',limits:{maxBytes:LEGACY_LIMITS.bytes,maxRecords:LEGACY_LIMITS.records,maxRecordBytes:LEGACY_LIMITS.recordBytes},
  async source(namespace){
   if(namespace!=='zendesk'&&namespace!==LEGACY_NAMESPACE)return null
   if(namespace===LEGACY_NAMESPACE&&!await database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='legacy_door_package_audits'").first())throw new DoorError('legacy_import_schema_outdated',503)
   activeNamespace=namespace
   if(namespace==='zendesk'&&request.url.endsWith('/plan')&&(await doorBody(request)).catchup===true)throw new DoorError('happytohelp_catchup_requires_proposal',409)
   if(namespace===LEGACY_NAMESPACE&&request.url.endsWith('/plan')){const body=await doorBody(request);if(typeof body.uploadId==='string'){const prior=await database.prepare('SELECT p.* FROM ik_door_plans p JOIN ik_door_uploads u ON u.installation_id=p.installation_id AND u.namespace=p.namespace AND u.bundle_sha256=p.bundle_sha256 JOIN ik_door_namespaces n ON n.installation_id=p.installation_id AND n.namespace=p.namespace AND (n.pending_id=p.id OR n.head_id=p.id) WHERE u.id=? AND p.installation_id=? AND p.namespace=? AND p.complete=1 LIMIT 1').bind(body.uploadId,claim.installationId,namespace).first<DoorPlanRow>();if(prior)await legacyPlanQuota(database,claim,binding,request,prior)}}
   if(['/apply','/undo'].some(action=>new URL(request.url).pathname.endsWith(action))){
    const body=await doorBody(request)
    if(typeof body.planId==='string'){
     const row=await database.prepare('SELECT * FROM ik_door_plans WHERE id=? AND installation_id=? AND namespace=? AND complete=1').bind(body.planId,claim.installationId,namespace).first<DoorPlanRow>()
     if(row){
      const boundedSnapshot=namespace===LEGACY_NAMESPACE?await legacyPlanQuota(database,claim,binding,request,row):null
      if(namespace==='zendesk'&&request.url.endsWith('/apply')&&(await database.prepare('SELECT state FROM ik_jobs WHERE id=?').bind(row.job_id??'').first<{state:string}>())?.state!=='completed'){
      const snapshot=await loadSnapshot({options:{database,destination:binding.project_id,ownerPrincipalId:binding.owner_id},access:{installationId:claim.installationId,namespace}} as DoorRequest,row)
      extra.push(...publicationPredicates(binding.project_id,snapshot.plan.entries.flatMap(entry=>entry.effects.filter(effect=>effect.targetKind==='contact').map(effect=>publicationContact(binding.project_id,effect.targetId,effect.value)))))
      }
      if(request.url.endsWith('/undo')&&row.job_id){
       // A bounded reverse may visit the changed contact after many tickets.
       // Inspect the completed baseline before its first reversal batch, so a
       // known native edit refuses before any child is removed. The kit still
       // fences every target atomically while reversing and on later resumes.
       if((await database.prepare('SELECT state FROM ik_jobs WHERE id=?').bind(row.job_id).first<{state:string}>())?.state==='completed'){
        const inspection={options:{database,destination:binding.project_id,ownerPrincipalId:binding.owner_id,targets:nativeTargets,mapping:(namespace===LEGACY_NAMESPACE?legacy:reader).source.mapping},access:{installationId:claim.installationId,namespace},authority:native} as DoorRequest
        const snapshot=boundedSnapshot??await loadSnapshot(inspection,row)
        if((await importedTargets(inspection,snapshot.records.flatMap(record=>record.targets))).some(target=>!target.matches))throw new DoorError('native_edit_conflict',409)
       }
       extra.push(undoReferencesClear({project_id:binding.project_id} as Run,row.job_id))
       if(namespace===LEGACY_NAMESPACE)extra.push(...await legacyUndoGuards(database,binding.project_id,row.job_id))
      }
     }
    }
   }
   return (namespace===LEGACY_NAMESPACE?legacy:reader).source
  }})
 const response=await handler(request)
 await discardUnreadRequest(request)
 if(!response)return response
 if(response.ok&&activeNamespace===LEGACY_NAMESPACE&&request.url.endsWith('/uploads')&&(await response.clone().json() as any).complete===true){try{await indexCompletedLegacyUpload(env,database,claim.installationId,binding.project_id,legacy.source)}catch(error){if(error instanceof DoorError)return Response.json({error:error.code,...(error.details?{details:error.details}:{})},{status:error.status,headers:response.headers});throw error}}
 if(!response.ok&&activeNamespace===LEGACY_NAMESPACE&&(await response.clone().json().catch(()=>null) as any)?.error==='invalid_package'){const refused=await legacyHeaderRefusal(database,claim.installationId,await doorBody(input));if(refused)return Response.json({error:refused.error,details:{reason:refused.reason}},{status:refused.status,headers:response.headers})}
 if(!response.ok&&prepared&&(await env.DB.prepare(`SELECT (${freshIndex.sql}) clear`).bind(...freshIndex.params!).first<{clear:number}>())?.clear!==1)return Response.json({error:'move_in_contact_index_retry',retryable:true},{status:409,headers:response.headers})
 // Base owns grant validation and all kit actions. These source-only summaries
 // expose dispositions without the reviewer-only source values or plan bodies.
 if(!response.ok&&reader.refusal){
  const code=reader.refusal
  if(['move_in_contact_index_retry','move_in_identity_index_retry'].includes(code))return Response.json({error:code,retryable:true},{status:409,headers:response.headers})
  if(code==='source_erased'){
   // An erased identity cannot leave an admitted raw upload in private custody.
   const body=await input.json().catch(()=>null) as any
   if(typeof body?.uploadId==='string')await database.batch([database.prepare('DELETE FROM ik_door_chunks WHERE upload_id IN (SELECT id FROM ik_door_uploads WHERE id=? AND installation_id=? AND namespace=?)').bind(body.uploadId,claim.installationId,activeNamespace),database.prepare('DELETE FROM ik_door_uploads WHERE id=? AND installation_id=? AND namespace=?').bind(body.uploadId,claim.installationId,activeNamespace)])
   return Response.json({error:'source_erased'},{status:409,headers:response.headers})
  }
 }
 if(response.ok&&(request.url.endsWith('/plan')||request.url.endsWith('/status'))){
  const body=await response.json() as any
  const row=await database.prepare('SELECT * FROM ik_door_plans WHERE id=? AND installation_id=? AND namespace=? AND complete=1').bind(body.planId,claim.installationId,activeNamespace).first<DoorPlanRow>()
  if(!row)return Response.json({error:'plan_not_found'},{status:404,headers:response.headers})
  const snapshot=await loadSnapshot({options:{database,destination:binding.project_id,ownerPrincipalId:binding.owner_id},access:{installationId:claim.installationId,namespace:activeNamespace}} as DoorRequest,row).catch(error=>{if(request.url.endsWith('/status')&&error instanceof DoorError&&error.code==='snapshot_withdrawn')return null;throw error})
  if(!snapshot)return Response.json(body,{headers:response.headers})
  if(body.job)body.job.counts=snapshot.plan.counts
  if(activeNamespace===LEGACY_NAMESPACE){const manifest=snapshot.plan.source.records.find(record=>record.kind==='legacy-manifest')?.payload as any,targets=new Map(snapshot.records.flatMap(record=>record.targets).map(target=>[target.kind+':'+target.id,target]));body.accounting={primaryRows:Object.values(manifest?.source?.rowCounts??{}).reduce((n:any,value:any)=>n+value,0),primaryByTable:manifest?.source?.rowCounts??{},objects:manifest?.objects?.length??0,nativeRows:targets.size,byteChunks:[...targets.values()].filter(target=>target.id.startsWith('legacy_door_blob_chunks:')).length,plannedNativeRows:snapshot.plan.counts.effects}}
  body.unmapped=snapshot.plan.entries.filter(entry=>entry.unmapped.length).map(entry=>({kind:entry.source.kind,sourceId:entry.source.sourceId,reason:entry.unmapped.map(item=>item.reason).join('; ')}))
  return Response.json(body,{headers:response.headers})
 }
 if(response.ok&&request.url.endsWith('/reconcile')){
  const body=await response.json() as any,byKind:Record<string,number>={}
  for(const row of body.sourceIds??[])byKind[row.kind]=(byKind[row.kind]??0)+1
  body.counts={...body.counts,nativeByKind:body.counts.byKind,byKind}
  return Response.json(body,{headers:response.headers})
 }
 return response
}
