import {preflightContextScope} from './v2'
import type {Env,Job} from '../../../platform/env'
import {boundedDatabase} from '../../../platform/d1-budget'
import {LEGACY_JOB} from '../worker-contract'
import {planKnowledgeIndex} from '../../knowledge/canonicaliser'
import {readManifest} from './reader'
import {verifyPackage} from './package-step'
import {loadContext,indexTranscripts,indexDatasets} from './context-load'
import {loadEarlierMedia} from './earlier-media'
import {deltaMessages,deltaMedia} from './delta-context'
import {workspaceLease} from './fence'
import {rowStep,preflightObjects} from './row-step'
import {copyObject} from './object-step'
import {verifyResult,cleanup} from './verification'
import {getRun,claim,pause,allowed,checkpoint,cursor,limits,json,enqueue,guarded,type Run} from './state'
import {CustodyError,assertCustody,renewCustody} from '../custody'
import {AdoptionError} from '../adoption/errors'
import {refuse,WorkerImportError} from './errors'
import type {DeltaLease} from '../lease'
/** A queue wake never supplies a phase, cursor, source row or authority. */
export async function advanceLegacy(env:Env,job:Job){
 if(job.type!==LEGACY_JOB||![1,2].includes(Number(job.contractVersion))||typeof job.manifestSha256!=='string'||job.id!==`legacy-package:${job.manifestSha256}`)return
 const budget=boundedDatabase(env.DB,limits.statements,12);env={...env,DB:budget.database}
 const found=await getRun(env,job.id);if(!found||found.project_id!==job.projectId||found.manifest_sha256!==job.manifestSha256||!['queued','running'].includes(found.state))return
 const run=await claim(env,found);if(!run)return
 if(![1,2].includes(run.contract_version)||run.contract_version!==job.contractVersion){await pause(env,run,'unsupported_contract_version');return}
 if(run.contract_version===2)try{await assertCustody(env,{sha:run.manifest_sha256,generation:1},{projectId:run.project_id,actorId:run.actor_id,sessionHash:run.session_hash})}catch(error){await pause(env,run,error instanceof CustodyError?error.code:'database_unavailable');return}
 if(!await allowed(env,run)){await pause(env,run,'import_authority_revoked');return}
 let lease:(DeltaLease&{token:string})|null=null
 try{
  const manifest=await readManifest(env.FILES,run.manifest_sha256,run.project_id,run.contract_version as 1|2)
  if(manifest.source.projectId!==run.source_project_id||run.contract_version===1&&run.source_project_id!==run.project_id)refuse('destination_policy_required')
  lease=await workspaceLease(env,run)
  if(!lease){
   const blockers=await env.DB.prepare("SELECT EXISTS(SELECT 1 FROM contact_erasure_leases WHERE project_id=? AND expires_at>CAST(unixepoch('subsec')*1000 AS INTEGER)) erasure").bind(run.source_project_id).first<{erasure:number}>()
   const metrics=json<any>(run.metrics_json,{});metrics.lease={runHeld:false,runLeaseUntil:null,workspaceHeld:true,workspaceLeaseUntil:null,waitingFor:blockers?.erasure?'erasure':'import'}
   await checkpoint(env,run,{metrics_json:JSON.stringify(metrics),next_at:Date.now()+60000});await releaseClaim(env,run);await enqueue(env,run);return
  }
  const phase=run.phase,c=cursor(run);let measured:{rows:number;bytes:number;objects?:number}
  if(phase==='verify_package')measured=await verifyPackage(env,run,manifest)
  else if(phase==='context')measured=c.stage==='transcripts'?await indexTranscripts(env,run):c.stage==='datasets'?await indexDatasets(env,run):c.stage==='earlier'||c.stage==='earlier_files'?await loadEarlierMedia(env,run):await loadContext(env,run,manifest)
  else if(phase==='preflight')measured=c.stage==='scope'?await preflightContextScope(env,run,manifest):c.stage==='delta'?await deltaMessages(env,run,manifest):c.stage==='delta_media'?await deltaMedia(env,run,manifest):c.stage==='objects'?await preflightObjects(env,run,manifest,lease):await rowStep(env,run,manifest,lease,true)
  else if(phase==='objects')measured=await copyObject(env,run,manifest,lease)
  else if(phase==='rows')measured=await rowStep(env,run,manifest,lease,false)
  else if(phase==='knowledge'){
   const plan=await planKnowledgeIndex(env,run.source_project_id,1)
   await checkpoint(env,run,{...(plan.complete?{phase:'verify_result',cursor_json:'{}'}:{})},[lease.assertion(env.DB),...plan.statements,...(plan.complete?[env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT NOT EXISTS(SELECT 1 FROM knowledge_index_dirty WHERE project_id=?)').bind(run.source_project_id)]:[]),lease.cleared(env.DB)])
   measured={rows:plan.shingles.length,bytes:plan.bytes}
  }
  else if(phase==='verify_result')measured=await verifyResult(env,run,manifest,lease)
  else if(phase==='cleanup')measured=await cleanup(env,run)
  else refuse('unsupported_contract_version')
  // CPU/heap belong to the inspector, not Date.now or D1 duration. These are
  // workload counts only; unmeasured runtime limits stay explicitly experimental.
  const m=json<any>(run.metrics_json,{}),previous=m.phases?.[phase]??{invocations:0,rows:0,bytes:0,maxStatements:0}
  const metrics={...m,rows:(m.rows??0)+measured.rows,bytes:(m.bytes??0)+measured.bytes,objects:(m.objects??0)+(measured.objects??0),phases:{...m.phases,[phase]:{invocations:previous.invocations+1,rows:previous.rows+measured.rows,bytes:previous.bytes+measured.bytes,maxStatements:Math.max(previous.maxStatements,budget.statements)}},lease:{runHeld:false,runLeaseUntil:null,workspaceHeld:false,workspaceLeaseUntil:null,waitingFor:'none'}}
  // Completion's checkpoint already released the write capability; its counts
  // are final. All intermediate metadata remains under the same run guard.
  if(run.state!=='complete')await checkpoint(env,run,{metrics_json:JSON.stringify(metrics),next_at:0})
  if(run.contract_version===2)await renewCustody(env,{sha:run.manifest_sha256,generation:1},{projectId:run.project_id,actorId:run.actor_id,sessionHash:run.session_hash},run.state==='complete'?'complete':'progress')
  await lease.release();lease=null
  if(run.state!=='complete'){await releaseClaim(env,run);await enqueue(env,run)}else await env.DB.prepare('UPDATE legacy_import_worker_runs SET lease_token=NULL,lease_until=NULL WHERE id=? AND version=?').bind(run.id,run.version).run()
 }catch(error){
  const current=await getRun(env,run.id);if(!current||current.version!==run.version||current.state==='stopped')return
  const code=error instanceof WorkerImportError||error instanceof CustodyError||error instanceof AdoptionError?error.code:!await allowed(env,run)?'import_authority_revoked':error instanceof Error&&error.message.includes('KNOWLEDGE_PLAN_TOO_LARGE')?'row_too_large':error instanceof Error&&error.message.includes('KNOWLEDGE_INDEX_NOT_READY')?'knowledge_index_not_ready':error instanceof Error&&error.message.startsWith('Required legacy field missing')?'invalid_scope':error instanceof Error&&error.message==='Knowledge plan changed before commit'?'native_conflict':error instanceof Error&&error.message.includes('WORKER_D1')?'quantum_too_large':error instanceof Error&&/conflict|replay differs/i.test(error.message)?'native_conflict':'database_unavailable'
  await pause(env,run,code)
  if(run.contract_version===2)try{await renewCustody(env,{sha:run.manifest_sha256,generation:1},{projectId:run.project_id,actorId:run.actor_id,sessionHash:run.session_hash},'paused')}catch{/* Expiry/revocation never reopens source. */}
 }finally{await lease?.release()}
}
async function releaseClaim(env:Env,run:Run){
 await checkpoint(env,run,{state:'queued',lease_token:null,lease_until:null})
}
