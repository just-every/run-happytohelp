import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../../platform/env'
import {importActor} from '../../move-in/routes'
import {memberAccess} from '../../access/gate'
import {LEGACY_ROUTE,LEGACY_LIMITS} from '../worker-contract'
import {readManifest} from './reader'
import {refuse,WorkerImportError} from './errors'
import {getRun,enqueue,view,runAuthority,type Run} from './state'
import {dbNow} from '../lease'
import {result} from './result'
export const legacyRunnerRoutes=new Hono<AppEnv>()
const root=LEGACY_ROUTE+'/:sha'
legacyRunnerRoutes.use(`${root}/*`,async(c,next)=>{c.header('Cache-Control','no-store');await next()})
async function admission(c:any,readPackage=true){
 const actor=await importActor(c),access=await memberAccess(c.env.DB,actor.project_id,actor.actor_id)
 if(!access?.permissions.has('data.import'))throw new HTTPException(403)
 const sha=c.req.param('sha');if(!/^[a-f0-9]{64}$/.test(sha))refuse('invalid_request',400)
 const manifest=readPackage?await readManifest(c.env.FILES,sha,actor.project_id):undefined
 return {actor,sha,manifest:manifest!,id:`legacy-package:${sha}`}
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
async function controlCommit(c:any,run:Pick<Run,'id'|'project_id'|'actor_id'|'session_hash'>,statements:D1PreparedStatement[],expected?:{version:number;state:string}){
 const a=runAuthority(run),guard=expected?` AND EXISTS(SELECT 1 FROM legacy_import_worker_runs WHERE id=? AND version=? AND state=?)`:''
 try{return await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT (${a.sql})${guard}`).bind(...a.params,...(expected?[run.id,expected.version,expected.state]:[])),...statements,c.env.DB.prepare('DELETE FROM ik_d1_assertions')])}
 catch(error){if(expected){const current=await getRun(c.env,run.id);if(current?.version!==expected.version||current?.state!==expected.state)refuse('run_state_conflict')}throw error}
}

legacyRunnerRoutes.post(`${root}/start`,async c=>{
 const {actor,sha,manifest,id}=await admission(c),input=await body(c);approval(input,sha);destination(manifest.source.projectId,actor.project_id)
 if(Object.keys(input).some(key=>!['approvedManifestSha256','excludeTables','replay'].includes(key))||input.replay!==undefined&&typeof input.replay!=='boolean')refuse('invalid_request',400)
 const exclude=input.excludeTables??['ai_usages'];if(!Array.isArray(exclude)||exclude.length>1||exclude.some(value=>value!=='ai_usages'))refuse('invalid_request',400)
 let run=await getRun(c.env,id)
 if(run){
  if(run.project_id!==actor.project_id)refuse('run_not_found',404)
  if(run.exclude_json!==JSON.stringify(exclude))refuse('run_options_conflict')
  if(run.contract_version!==1)refuse('unsupported_contract_version')
  if(run.state!=='complete'||!input.replay)return c.json({data:view(run)},200)
  await controlCommit(c,{...run,...actor},[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='queued',phase='verify_package',cursor_json='{}',attempt=attempt+1,version=version+1,actor_id=?,session_hash=?,lease_token=NULL,lease_until=NULL,next_at=0,error_code=NULL,completed_at=NULL,verified_at=NULL,work_before_json=NULL,work_after_json=NULL,objects_json='{}',metrics_json='{}' WHERE id=? AND version=? AND state='complete'`).bind(actor.actor_id,actor.session_hash,id,run.version),c.env.DB.prepare('UPDATE legacy_import_worker_parts SET verified=0,loaded_rows=0,preflight_rows=0,applied_rows=0,checked_rows=0 WHERE run_id=?').bind(id),c.env.DB.prepare('UPDATE legacy_import_worker_counts SET journal_rows=0,mapped_rows=0,archived_rows=0,erased_rows=0,applied_rows=0,replayed_rows=0,holds=0 WHERE run_id=?').bind(id)],{version:run.version,state:'complete'})
 }else{
  const other=await c.env.DB.prepare("SELECT 1 FROM legacy_import_worker_runs WHERE project_id=? AND state IN ('queued','running','paused')").bind(actor.project_id).first();if(other)refuse('run_state_conflict')
  const now=Date.now(),mode=manifest.source.delta!==undefined||manifest.source.since!==undefined?'delta':'full'
  await controlCommit(c,{id,...actor},[c.env.DB.prepare(`INSERT INTO legacy_import_worker_runs(id,manifest_sha256,project_id,source_project_id,actor_id,session_hash,mode,exclude_json,state,phase,created_at,updated_at,started_at) VALUES(?,?,?,?,?,?,?,?,'queued','verify_package',?,?,?)`).bind(id,sha,actor.project_id,manifest.source.projectId,actor.actor_id,actor.session_hash,mode,JSON.stringify(exclude),now,now,now)])
 }
 run=(await getRun(c.env,id))!;await enqueue(c.env,run);return c.json({data:view(run)},202)
})
legacyRunnerRoutes.post(`${root}/resume`,async c=>{
 const {actor,sha,manifest,id}=await admission(c),input=await body(c);approval(input,sha);destination(manifest.source.projectId,actor.project_id)
 const run=await getRun(c.env,id);if(!run||run.project_id!==actor.project_id)refuse('run_not_found',404)
 if(run.contract_version!==1)refuse('unsupported_contract_version')
 if(run.state==='complete'||run.state==='queued'||run.state==='running')return c.json({data:view(run)},200)
 if(await c.env.DB.prepare("SELECT 1 FROM legacy_import_worker_runs WHERE project_id=? AND id<>? AND state IN ('queued','running','paused')").bind(actor.project_id,id).first())refuse('run_state_conflict')
 await controlCommit(c,{...run,...actor},[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='queued',actor_id=?,session_hash=?,version=version+1,lease_token=NULL,lease_until=NULL,error_code=NULL,next_at=0,updated_at=${dbNow} WHERE id=? AND version=?`).bind(actor.actor_id,actor.session_hash,id,run.version)])
 const resumed=(await getRun(c.env,id))!;await enqueue(c.env,resumed);return c.json({data:view(resumed)},202)
})
legacyRunnerRoutes.post(`${root}/stop`,async c=>{
 const {actor,id}=await admission(c,false);await body(c)
 const run=await getRun(c.env,id);if(!run||run.project_id!==actor.project_id)refuse('run_not_found',404)
 if(run.state==='complete'||run.state==='stopped')return c.json({data:view(run)},200)
 const stopped=await controlCommit(c,{...run,...actor},[c.env.DB.prepare(`UPDATE legacy_import_worker_runs SET state='stopped',version=version+1,lease_token=NULL,lease_until=NULL,updated_at=${dbNow} WHERE id=? AND state NOT IN ('complete','stopped')`).bind(id)])
 return c.json({data:view((await getRun(c.env,id))!)},stopped[1].meta.changes?202:200)
})
legacyRunnerRoutes.get(`${root}/result`,async c=>{const {actor,id}=await admission(c,false),run=await getRun(c.env,id);if(!run||run.project_id!==actor.project_id)refuse('run_not_found',404);return c.json({data:await result(c.env,run)})})
