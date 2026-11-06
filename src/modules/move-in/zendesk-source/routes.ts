import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {guarded} from '../context'
import {enqueue,getRun} from '../service'
import {importActor,type ImportActor} from '../routes'
import type {Run} from '../types'
import {getConnection} from '../zendesk-connection/store'
import {covered,pullBatches,pullFingerprint} from './approval'
import {enqueuePull} from './notify'
import {getPull,latestPulls,savePull,type PullRow} from './pull-store'
import {pullView} from './view'
const root='/projects/:projectId/zendesk/pulls'
export const zendeskPullRoutes=new Hono<AppEnv>()
async function ownedPull(c:Context<AppEnv>){const actor=await importActor(c),pull=await getPull(c.env,c.req.param('pullId')!);if(!pull||pull.project_id!==actor.project_id||pull.actor_id!==actor.actor_id)throw new HTTPException(404);return {actor,pull}}
const audit=(c:Context<AppEnv>,actor:ImportActor,action:string,pull:string,detail:Record<string,unknown>={})=>auditStatement(c.env.DB,{projectId:actor.project_id,category:'data',action,actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import',id:pull},detail:{vendor:'zendesk',...detail}})
/** A new session takes over a pull's background work, as Resume import does for a run. */
const withSession=(pull:PullRow,actor:ImportActor):PullRow=>({...pull,session_hash:actor.session_hash})

zendeskPullRoutes.get(root,async c=>{const actor=await importActor(c),rows=(await latestPulls(c.env,actor.project_id)).results.filter(p=>p.actor_id===actor.actor_id);return c.json({data:await Promise.all(rows.map(p=>pullView(c.env,p)))})})
zendeskPullRoutes.get(`${root}/:pullId`,async c=>{const {pull}=await ownedPull(c);return c.json({data:await pullView(c.env,pull)})})

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
 const pull=(await getPull(c.env,id))!;await enqueuePull(c.env,pull)
 return c.json({data:await pullView(c.env,pull)},201)
})

/** One approval for the whole pull. It binds every batch's reviewed fingerprint;
 * each batch whose review refused nothing then applies without further clicks. */
zendeskPullRoutes.post(`${root}/:pullId/approve`,async c=>{
 const {actor,pull}=await ownedPull(c),body=await c.req.json().catch(()=>({})) as {fingerprint?:unknown},batches=await pullBatches(c.env,pull.id)
 if(pull.state!=='ready'||typeof body.fingerprint!=='string'||body.fingerprint!==pullFingerprint(batches))throw new HTTPException(409,{message:'Review the current pull before approving'})
 const approval=covered(batches).map(b=>({runId:b.run_id,fingerprint:b.review_fingerprint!})),next=withSession(pull,actor)
 await savePull(c.env,next,{state:'applying',phase:'apply',approval_json:JSON.stringify(approval),approved_at:Date.now(),error:null},[audit(c,actor,'import.pull.approved',pull.id,{batches:approval.length})])
 await enqueuePull(c.env,pull)
 return c.json({data:await pullView(c.env,(await getPull(c.env,pull.id))!)},202)
})

/** Resume after a stop: the current session takes over, and a stopped approved batch resumes too. */
zendeskPullRoutes.post(`${root}/:pullId/resume`,async c=>{
 const {actor,pull}=await ownedPull(c)
 if(!['pulling','reviewing','applying'].includes(pull.state))throw new HTTPException(409,{message:'This pull has nothing to resume'})
 if(pull.state==='applying')for(const entry of JSON.parse(pull.approval_json||'[]') as {runId:string}[]){const run=await getRun(c.env,entry.runId);if(run?.error&&['applying','undoing'].includes(run.state)){await guarded(c.env,{...run,actor_id:actor.actor_id,session_hash:actor.session_hash} as Run,[c.env.DB.prepare('UPDATE move_in_runs SET error=NULL,session_hash=? WHERE id=?').bind(actor.session_hash,run.id)]);await enqueue(c.env,run)}}
 await savePull(c.env,withSession(pull,actor),{error:null,next_at:0,session_hash:actor.session_hash})
 await enqueuePull(c.env,pull)
 return c.json({data:await pullView(c.env,(await getPull(c.env,pull.id))!)},202)
})

/** Stop a pull before approval and remove what it staged. Batches it already packed stay as ordinary imports. */
zendeskPullRoutes.post(`${root}/:pullId/abandon`,async c=>{
 const {actor,pull}=await ownedPull(c)
 if(!['pulling','reviewing','ready'].includes(pull.state))throw new HTTPException(409,{message:'An approved pull cannot be abandoned; undo its imports instead'})
 await c.env.DB.batch([c.env.DB.prepare("UPDATE move_in_zendesk_pulls SET state='abandoned',lease_until=NULL,version=version+1,updated_at=? WHERE id=?").bind(Date.now(),pull.id),c.env.DB.prepare('DELETE FROM move_in_zendesk_staged WHERE pull_id=?').bind(pull.id),audit(c,actor,'import.pull.abandoned',pull.id)])
 return c.json({data:await pullView(c.env,(await getPull(c.env,pull.id))!)})
})
