import {zendeskDiagnosticsRoutes} from '../zendesk-diagnostics/routes'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {importActor,type ImportActor} from '../routes'
import {getConnection} from '../zendesk-connection/store'
import {covered,pullBatches,pullFingerprint} from './approval'
import {enqueuePull} from './notify'
import {getPull,latestPulls,savePull,type PullRow} from './pull-store'
import {access,resumeBatches,takeOverPatch,takeOverStatements} from './takeover'
import {pullView} from './view'
const root='/projects/:projectId/zendesk/pulls'
export const zendeskPullRoutes=new Hono<AppEnv>()
zendeskPullRoutes.route('/',zendeskDiagnosticsRoutes)
/** The workspace's pull, whoever started it: every owner and admin sees it. */
async function workspacePull(c:Context<AppEnv>){const actor=await importActor(c),pull=await getPull(c.env,c.req.param('pullId')!);if(!pull||pull.project_id!==actor.project_id)throw new HTTPException(404);if(c.req.method!=='GET'&&pull.authority_mode==='rehearsal')throw new HTTPException(403,{message:'Use the rehearsal copy controls'});return {actor,pull}}
const view=async(c:Context<AppEnv>,actor:ImportActor,id:string)=>{const pull=(await getPull(c.env,id))!;return pullView(c.env,pull,await access(c.env,pull,actor))}
const othersPull=()=>new HTTPException(403,{message:'This pull was started by another member of this workspace'})
const audit=(c:Context<AppEnv>,actor:ImportActor,action:string,pull:string,detail:Record<string,unknown>={})=>auditStatement(c.env.DB,{projectId:actor.project_id,category:'data',action,actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import',id:pull},detail:{vendor:'zendesk',...detail}})
/** A new session takes over a pull's background work, as Resume import does for a run. */
const withSession=(pull:PullRow,actor:ImportActor):PullRow=>({...pull,session_hash:actor.session_hash})

zendeskPullRoutes.get(root,async c=>{const actor=await importActor(c),rows=(await latestPulls(c.env,actor.project_id)).results;return c.json({data:await Promise.all(rows.map(async p=>pullView(c.env,p,await access(c.env,p,actor))))})})
zendeskPullRoutes.get(`${root}/:pullId`,async c=>{const {actor,pull}=await workspacePull(c);return c.json({data:await pullView(c.env,pull,await access(c.env,pull,actor))})})

/** Pull everything: one pull at a time per workspace. A pull after a finished one
 * starts from that pull's saved export cursors, so it reads only new or changed records.
 * Once a pulled batch has been undone since then, the next pull reads the whole account
 * again: what the undo took out comes back, and what is still held is settled away. */
zendeskPullRoutes.post(root,async c=>{
 const actor=await importActor(c),connection=await getConnection(c.env,actor.project_id)
 if(connection?.state!=='connected')throw new HTTPException(409,{message:connection?.state==='reconnect'?'Reconnect Zendesk, then pull again.':'Connect Zendesk first.'})
 const previous=(await latestPulls(c.env,actor.project_id,20)).results
 const active=previous.find(p=>!['applied','abandoned'].includes(p.state));if(active)throw new HTTPException(409,{message:'A Zendesk pull is already in progress for this workspace.'})
 const base=previous.find(p=>p.subdomain===connection.subdomain&&p.state==='applied'&&p.resume_json)
 const undone=base&&await c.env.DB.prepare("SELECT 1 FROM move_in_zendesk_pulls p CROSS JOIN move_in_zendesk_pull_runs pr ON pr.pull_id=p.id CROSS JOIN move_in_runs r ON r.id=pr.run_id WHERE p.project_id=? AND p.subdomain=? AND r.state NOT IN ('ready','completed','erased') AND r.updated_at>=? LIMIT 1").bind(actor.project_id,connection.subdomain,base.created_at).first()
 const start=base&&!undone?base.resume_json!:'{}'
 const id=crypto.randomUUID(),now=Date.now()
 await c.env.DB.batch([c.env.DB.prepare("INSERT INTO move_in_zendesk_pulls(id,project_id,actor_id,session_hash,subdomain,state,phase,start_json,created_at,updated_at) VALUES(?,?,?,?,?,'pulling','fields',?,?,?)").bind(id,actor.project_id,actor.actor_id,actor.session_hash,connection.subdomain,start,now,now),audit(c,actor,'import.pull.started',id,{repeat:start!=='{}'})])
 await enqueuePull(c.env,{id,project_id:actor.project_id})
 return c.json({data:await view(c,actor,id)},201)
})

/** One approval for the whole pull. It binds every batch's reviewed fingerprint;
 * each batch whose review refused nothing then applies without further clicks. */
zendeskPullRoutes.post(`${root}/:pullId/approve`,async c=>{
 const {actor,pull}=await workspacePull(c);if(pull.actor_id!==actor.actor_id)throw othersPull()
 const body=await c.req.json().catch(()=>({})) as {fingerprint?:unknown},batches=await pullBatches(c.env,pull.id)
 if(pull.state!=='ready'||typeof body.fingerprint!=='string'||body.fingerprint!==pullFingerprint(batches))throw new HTTPException(409,{message:'Review the current pull before approving'})
 const approval=covered(batches).map(b=>({runId:b.run_id,fingerprint:b.review_fingerprint!})),next=withSession(pull,actor)
 await savePull(c.env,next,{state:'applying',phase:'apply',approval_json:JSON.stringify(approval),approved_at:Date.now(),error:null},[audit(c,actor,'import.pull.approved',pull.id,{batches:approval.length})])
 await enqueuePull(c.env,pull)
 return c.json({data:await view(c,actor,pull.id)},202)
})

/** Resume after a stop: the current session takes over the pull, and every batch that
 * stopped, in review or while importing, continues from its checkpoint. Before approval,
 * a batch reviewed under an earlier mapping revision is reviewed again, so a pull that
 * was ready goes back to review. A workspace
 * owner resuming another member's stopped pull takes it over: it starts again under
 * the owner, and the other member's batches stay as their ordinary imports. */
zendeskPullRoutes.post(`${root}/:pullId/resume`,async c=>{
 const {actor,pull}=await workspacePull(c)
 if(pull.actor_id!==actor.actor_id){
  const allowed=await access(c.env,pull,actor)
  if(!allowed.canTakeOver){if(actor.role!=='owner')throw othersPull();throw new HTTPException(409,{message:pull.state==='applying'?'An approved pull continues under the member who approved it':['applied','abandoned'].includes(pull.state)?'This pull has nothing to resume':'This pull has not stopped; stop it, or take it over once it stops'})}
  const next={...pull,actor_id:actor.actor_id,session_hash:actor.session_hash}
  await savePull(c.env,next,takeOverPatch(actor),[...takeOverStatements(c.env,pull.id),audit(c,actor,'import.pull.taken_over',pull.id,{previousActor:pull.actor_id})])
  await enqueuePull(c.env,pull)
  return c.json({data:await view(c,actor,pull.id)},202)
 }
 if(!['pulling','reviewing','ready','applying'].includes(pull.state))throw new HTTPException(409,{message:'This pull has nothing to resume'})
 const replanned=await resumeBatches(c.env,pull,actor)
 await savePull(c.env,withSession(pull,actor),{error:null,next_at:0,session_hash:actor.session_hash,...(replanned&&pull.state==='ready'?{state:'reviewing',phase:'review'}:{})})
 await enqueuePull(c.env,pull)
 return c.json({data:await view(c,actor,pull.id)},202)
})

/** Stop a pull and remove what it staged. Before approval, the member who started it or
 * a workspace owner may stop it. An approved pull that has stopped, or whose member can
 * no longer act, a workspace owner may stop: the batches it imported stay as ordinary
 * imports and the rest are not imported. The workspace's next pull reads Zendesk again
 * and imports what this one did not. Each stop is in the security log. */
zendeskPullRoutes.post(`${root}/:pullId/abandon`,async c=>{
 const {actor,pull}=await workspacePull(c)
 if(pull.actor_id!==actor.actor_id&&actor.role!=='owner')throw othersPull()
 if(!(await access(c.env,pull,actor)).canStop)throw new HTTPException(409,{message:pull.state==='applying'?'An approved pull keeps importing while it runs; a workspace owner can stop it once it stops or its member can no longer act':'This pull has already finished'})
 // Before approval the stop wins over the pull's own next step, unless its member has
 // approved it meanwhile. An approved pull is stopped only as it was seen, so a resume
 // by its member in between is never undone.
 const approved=pull.state==='applying',fence=approved?' AND version=?':" AND state IN ('pulling','reviewing','ready')",at=approved?[pull.version]:[]
 try{await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM move_in_zendesk_pulls WHERE id=?${fence}) THEN 1 ELSE 0 END`).bind(pull.id,...at),
  c.env.DB.prepare(`UPDATE move_in_zendesk_pulls SET state='abandoned',lease_until=NULL,version=version+1,updated_at=? WHERE id=?${fence}`).bind(Date.now(),pull.id,...at),
  c.env.DB.prepare('DELETE FROM move_in_zendesk_staged WHERE pull_id=?').bind(pull.id),
  audit(c,actor,'import.pull.abandoned',pull.id,{startedBy:pull.actor_id,approved}),
  c.env.DB.prepare('DELETE FROM ik_d1_assertions')])}
 catch(error){if((await getPull(c.env,pull.id))?.version!==pull.version)throw new HTTPException(409,{message:'This pull changed; look at it again'});throw error}
 return c.json({data:await view(c,actor,pull.id)})
})
