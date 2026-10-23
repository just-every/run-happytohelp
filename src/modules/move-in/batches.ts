import {retainedSourcePredicates} from './retained-sources'
import {stageAttachmentBytes,clearUnpublishedAttachments} from './attachment-custody'
import {categoryPublicationPredicates} from './category-publication'
import type {Env} from '../../platform/env'
import {custodyHash} from './custody-hash'
import {createD1ImportJob,applyD1ImportBatches,undoD1Import,rollbackD1Import,type ImportPlan,type ImportJob} from '../import-kit/src/d1/index'
import {assertAuthority,importContext} from './context'
import {assertUndoReferences} from './undo-references'
import {objectKey,updateRun} from './run-store'
import {reviewFingerprint,type ReviewManifest} from './plans'
import {LIMITS,MAPPING_VERSION,type Run} from './types'
import {reconcileContactKeys} from './contact-keys'
import {publicationPredicates,publicationDatabase,reviewedContacts} from './publication'
import {skipUnstartedUndo} from './partial-undo'
interface Batch {run_id:string;ordinal:number;plan_key:string;fingerprint:string;total:number;kit_job_id:string|null;state:string;checkpoint:number}
async function readReview(env:Env,run:Run,fingerprint:string){
 const object=await env.FILES.get(objectKey(run,`review/${fingerprint}`));if(!object)throw new Error('reviewed_plan_missing');const review=await object.json<ReviewManifest>();if(reviewFingerprint(review)!==fingerprint||review.fingerprint!==fingerprint||review.projectId!==run.project_id||review.actorId!==run.actor_id||review.vendor!==run.vendor||review.mappingVersion!==MAPPING_VERSION||!review.batches.length)throw new Error('reviewed_plan_changed');return review
}
async function verifyGroupCustody(env:Env,run:Run,review:ReviewManifest){
 for(const file of [review.original,...review.artifacts]){if(!file.key.startsWith(objectKey(run,''))||file.size>LIMITS.inputBytes)throw new Error('source_custody_changed');const object=await env.FILES.get(file.key);if(!object||object.size!==file.size||await custodyHash(object.body,file.size)!==file.sha256)throw new Error('source_custody_changed')}
}
export async function approveReview(env:Env,run:Run,fingerprint:string){
 await assertAuthority(env,run);if(run.state!=='ready'||run.review_fingerprint!==fingerprint)throw new Error('review_fingerprint_mismatch')
 const review=await readReview(env,run,fingerprint);await verifyGroupCustody(env,run,review)
 const statements=review.batches.map((batch,index)=>{if(batch.ordinal!==index||batch.bytes>LIMITS.planBytes||batch.key!==objectKey(run,`plans/${batch.fingerprint}`))throw new Error('reviewed_plan_changed');return env.DB.prepare('INSERT INTO move_in_batches(run_id,ordinal,plan_key,fingerprint,total) VALUES(?,?,?,?,?)').bind(run.id,index,batch.key,batch.fingerprint,batch.total)})
 await updateRun(env,run,{state:'applying',cursor:0,error:null,session_hash:run.session_hash},statements)
}
async function publishCheckpoint(env:Env,run:Run,batch:Batch,job:ImportJob){
 const undo=run.state==='undoing',nextState=['undone','rolled_back'].includes(job.state)?'undone':job.state==='completed'?'completed':undo?'undoing':'applying'
 const other=await env.DB.prepare("SELECT COALESCE(SUM(checkpoint),0) checkpoint,COUNT(*) total,COALESCE(SUM(state=?1),0) finished,(SELECT json_extract(plan_json,'$.counts') FROM move_in_runs WHERE id=?2) counts FROM move_in_batches WHERE run_id=?2 AND ordinal<>?3").bind(undo?'undone':'completed',run.id,batch.ordinal).first<any>()
 const progress=undo?await env.DB.prepare('SELECT COUNT(*) total,COALESCE(SUM(reversed),0) checkpoint FROM ik_provenance WHERE job_id IN (SELECT kit_job_id FROM move_in_batches WHERE run_id=?)').bind(run.id).first<any>():{checkpoint:other.checkpoint+job.checkpoint,total:run.total}
 const done=nextState===(undo?'undone':'completed')&&other.finished===other.total,state=done?undo?'undone':'completed':run.state
 await updateRun(env,run,{state,cursor:progress.checkpoint,kit_job_id:job.id,report_json:JSON.stringify({state,checkpoint:progress.checkpoint,total:progress.total,counts:JSON.parse(other.counts)}),error:job.error??null},[env.DB.prepare('UPDATE move_in_batches SET kit_job_id=?,state=?,checkpoint=? WHERE run_id=? AND ordinal=?').bind(job.id,nextState,job.checkpoint,run.id,batch.ordinal)])
 if(done&&undo)await clearUnpublishedAttachments(env,{...run,state})
}
export async function advanceBatch(env:Env,run:Run){
 if(run.state!=='undoing'&&!await reconcileContactKeys(env,run))return
 const review=await readReview(env,run,run.review_fingerprint!);await verifyGroupCustody(env,run,review)
 const undo=run.state==='undoing';if(undo&&JSON.parse(run.report_json||'{}').state!=='undoing')await assertUndoReferences(env,run)
 const batch=await env.DB.prepare(`SELECT * FROM move_in_batches WHERE run_id=? AND state<>? ORDER BY ordinal ${undo?'DESC':'ASC'} LIMIT 1`).bind(run.id,undo?'undone':'completed').first<Batch>();if(!batch)throw new Error('import_batch_missing')
 if(undo&&!batch.kit_job_id){await skipUnstartedUndo(env,run,batch.ordinal);return}
 if(undo)await assertUndoReferences(env,run,batch.kit_job_id??undefined)
 const fence={sql:`EXISTS(SELECT 1 FROM move_in_runs WHERE id=? AND state=? AND artifact_hash=? AND object_key=? AND bytes=? AND json_extract(plan_json,'$.fingerprint')=? AND review_fingerprint=json_extract(plan_json,'$.fingerprint') AND total=?) AND (SELECT json_group_array(json_array(ordinal,plan_key,fingerprint,total)) FROM (SELECT ordinal,plan_key,fingerprint,total FROM move_in_batches WHERE run_id=? ORDER BY ordinal))=? AND EXISTS(SELECT 1 FROM move_in_batches WHERE run_id=? AND ordinal=? AND kit_job_id IS ?)`,params:[run.id,run.state,review.original.sha256,review.original.key,review.original.size,review.fingerprint,review.batches.reduce((n,child)=>n+child.total,0),run.id,JSON.stringify(review.batches.map(child=>[child.ordinal,child.key,child.fingerprint,child.total])),run.id,batch.ordinal,batch.kit_job_id]}
 const categoryPredicates=undo?[]:categoryPublicationPredicates(run.project_id,review.categories??[])
 for(const predicate of categoryPredicates)if(!(await env.DB.prepare(`SELECT (${predicate.sql}) allowed`).bind(...predicate.params!).first<{allowed:number}>())?.allowed)throw new Error('native_category_changed_since_review')
 const retained=undo?[]:retainedSourcePredicates(run.project_id,run.vendor,review.retainedSources??[])
 for(const predicate of retained)if(!(await env.DB.prepare(`SELECT (${predicate.sql}) allowed`).bind(...predicate.params!).first<{allowed:number}>())?.allowed)throw new Error('retained_source_changed_since_review')
 const publication=undo?[]:publicationPredicates(run.project_id,await reviewedContacts(env,review))
 for(const predicate of publication)if(!(await env.DB.prepare(`SELECT (${predicate.sql}) allowed`).bind(...predicate.params!).first<{allowed:number}>())?.allowed)throw new Error('native_contact_changed_since_review')
 const context={...importContext({...env,DB:publicationDatabase(env.DB,[...publication,...categoryPredicates,...retained])},{...run,kit_job_id:batch.kit_job_id},fence),operationKey:`${run.id}/${batch.ordinal}`}
 if(!undo){
  const object=await env.FILES.get(batch.plan_key)
  if(!object||object.size>LIMITS.planBytes)throw new Error('reviewed_plan_missing')
  const plan=await object.json<ImportPlan>()
  if(plan.fingerprint!==batch.fingerprint||plan.entries.length!==batch.total)throw new Error('reviewed_plan_changed')
  await stageAttachmentBytes(env,run,plan,review.artifacts)
 }
 if(!batch.kit_job_id){if(undo)throw new Error('import_job_missing');const object=await env.FILES.get(batch.plan_key);if(!object||object.size>LIMITS.planBytes)throw new Error('reviewed_plan_missing');const plan=await object.json<ImportPlan>();if(plan.fingerprint!==batch.fingerprint||plan.entries.length!==batch.total)throw new Error('reviewed_plan_changed');const job=await createD1ImportJob(plan,{...context,reviewedFingerprint:batch.fingerprint});await publishCheckpoint(env,run,batch,job);return}
 // Both entry points perform Base current authorization, stored-plan validation,
 // custody/inventory checks and atomic fences. No redundant read-and-reload.
 // A stopped child can own a queued or partially applied job. Base rollback
 // reverses that actual journal; completed children keep normal undo semantics.
 const jobState=undo?(await env.DB.prepare('SELECT state FROM ik_jobs WHERE id=?').bind(batch.kit_job_id).first<{state:string}>())?.state:null
 const reverse=jobState&&['completed','undoing','undone'].includes(jobState)?undoD1Import:rollbackD1Import
 const job=undo?await reverse(batch.kit_job_id,context):await applyD1ImportBatches(batch.kit_job_id,context);await publishCheckpoint(env,run,batch,job)
}
