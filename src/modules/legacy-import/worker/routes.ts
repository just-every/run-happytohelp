import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {importActor} from '../../move-in/routes'
import {memberAccess} from '../../access/gate'
import {LEGACY_ROUTE,LEGACY_LIMITS} from '../worker-contract'
import {readManifest} from './reader'
import {refuse,WorkerImportError} from './errors'
import {getRun,enqueue,view,runAuthority,type Run} from './state'
import {requireInstallationOwner,firstOwnerPredicate,expectedOwnerEmail} from '../adoption/authority'
import {getAdoption} from '../adoption/store'
import {CustodyError,getCustody,assertCustody,custodyAssertion,renewCustody,discardCustody,enqueueCleanup,activeCustody,beginLegacyCleanup,cleanupStep} from '../custody'
import {readCustodyManifest} from '../package-in/v2'
import {requireStepUp} from '../../identity/two-factor/step-up'
import {dbNow} from '../lease'
import {result} from './result'
export const legacyRunnerRoutes=new Hono<AppEnv>()
legacyRunnerRoutes.onError((error,c)=>{c.header('Cache-Control','no-store');if(error instanceof CustodyError)return c.json({error:error.code.replaceAll('_',' '),code:error.code},error.status as 400);if(error instanceof HTTPException)return error.res?error.getResponse():c.json({error:error.message},error.status);return c.json({error:'Import storage unavailable',code:'database_unavailable'},503)})
const root=LEGACY_ROUTE+'/:sha'
legacyRunnerRoutes.use(`${root}/*`,async(c,next)=>{c.header('Cache-Control','no-store');await next()})
async function admission(c:any,readPackage=true){
 const actor=await importActor(c),access=await memberAccess(c.env.DB,actor.project_id,actor.actor_id)
 if(!access?.permissions.has('data.import'))throw new HTTPException(403)
 const sha=c.req.param('sha');if(!/^[a-f0-9]{64}$/.test(sha))refuse('invalid_request',400)
 const held=await getCustody(c.env.DB,sha),stored=await getRun(c.env,`legacy-package:${sha}`),v2=held!==null&&!held.cleanup_only
 if(held&&held.custody_project_id!==actor.project_id)refuse('run_not_found',404)
 if(held?.cleanup_only&&readPackage)refuse('source_invalidated')
 if(v2)await requireInstallationOwner(c,actor.project_id)
 const manifest=readPackage?(v2?await readCustodyManifest(c.env,actor.project_id,sha,{projectId:actor.project_id,actorId:actor.actor_id,sessionHash:actor.session_hash}):await readManifest(c.env.FILES,sha,actor.project_id,1)):undefined
 return {actor,sha,held,version:v2?2:1,manifest:manifest!,id:`legacy-package:${sha}`}
}
async function body(c:any){
 const reader=c.req.raw.body?.getReader();let bytes=0,text=''
 if(reader){const decoder=new TextDecoder('utf-8',{fatal:true});try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>LEGACY_LIMITS.controlBytes){await reader.cancel();refuse('invalid_request',400)}text+=decoder.decode(next.value,{stream:true})}text+=decoder.decode()}catch(error){if(error instanceof WorkerImportError)throw error;refuse('invalid_request',400)}finally{reader.releaseLock()}}
 let value;try{value=JSON.parse(text)}catch{refuse('invalid_request',400)}
 if(!value||typeof value!=='object'||Array.isArray(value))refuse('invalid_request',400)
 return value as Record<string,unknown>
}
function approval(input:Record<string,unknown>,sha:string){if(input.approvedManifestSha256!==sha)refuse('approval_mismatch')}
function destination(source:string,target:string){if(source!==target)refuse('destination_policy_required')}
async function controlCommit(c:any,run:Pick<Run,'id'|'project_id'|'actor_id'|'session_hash'>&Partial<Run>,statements:D1PreparedStatement[],expected?:{version:number;state:string}){
 const a=runAuthority(run,expectedOwnerEmail(c.env)),guard=expected?` AND EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE id=? AND version=? AND state=?)`:''
 try{return await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${a.sql})${guard}`).bind(...a.params,...(expected?[run.id,expected.version,expected.state]:[])),...statements,c.env.DB.prepare('DELETE FROM ik_d1_assertions')])}
 catch(error){if(expected){const current=await getRun(c.env,run.id);if(current?.version!==expected.version||current?.state!==expected.state)refuse('run_state_conflict')}throw error}
}

legacyRunnerRoutes.post(`${root}/start`,async c=>{
 const {actor,sha,manifest,id,held,version}=await admission(c),input=await body(c);approval(input,sha);if(version===1)destination(manifest.source.projectId,actor.project_id)
 const approved=version===2?await getAdoption(c.env.DB,sha):null
 if(version===2&&(!approved||approved.session_hash!==actor.session_hash||approved.approver_id!==actor.actor_id))refuse('adoption_approval_required')
 if(Object.keys(input).some(key=>!['approvedManifestSha256','excludeTables','replay'].includes(key))||input.replay!==undefined&&typeof input.replay!=='boolean')refuse('invalid_request',400)
 const exclude=input.excludeTables??['ai_usages'];if(!Array.isArray(exclude)||exclude.length>1||exclude.some(value=>value!=='ai_usages'))refuse('invalid_request',400)
 let run=await getRun(c.env,id)
 if(run){
  if(run.project_id!==actor.project_id)refuse('run_not_found',404)
  if(run.exclude_json!==JSON.stringify(exclude))refuse('run_options_conflict')
  if(run.contract_version!==version)refuse('unsupported_contract_version')
  if(run.state!=='complete'||!input.replay)return c.json({data:view(run)},200)
  await controlCommit(c,{...run,...actor},[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='queued',phase='verify_package',cursor_json='{}',attempt=attempt+1,version=version+1,actor_id=?,session_hash=?,lease_token=NULL,lease_until=NULL,next_at=0,error_code=NULL,completed_at=NULL,verified_at=NULL,work_before_json=NULL,work_after_json=NULL,objects_json='{}',metrics_json='{}' WHERE id=? AND version=? AND state='complete'`).bind(actor.actor_id,actor.session_hash,id,run.version),c.env.DB.prepare('UPDATE legacy_import_worker_parts SET verified=0,loaded_rows=0,preflight_rows=0,applied_rows=0,checked_rows=0 WHERE run_id=?').bind(id),c.env.DB.prepare('UPDATE legacy_import_worker_counts SET journal_rows=0,mapped_rows=0,archived_rows=0,erased_rows=0,applied_rows=0,replayed_rows=0,holds=0 WHERE run_id=?').bind(id)],{version:run.version,state:'complete'})
 }else{
  const other=await c.env.DB.prepare("SELECT 1 FROM legacy_import_worker_runs WHERE project_id=? AND state IN ('queued','running','paused')").bind(actor.project_id).first();if(other)refuse('run_state_conflict')
  const now=Date.now(),mode=manifest.source.delta!==undefined||manifest.source.since!==undefined?'delta':'full'
  await controlCommit(c,{id,...actor,contract_version:version,manifest_sha256:sha,source_project_id:manifest.source.projectId},[c.env.DB.prepare(`INSERT INTO legacy_import_worker_runs(id,contract_version,manifest_sha256,project_id,source_project_id,actor_id,session_hash,mode,exclude_json,state,phase,created_at,updated_at,started_at) VALUES(?,?,?,?,?,?,?,?,?,'queued','verify_package',?,?,?)`).bind(id,version,sha,actor.project_id,manifest.source.projectId,actor.actor_id,actor.session_hash,mode,JSON.stringify(exclude),now,now,now)])
 }
 run=(await getRun(c.env,id))!;if(held)await renewCustody(c.env,{sha,generation:held.generation},{projectId:actor.project_id,actorId:actor.actor_id,sessionHash:actor.session_hash},'resume');await enqueue(c.env,run);return c.json({data:view(run)},202)
})
legacyRunnerRoutes.post(`${root}/resume`,async c=>{
 const {actor,sha,manifest,id,held,version}=await admission(c),input=await body(c);approval(input,sha);if(version===1)destination(manifest.source.projectId,actor.project_id)
 const approved=version===2?await getAdoption(c.env.DB,sha):null
 if(version===2&&(!approved||approved.session_hash!==actor.session_hash||approved.approver_id!==actor.actor_id))refuse('adoption_approval_required')
 const run=await getRun(c.env,id);if(!run||run.project_id!==actor.project_id)refuse('run_not_found',404)
 if(run.contract_version!==version)refuse('unsupported_contract_version')
 if(run.state==='complete'||run.state==='queued'||run.state==='running')return c.json({data:view(run)},200)
 if(await c.env.DB.prepare("SELECT 1 FROM legacy_import_worker_runs WHERE project_id=? AND id<>? AND state IN ('queued','running','paused')").bind(actor.project_id,id).first())refuse('run_state_conflict')
 await controlCommit(c,{...run,...actor},[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='queued',actor_id=?,session_hash=?,version=version+1,lease_token=NULL,lease_until=NULL,error_code=NULL,next_at=0,updated_at=${dbNow} WHERE id=? AND version=?`).bind(actor.actor_id,actor.session_hash,id,run.version)])
 const resumed=(await getRun(c.env,id))!;if(held)await renewCustody(c.env,{sha,generation:held.generation},{projectId:actor.project_id,actorId:actor.actor_id,sessionHash:actor.session_hash},'resume');await enqueue(c.env,resumed);return c.json({data:view(resumed)},202)
})
legacyRunnerRoutes.post(`${root}/stop`,async c=>{
 const {actor,id,held,sha}=await admission(c,false);await body(c)
 const run=await getRun(c.env,id);if(!run||run.project_id!==actor.project_id)refuse('run_not_found',404)
 if(run.state==='complete'||run.state==='stopped')return c.json({data:view(run)},200)
 const stopped=await controlCommit(c,{...run,...actor},[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='stopped',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=${dbNow} WHERE id=? AND state NOT IN ('complete','stopped')`).bind(id),...(held?[c.env.DB.prepare(`UPDATE legacy_package_custody SET retention_state='stopped',last_explicit_activity_at=${dbNow},expires_at=min(absolute_expires_at,${dbNow}+86400000) WHERE manifest_sha256=? AND generation=? AND retention_state<>'stopped'`).bind(sha,held.generation)]:[])])
 if(held)await renewCustody(c.env,{sha,generation:held.generation},{projectId:actor.project_id,actorId:actor.actor_id,sessionHash:actor.session_hash},'stopped')
 return c.json({data:view((await getRun(c.env,id))!)},stopped[1].meta.changes?202:200)
})
legacyRunnerRoutes.get(`${root}/result`,async c=>{
 const {actor,id,held}=await admission(c,false),run=await getRun(c.env,id);if(!run||run.project_id!==actor.project_id)refuse('run_not_found',404)
 const value=await result(c.env,run)
 const principal={actorId:actor.actor_id,sessionHash:actor.session_hash,setupProjectId:actor.project_id,expectedEmail:expectedOwnerEmail(c.env)},owner=firstOwnerPredicate(principal)
 const installationOwner=!!await c.env.DB.prepare(owner.sql).bind(...owner.params!).first()
 const {diagnostics,work,...scoped}=value
 const source=held?!!await c.env.DB.prepare(`SELECT 1 FROM legacy_package_custody c WHERE manifest_sha256=? AND ${activeCustody}`).bind(run.manifest_sha256).first():true
 return c.json({data:{...scoped,run:{...value.run,canResume:value.run.canResume&&source},...(installationOwner?{diagnostics,work}:{work:{before:{},after:null,delta:null,unchanged:null},diagnosticsUnavailable:'installation_owner_required'}),...(held?{sourceCustody:{status:!source&&['ready','admitting'].includes(held.status)?Math.min(held.expires_at,held.absolute_expires_at)<=Date.now()?'expired':'invalidated':held.status,expiresAt:held.expires_at,absoluteExpiresAt:held.absolute_expires_at,sourcePurged:held.status==='purged',invalidated:!source,cleanupPending:!source&&held.status!=='purged',canResume:source&&value.run.canResume},...(run.contract_version===2?{adoption:{destinationProjectId:run.source_project_id,membershipPolicy:'historical memberships; no access created'}}:{syntheticOnly:true,cleanupOnly:true})}:{syntheticOnly:true})}})
})
legacyRunnerRoutes.post(`${root}/discard`,async c=>{
 const {actor,sha,held}=await admission(c,false);await body(c)
 if(!held)refuse('unsupported_contract_version')
 const native=c.get('actor');await requireStepUp(c,native,'legacy.discard')
 await discardCustody(c.env,{sha,generation:held.generation},{projectId:actor.project_id,actorId:actor.actor_id,sessionHash:actor.session_hash})
 const closed=(await getCustody(c.env.DB,sha))!;await enqueueCleanup(c.env,closed)
 return c.json({data:{manifestSha256:sha,status:closed.status,cleanupPending:true}},202)
})

legacyRunnerRoutes.get(LEGACY_ROUTE,async c=>{
 const actor=await importActor(c);await requireInstallationOwner(c,actor.project_id)
 const rows=await c.env.DB.prepare('SELECT * FROM legacy_import_worker_runs WHERE project_id=? ORDER BY updated_at DESC,id LIMIT 50').bind(actor.project_id).all<Run>()
 return c.json({data:rows.results.map(run=>view(run))})
})

/** Explicit first-owner cleanup of a known old synthetic v1 package. Never starts/imports it. */
legacyRunnerRoutes.post(`${root}/cleanup-v1`,async c=>{
 const setup=c.req.param('projectId')!,sha=c.req.param('sha')!
 const {principal}=await requireInstallationOwner(c,setup)
 await requireStepUp(c,c.get('actor'),'legacy.cleanup-v1');await body(c)
 const held=await beginLegacyCleanup(c.env,sha,setup,firstOwnerPredicate(principal))
 await cleanupStep(c.env,sha,held.generation)
 const current=(await getCustody(c.env.DB,sha))!
 await enqueueCleanup(c.env,current)
 return c.json({data:{manifestSha256:sha,status:current.status,cleanupOnly:true,seedingComplete:!!current.seeding_complete,cleanupPending:current.status!=='purged'}},202)
})
