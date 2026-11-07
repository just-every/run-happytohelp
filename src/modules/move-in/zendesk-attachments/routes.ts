import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Context} from 'hono'
import type {AppEnv} from '../../../platform/env'
import {auditStatement,requestSource} from '../../audit/record'
import {importActor,type ImportActor} from '../routes'
import {getConnection} from '../zendesk-connection/store'
import {enqueueRun,getRun,latestRun,type AttachmentRun} from './store'
import {attachmentView} from './view'
const root='/projects/:projectId/zendesk/attachments'
export const zendeskAttachmentRoutes=new Hono<AppEnv>()
const audit=(c:Context<AppEnv>,actor:ImportActor,action:string,run:string,detail:Record<string,unknown>={})=>auditStatement(c.env.DB,{projectId:actor.project_id,category:'data',action,actor:{type:'user',id:actor.actor_id},source:requestSource(c),target:{type:'import',id:run},detail:{vendor:'zendesk',...detail}})
async function workspaceRun(c:Context<AppEnv>){const actor=await importActor(c),run=await getRun(c.env,c.req.param('runId')!);if(!run||run.project_id!==actor.project_id)throw new HTTPException(404);return {actor,run}}
const view=async(c:Context<AppEnv>,id:string)=>attachmentView(c.env,(await getRun(c.env,id)) as AttachmentRun)

zendeskAttachmentRoutes.get(root,async c=>{const actor=await importActor(c),run=await latestRun(c.env,actor.project_id);return c.json({data:run?await attachmentView(c.env,run):null})})
zendeskAttachmentRoutes.get(`${root}/:runId`,async c=>{const {run}=await workspaceRun(c);return c.json({data:await attachmentView(c.env,run)})})

/** Fetch every imported comment's files over the workspace's existing connection. It
 * changes no imported record, only adds files to them, so it needs no approval. One run
 * at a time per workspace; a run after a finished one fetches only what is not stored. */
zendeskAttachmentRoutes.post(root,async c=>{
 const actor=await importActor(c),connection=await getConnection(c.env,actor.project_id)
 if(connection?.state!=='connected')throw new HTTPException(409,{message:connection?.state==='reconnect'?'Reconnect Zendesk, then fetch the files again.':'Connect Zendesk first.'})
 const held=await c.env.DB.prepare("SELECT COUNT(*) n FROM move_in_conversations WHERE project_id=? AND vendor='zendesk'").bind(actor.project_id).first<{n:number}>()
 if(!held?.n)throw new HTTPException(409,{message:'Import Zendesk tickets first; their files come after.'})
 if(await c.env.DB.prepare("SELECT 1 FROM move_in_zendesk_attachment_pulls WHERE project_id=? AND state='running'").bind(actor.project_id).first())throw new HTTPException(409,{message:'Zendesk files are already being fetched for this workspace.'})
 const id=crypto.randomUUID(),now=Date.now()
 try{await c.env.DB.batch([
  c.env.DB.prepare("INSERT INTO move_in_zendesk_attachment_pulls(id,project_id,actor_id,session_hash,subdomain,state,created_at,updated_at) VALUES(?,?,?,?,?,'running',?,?)").bind(id,actor.project_id,actor.actor_id,actor.session_hash,connection.subdomain,now,now),
  audit(c,actor,'import.attachments.started',id,{conversations:held.n})])}
 catch(error){if(await c.env.DB.prepare("SELECT 1 FROM move_in_zendesk_attachment_pulls WHERE project_id=? AND state='running'").bind(actor.project_id).first())throw new HTTPException(409,{message:'Zendesk files are already being fetched for this workspace.'});throw error}
 await enqueueRun(c.env,{id,project_id:actor.project_id})
 return c.json({data:await view(c,id)},201)
})

/** After a stop, this session takes the run over and it continues from its checkpoint. */
zendeskAttachmentRoutes.post(`${root}/:runId/resume`,async c=>{
 const {actor,run}=await workspaceRun(c)
 if(run.state!=='running'||!run.error)throw new HTTPException(409,{message:run.state==='done'?'This run has finished; start a new one to fetch what is left.':'This run has not stopped.'})
 const updated=await c.env.DB.prepare("UPDATE move_in_zendesk_attachment_pulls SET actor_id=?,session_hash=?,error=NULL,next_at=0,lease_until=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND state='running' AND error IS NOT NULL").bind(actor.actor_id,actor.session_hash,Date.now(),run.id,run.version).run()
 if(!updated.meta.changes)throw new HTTPException(409,{message:'This run changed; look at it again.'})
 await audit(c,actor,'import.attachments.resumed',run.id,{previousActor:run.actor_id===actor.actor_id?null:run.actor_id}).run()
 await enqueueRun(c.env,run)
 return c.json({data:await view(c,run.id)},202)
})
