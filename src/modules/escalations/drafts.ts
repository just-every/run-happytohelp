import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env,Actor} from '../../platform/env'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {stageEmailMessageOptions} from '../integrations/email-command-options'
import {messageData} from '../management/dashboard-data'
import {auditStatement,requestSource} from '../audit/record'
import {publishActivity} from '../conversations/activity'
import {publishResolution} from '../outcomes/state'
import {escalationAccess,string} from './access'
import {ticketPrefix} from './actions'
export function draftRoutes(onCommittedMessage:(env:Env,message:Record<string,unknown>,actor:Actor)=>Promise<unknown>){
 const routes=new Hono<AppEnv>()
 routes.post(ticketPrefix+'/drafts/:draftId/send',async c=>{
  const {actor,conversation}=await escalationAccess(c,'conversations.reply'),body=await c.req.json(),draftId=c.req.param('draftId'),content=string(body.content,'customer update',100000)
  if(!draftId)throw new HTTPException(404)
  const draft=await c.env.DB.prepare(`SELECT d.*,i.closed FROM escalation_drafts d JOIN escalation_issues i ON i.id=d.issue_id WHERE d.id=? AND d.project_id=? AND d.conversation_id=?`).bind(draftId,actor.projectId,conversation.id).first<any>()
  if(!draft||!draft.closed||draft.state==='cancelled')throw new HTTPException(409,{message:'This engineering update is no longer available for approval'})
  // An explicit Send approves this edited text. A repeated request must retain
  // its exact intent; admission owns the frontier, role, privacy and channel.
  if(draft.state!=='draft'&&(draft.content!==content||draft.approved_by!==actor.id))throw new HTTPException(409,{message:'The draft was already approved with different content or by another teammate'})
  const now=Date.now()
  await c.env.DB.batch([c.env.DB.prepare("UPDATE escalation_drafts SET content=?,state='approved',approved_by=?,approved_at=? WHERE id=? AND state='draft'").bind(content,actor.id,now,draftId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'approval',action:'escalation.customer_update_approved',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_draft',id:draftId}},now,{sql:"EXISTS(SELECT 1 FROM escalation_drafts WHERE id=? AND approved_by=? AND approved_at=?)",params:[draftId,actor.id,now]})])
  const localId='escalation:'+draftId
  await stageEmailMessageOptions(c.env,actor,conversation,{...body,localId})
  const result=await admitMessage(c.env,{projectId:actor.projectId,conversationId:conversation.id,actor,sessionHash:c.get('sessionHash'),localId,content,expectedRevision:body.expectedRevision,expectedLastMessageId:body.expectedLastMessageId,resolve:!!body.resolve,mediaIds:body.mediaIds??[],authoring:{kind:'human'},requireAvailableRequester:true,[messageAuthority]:{sql:"EXISTS(SELECT 1 FROM escalation_drafts d JOIN escalation_issues i ON i.id=d.issue_id WHERE d.id=? AND d.approved_by=? AND d.content=? AND i.closed=1 AND d.state IN ('approved','sent'))",args:[draftId,actor.id,content]}})
  if(!result.accepted)return c.json(result,409)
  await c.env.DB.batch([c.env.DB.prepare("UPDATE escalation_drafts SET state='sent',message_id=? WHERE id=?").bind(result.message.id,draftId),auditStatement(c.env.DB,{projectId:actor.projectId,category:'integration',action:'escalation.customer_update_sent',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'escalation_draft',id:draftId},detail:{messageId:result.message.id}},Date.now(),{sql:'?=0',params:[result.duplicate?1:0]})])
  let generationError:string|undefined
  if(!result.duplicate){try{await onCommittedMessage(c.env,result.message,actor)}catch{generationError='Message saved. Check the delivery status before attempting another reply.'}}
  await Promise.all([publishResolution(c.env,actor.projectId,conversation.id),...[conversation.id,`project:${actor.projectId}`].map(key=>c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'}))])
  await publishActivity(c.env,actor.projectId,conversation.id,'escalation')
  return c.json({...result,dashboardMessage:await messageData(c.env,result.message,conversation.channel),...(generationError?{generationError}:{})})
 })
 return routes
}
