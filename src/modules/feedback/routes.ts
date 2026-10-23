import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env,Actor} from '../../platform/env'
import {requireActor} from '../../platform/auth'
import {encryptToken} from '../integrations/secrets'
import {requireStepUp} from '../identity/two-factor/step-up'
import {auditStatement,requestSource} from '../audit/record'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {stageEmailMessageOptions} from '../integrations/email-command-options'
import {publishActivity} from '../conversations/activity'
import {events} from './events'
import {root,ticket,access,link,text} from './access'

export function feedbackRoutes(onMessage:(env:Env,message:Record<string,unknown>,actor:Actor)=>Promise<unknown>){
 const routes=new Hono<AppEnv>();routes.route('/',events)
 routes.get(root+'/settings',async c=>{const {actor}=await access(c,'integrations.install'),row=await c.env.DB.prepare('SELECT secret_cipher IS NOT NULL connected FROM feedback_connections WHERE project_id=?').bind(actor.projectId).first<any>();return c.json({data:{connected:!!row?.connected,release_url:new URL('/api/feedback/releases/'+actor.projectId,c.req.url).href}})})
 routes.put(root+'/settings',async c=>{const {actor}=await access(c,'integrations.install');await requireStepUp(c,actor,'feedback.install');const body=await c.req.json(),secret=body.revoke===true?null:await encryptToken(c.env,actor.projectId,text(body.secret,'release signing secret',1000));if(body.revoke!==true&&body.secret.length<32)throw new HTTPException(400,{message:'Signing secret must have at least 32 characters'});await c.env.DB.batch([c.env.DB.prepare('INSERT INTO feedback_connections VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET secret_cipher=excluded.secret_cipher,updated_at=excluded.updated_at').bind(actor.projectId,secret,Date.now()),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:secret?'feedback.connected':'feedback.revoked',actor:{type:'user',id:actor.id},source:requestSource(c)})]);return c.json({saved:true})})
 routes.get(ticket,async c=>{const {actor,conversation}=await access(c);const data=await c.env.DB.prepare(`SELECT s.*,co.name account_name FROM feedback_sources s LEFT JOIN companies co ON co.id=s.account_id AND co.project_id=s.project_id WHERE s.project_id=? AND s.conversation_id=? ORDER BY s.created_at`).bind(actor.projectId,conversation.id).all();const updates=await c.env.DB.prepare('SELECT u.* FROM feedback_updates u JOIN feedback_sources s ON s.id=u.source_id WHERE s.project_id=? AND s.conversation_id=? ORDER BY u.created_at').bind(actor.projectId,conversation.id).all();return c.json({data:data.results,updates:updates.results})})
 routes.post(ticket,async c=>{
  const {actor,conversation}=await access(c,'conversations.manage'),body=await c.req.json(),db=c.env.DB
  const messageId=text(body.message_id,'customer message id',200),penny=link(body.penny_url),issue=link(body.issue_url),id=crypto.randomUUID(),now=Date.now()
  // The quote is derived from an explicitly selected customer message, never arbitrary notes or other tickets.
  const inserted=await db.batch([
   db.prepare(`INSERT OR IGNORE INTO feedback_sources(id,project_id,conversation_id,contact_id,message_id,account_id,quote,penny_url,issue_url,created_by,created_at) SELECT ?,c.project_id,c.id,c.contact_id,m.id,(SELECT company_id FROM contact_companies WHERE project_id=c.project_id AND contact_id=c.contact_id),m.content,?,?,?,? FROM conversations c JOIN messages m ON m.conversation_id=c.id AND m.project_id=c.project_id WHERE c.project_id=? AND c.id=? AND m.id=? AND m.actor_role='contact' AND m.erased_at IS NULL AND ${contactAvailableSql()}`).bind(id,penny,issue,actor.id,now,actor.projectId,conversation.id,messageId),
   auditStatement(db,{projectId:actor.projectId,category:'data',action:'feedback.source_linked',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'feedback_source',id}},now,{sql:'EXISTS(SELECT 1 FROM feedback_sources WHERE id=?)',params:[id]}),
  ])
  const source=await db.prepare('SELECT * FROM feedback_sources WHERE project_id=? AND conversation_id=? AND message_id=? AND penny_url=?').bind(actor.projectId,conversation.id,messageId,penny).first<any>()
  if(!source)throw new HTTPException(400,{message:'Select an available customer message from this conversation'})
  if(source.issue_url!==issue)throw new HTTPException(409,{message:'This source is already linked to a different engineering record'})
  await publishActivity(c.env,actor.projectId,conversation.id,'feedback')
  return c.json({data:source,duplicate:!inserted[0].meta.changes},201)
 })
 routes.put(ticket+'/sources/:sourceId/preference',async c=>{
  const {actor,conversation}=await access(c,'conversations.manage'),body=await c.req.json(),id=c.req.param('sourceId')!,now=Date.now()
  if(typeof body.subscribed!=='boolean')throw new HTTPException(400)
  // An operator may opt out. Opting in needs a requester-authored consent message in this ticket.
  const consent=body.subscribed?text(body.preference_message_id,'requester consent message',200):null
  const result=await c.env.DB.batch([
   c.env.DB.prepare(`UPDATE feedback_sources SET subscribed=?,preference_message_id=? WHERE id=? AND project_id=? AND conversation_id=? AND (?=0 OR EXISTS(SELECT 1 FROM messages m WHERE m.id=? AND m.conversation_id=feedback_sources.conversation_id AND m.actor_id=feedback_sources.contact_id AND m.actor_role='contact' AND m.erased_at IS NULL))`).bind(body.subscribed?1:0,consent,id,actor.projectId,conversation.id,body.subscribed?1:0,consent),
   ...(!body.subscribed?[c.env.DB.prepare("UPDATE feedback_updates SET state='cancelled',content='' WHERE source_id=? AND project_id=? AND state IN ('draft','approved')").bind(id,actor.projectId)]:[]),
   auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:body.subscribed?'feedback.subscribed':'feedback.opted_out',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'feedback_source',id}},now,{sql:'EXISTS(SELECT 1 FROM feedback_sources WHERE id=? AND project_id=? AND subscribed=?)',params:[id,actor.projectId,body.subscribed?1:0]}),
  ])
  if(!result[0].meta.changes)throw new HTTPException(400,{message:'Record the requester’s consent in this conversation before subscribing'})
  return c.json({saved:true})
 })
 routes.post('/conversations/:conversationId/opt-out',async c=>{
  const actor=await requireActor(c),id=c.req.param('conversationId'),db=c.env.DB
  if(actor.role!=='contact')throw new HTTPException(403)
  const row=await db.prepare(`SELECT c.id FROM conversations c WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND ${contactAvailableSql()}`).bind(id,actor.projectId,actor.contactId||actor.id).first()
  if(!row)throw new HTTPException(404)
  await db.batch([db.prepare('UPDATE feedback_sources SET subscribed=0,preference_message_id=NULL WHERE project_id=? AND conversation_id=?').bind(actor.projectId,id),db.prepare("UPDATE feedback_updates SET state='cancelled',content='' WHERE project_id=? AND source_id IN (SELECT id FROM feedback_sources WHERE conversation_id=?) AND state IN ('draft','approved')").bind(actor.projectId,id),auditStatement(db,{projectId:actor.projectId,category:'approval',action:'feedback.requester_opted_out',actor:{type:'api',id:actor.id},source:'api'})])
  return c.json({saved:true})
 })
 routes.post(ticket+'/updates/:updateId/send',async c=>{
  const {actor,conversation}=await access(c,'conversations.reply'),body=await c.req.json(),id=c.req.param('updateId')!,content=text(body.content,'customer update',100000),now=Date.now(),db=c.env.DB
  const draft=await db.prepare('SELECT u.* FROM feedback_updates u JOIN feedback_sources s ON s.id=u.source_id WHERE u.id=? AND s.project_id=? AND s.conversation_id=? AND s.subscribed=1').bind(id,actor.projectId,conversation.id).first<any>()
  if(!draft||draft.state==='cancelled'||draft.state!=='draft'&&(draft.content!==content||draft.approved_by!==actor.id))throw new HTTPException(409,{message:'This update is unavailable or was approved with different content'})
  const guard=`EXISTS(SELECT 1 FROM feedback_updates u JOIN feedback_sources s ON s.id=u.source_id WHERE u.id=? AND s.project_id=? AND s.conversation_id=? AND s.subscribed=1 AND u.approved_by=? AND u.content=? AND u.state IN ('approved','sent'))`
  const args=[id,actor.projectId,conversation.id,actor.id,content]
  await db.batch([db.prepare("UPDATE feedback_updates SET content=?,state='approved',approved_by=?,approved_at=? WHERE id=? AND state='draft'").bind(content,actor.id,now,id),auditStatement(db,{projectId:actor.projectId,category:'approval',action:'feedback.update_approved',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'feedback_update',id}},now,{sql:guard,params:args})])
  const localId='feedback:'+id
  await stageEmailMessageOptions(c.env,actor,conversation,{localId})
  // A release never resolves a support request. Recovery remains the support team's responsibility.
  const result=await admitMessage(c.env,{projectId:actor.projectId,conversationId:conversation.id,actor,sessionHash:c.get('sessionHash'),localId,content,expectedRevision:body.expectedRevision,expectedLastMessageId:body.expectedLastMessageId,resolve:false,mediaIds:[],authoring:{kind:'human'},requireAvailableRequester:true,[messageAuthority]:{sql:guard,args}})
  if(!result.accepted)return c.json(result,409)
  await db.prepare("UPDATE feedback_updates SET state='sent',message_id=? WHERE id=? AND state='approved'").bind(result.message.id,id).run()
  if(!result.duplicate)await onMessage(c.env,result.message,actor)
  await publishActivity(c.env,actor.projectId,conversation.id,'feedback')
  await c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(conversation.id)).fetch('https://conversation.internal/broadcast',{method:'POST'})
  return c.json(result)
 })
 return routes
}
