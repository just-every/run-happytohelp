import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv,Env} from '../../platform/env'
import {requireActor,hashToken} from '../../platform/auth'
import {sha256} from '../import-kit/src/d1/index'
import {boundedDatabase} from '../../platform/d1-budget'
import {LIMITS,type Run,type Vendor} from './types'
import {approve,enqueue,getRun} from './service'
import {guarded} from './context'
import {putPrivate} from './private-custody'
import {updateRun} from './run-store'
import {requireAuditedCustody} from './legacy-identities'
import {AdmissionError} from './readers/admission-error'
import {uploadIdentities,erasedUpload,identityStatements} from './identities'
import {putUninterpretedIndex} from './uninterpreted-identities'
import {planSummary,reviewPlan} from './review-report'
import type {Next} from 'hono'
import {auditStatement,requestSource} from '../audit/record'
export async function importActor(c:Context<AppEnv>){const actor=await requireActor(c),project=c.req.param('projectId')!;if(actor.role==='contact')throw new HTTPException(403);const membership=await c.env.DB.prepare(`SELECT m.role FROM memberships m JOIN projects p ON p.id=m.project_id WHERE m.project_id=? AND m.user_id=? AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(project,actor.id).first<{role:string}>();if(!membership)throw new HTTPException(404);if(!['owner','admin'].includes(membership.role))throw new HTTPException(403,{message:'Workspace owner or admin required'});const token=c.req.header('Authorization')?.replace(/^Bearer /,'')||c.req.header('Cookie')?.match(/(?:^|;\s*)h2h_session=([^;]+)/)?.[1];return {project_id:project,actor_id:actor.id,session_hash:await hashToken(token!)}}
async function owned(c:Context<AppEnv>){const actor=await importActor(c),run=await getRun(c.env,c.req.param('runId')!);if(!run||run.project_id!==actor.project_id||run.actor_id!==actor.actor_id)throw new HTTPException(404);return {run,actor}}
/** One run with its full review report; the list returns summaries. */
async function runView(env:Env,run:Run){return {...publicRun(run),plan:await reviewPlan(env,run)}}
export function publicRun(run:Run){return {id:run.id,vendor:run.vendor,filename:run.filename,bytes:run.bytes,state:run.state,cursor:run.cursor,parsed:run.parsed_total,error:run.error,createdAt:run.created_at,plan:planSummary(run.plan_json),report:run.report_json?JSON.parse(run.report_json):null}}
async function uploadBytes(request:Request){if(Number(request.headers.get('content-length'))>LIMITS.inputBytes)throw new HTTPException(413,{message:'Upload limit is 2 MiB'});const reader=request.body?.getReader();if(!reader)return new Uint8Array(0);let length=0;const chunks:Uint8Array[]=[];try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>LIMITS.inputBytes){await reader.cancel();throw new HTTPException(413,{message:'Upload limit is 2 MiB'})}chunks.push(next.value)}}finally{reader.releaseLock()}const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result}
export const moveInRoutes=new Hono<AppEnv>()
moveInRoutes.use('*',async(c,next)=>{c.env={...c.env,DB:boundedDatabase(c.env.DB).database};await next()})
const root='/projects/:projectId/imports'
// Starting, applying, resuming and undoing an import are recorded in the workspace's security log.
moveInRoutes.use(`${root}/*`,recordImport)
moveInRoutes.use(root,recordImport)
async function recordImport(c:Context<AppEnv>,next:Next){
 await next()
 const actor=c.get('actor')
 if(c.req.method!=='POST'||c.res.status>=300||!actor)return
 const step=c.req.path.split('/').at(-1),action=['apply','resume','undo'].includes(step!)?`import.${step}`:'import.started'
 const result=await c.res.clone().json().catch(()=>null) as {alreadyImported?:boolean;writes?:number;data?:{id?:string}}|null
 // An upload already on record is a no-op that writes nothing, the log included.
 if(result?.alreadyImported||result?.writes===0)return
 const run=c.req.param('runId')||result?.data?.id
 await auditStatement(c.env.DB,{projectId:c.req.param('projectId')!,category:'data',action,actor:{type:'user',id:actor.id},source:requestSource(c),...(run?{target:{type:'import',id:String(run)}}:{}),detail:{vendor:c.req.query('vendor')||null}}).run()
}
function filenameHeader(value:string|undefined){try{return value?decodeURIComponent(value):''}catch{throw new HTTPException(400,{message:'Invalid encoded filename'})}}
moveInRoutes.get(root,async c=>{const actor=await importActor(c),rows=await c.env.DB.prepare('SELECT * FROM move_in_runs WHERE project_id=? AND actor_id=? ORDER BY created_at DESC LIMIT 100').bind(actor.project_id,actor.actor_id).all<Run>();return c.json({data:rows.results.map(publicRun),limits:LIMITS})})
moveInRoutes.post(root,async c=>{
 const actor=await importActor(c),vendor=c.req.query('vendor') as Vendor,filename=filenameHeader(c.req.header('X-Import-Filename'))
 if(!['zendesk','intercom','helpscout','freshdesk'].includes(vendor)||!filename||filename.length>200||filename.includes('/')||filename.includes('\\')||/[\x00-\x1f]/.test(filename))throw new HTTPException(400,{message:'Choose a supported export and filename'})
 if(vendor==='intercom'&&c.req.header('X-Import-Schema')!=='2.16')throw new HTTPException(400,{message:'Select the Data API 2.16 export schema'})
 return stageImport(c.env,actor,vendor,filename,await uploadBytes(c.req.raw))
})
/** Shared admission for the upload route and explicitly delegated provider reads.
 * The same live-session, identity, erasure and private-custody guards own writes. */
export async function stageImport(env:Env,actor:Awaited<ReturnType<typeof importActor>>,vendor:Vendor,filename:string,bytes:Uint8Array){
 const json=(data:unknown,status=200)=>Response.json(data,{status})
 const hash=sha256(bytes),prior=await env.DB.prepare('SELECT * FROM move_in_runs WHERE project_id=? AND vendor=? AND artifact_hash=?').bind(actor.project_id,vendor,hash).first<Run>();if(prior){if(prior.actor_id!==actor.actor_id)throw new HTTPException(409,{message:'This export belongs to another import reviewer'});if(prior.state==='erased')throw new HTTPException(410,{message:'This export contains erased data and cannot be replayed'});if(prior.state==='uploading'){try{await requireAuditedCustody(env,{...prior,...actor})}catch{throw new HTTPException(409,{message:'This older export cannot yet be fully indexed. Its existing custody is retained; native contact erasure remains available.'})}const retained=await uploadIdentities(actor.project_id,vendor,filename,bytes);if(!retained.complete)await putUninterpretedIndex(env,{...prior,...actor},retained.uninterpreted);await putPrivate(env,{...prior,...actor},prior.object_key,bytes,{httpMetadata:{contentType:'application/octet-stream'}});await updateRun(env,{...prior,...actor},{state:'uploaded',session_hash:actor.session_hash});const resumed=(await getRun(env,prior.id))!;await enqueue(env,resumed);return json({data:await runView(env,resumed)},201)}return json({data:await runView(env,prior),alreadyImported:prior.state==='completed',writes:0})}
 let indexed;try{indexed=await uploadIdentities(actor.project_id,vendor,filename,bytes)}catch(error){if(error instanceof AdmissionError)return json({error:`Upload refused: ${error.artifact}, line ${error.row}, path ${error.pointer||'/'}: ${error.message}. No source files or import were saved.`,diagnostic:error.diagnostic},422);throw error}const {links:identities,complete,uninterpreted}=indexed;if(await env.DB.prepare("SELECT 1 FROM move_in_runs WHERE project_id=? AND vendor=? AND state='erased' AND identity_audited<>1 LIMIT 1").bind(actor.project_id,vendor).first())throw new HTTPException(410,{message:'An older export could not be fully indexed before contact erasure. New imports of this format are refused because its erased identities cannot be checked'});if(await erasedUpload(env,actor.project_id,identities))return json({error:'This export contains erased identities and cannot be restored',code:'erased_identity_match'},410)
 if(!complete&&await env.DB.prepare('SELECT 1 FROM move_in_erased_identities WHERE project_id=? LIMIT 1').bind(actor.project_id).first()){
  const diagnostic=indexed.incomplete!,{artifact,row,pointer}=diagnostic.location
  return json({error:`This export's identity check is incomplete, so it cannot be checked safely against this workspace's erased identities. ${artifact}, line ${row}, path ${pointer||'/'}: ${diagnostic.code.replaceAll('_',' ')}${diagnostic.reason?` (${diagnostic.reason.replaceAll('_',' ')})`:''}. Supply a complete supported export and upload again. No source files or import were saved.`,code:'source_identity_index_incomplete',diagnostic},410)
 }
 const id=crypto.randomUUID(),key=`move-in/${actor.project_id}/${id}/original`,now=Date.now();
 try{await guarded(env,actor as Run,[env.DB.prepare("INSERT INTO move_in_runs(id,project_id,actor_id,session_hash,vendor,filename,artifact_hash,object_key,bytes,state,created_at,updated_at,identity_complete,identity_audited) VALUES(?,?,?,?,?,?,?,?,?,'uploading',?,?,?,1)").bind(id,actor.project_id,actor.actor_id,actor.session_hash,vendor,filename,hash,key,bytes.length,now,now,complete?1:0),...identityStatements(env,actor.project_id,id,identities),env.DB.prepare("INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM move_in_runs WHERE project_id=? AND vendor=? AND state='erased' AND identity_audited<>1) THEN 1 ELSE 0 END").bind(actor.project_id,vendor),env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN ? OR NOT EXISTS(SELECT 1 FROM move_in_erased_identities WHERE project_id=?) THEN 1 ELSE 0 END').bind(complete?1:0,actor.project_id)])}catch(error){await env.FILES.delete(key);throw error}
 let run=(await getRun(env,id))!;if(!complete)await putUninterpretedIndex(env,run,uninterpreted);await putPrivate(env,run,key,bytes,{httpMetadata:{contentType:'application/octet-stream'},customMetadata:{projectId:actor.project_id,runId:id}});await updateRun(env,run,{state:'uploaded'});run=(await getRun(env,id))!;await enqueue(env,run);return json({data:await runView(env,run)},201)
}
moveInRoutes.get(`${root}/:runId`,async c=>{const {run}=await owned(c);return c.json({data:await runView(c.env,run)})})
moveInRoutes.post(`${root}/:runId/apply`,async c=>{const {run,actor}=await owned(c),body=await c.req.json();if(run.state!=='ready'||typeof body.fingerprint!=='string'||JSON.parse(run.plan_json!).fingerprint!==body.fingerprint)throw new HTTPException(409,{message:'Review the current import plan before approving'});if(!run.total)throw new HTTPException(409,{message:'Nothing in this file can be imported. Fix the rejected records shown in the review, then upload the corrected file.'});await approve(c.env,{...run,...actor},body.fingerprint);return c.json({data:await runView(c.env,(await getRun(c.env,run.id))!)},202)})
moveInRoutes.post(`${root}/:runId/resume`,async c=>{const {run,actor}=await owned(c);if(!['uploaded','parsing','planning','applying','undoing'].includes(run.state))throw new HTTPException(409);await guarded(c.env,{...run,...actor},[c.env.DB.prepare('UPDATE move_in_runs SET error=NULL,session_hash=? WHERE id=?').bind(actor.session_hash,run.id)]);await enqueue(c.env,run);return c.json({data:await runView(c.env,(await getRun(c.env,run.id))!)},202)})
moveInRoutes.post(`${root}/:runId/undo`,async c=>{const {run,actor}=await owned(c);if(run.state!=='completed'&&!(run.state==='applying'&&run.error))throw new HTTPException(409,{message:'Only a completed or stopped import can be undone'});await guarded(c.env,{...run,...actor},[c.env.DB.prepare("UPDATE move_in_runs SET state='undoing',error=NULL,session_hash=? WHERE id=? AND state=?").bind(actor.session_hash,run.id,run.state)]);await enqueue(c.env,run);return c.json({data:await runView(c.env,(await getRun(c.env,run.id))!)},202)})
