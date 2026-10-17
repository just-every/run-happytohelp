import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {admitMessage,reservedLocalId,messageAuthority} from '../conversations/admission'
import {applyMessageEffects} from '../../message-effects'
import type {DeferEmailDelivery} from '../integrations/email'
import {enforceRateLimits} from '../../platform/rate-limits'
import {publishResolution} from '../outcomes/state'
import {auditStatement} from '../audit/record'
import {activeSurveySql,surveyJoins,type Survey} from '../outcomes/survey-store'
import {surveyURL} from '../outcomes/survey-links'
import {portalSessionGuard,type PortalIdentity} from './identity'

const publicColumns="c.id,c.subject,CASE WHEN c.status_category IN ('solved','closed') THEN 'solved' ELSE 'open' END status,c.created_at,c.updated_at,c.revision,c.last_message_id lastMessageId"
export async function listPortalRequests(env:Env,identity:PortalIdentity,before?:number){
 const guard=portalSessionGuard(identity),cursor=typeof before==='number'&&Number.isSafeInteger(before)&&before>0?before:Number.MAX_SAFE_INTEGER
 return (await env.DB.prepare(`SELECT ${publicColumns} FROM conversations c WHERE c.project_id=? AND c.contact_id=? AND c.updated_at<? AND c.revision>0 AND ${guard.sql} ORDER BY c.updated_at DESC,c.id LIMIT 100`).bind(identity.actor.projectId,identity.actor.id,cursor,...guard.args).all()).results
}
export async function portalRequest(env:Env,identity:PortalIdentity,ticketId:string){
 const guard=portalSessionGuard(identity)
 const ticket=await env.DB.prepare(`SELECT ${publicColumns} FROM conversations c WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND c.revision>0 AND ${guard.sql}`).bind(ticketId,identity.actor.projectId,identity.actor.id,...guard.args).first<any>()
 if(!ticket)throw new HTTPException(404,{message:'Request not found'})
 return ticket
}
export async function portalRequestDetail(env:Env,identity:PortalIdentity,ticketId:string){
 const ticket=await portalRequest(env,identity,ticketId),guard=portalSessionGuard(identity)
 const [messages,media,surveys]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT m.id,m.content,m.created_at,CASE WHEN m.actor_role='contact' THEN 'customer' ELSE 'support' END author FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND m.erased_at IS NULL AND ${guard.sql} ORDER BY m.revision LIMIT 1000`).bind(ticketId,identity.actor.projectId,identity.actor.id,...guard.args),
  env.DB.prepare(`SELECT m.id,m.message_id,m.filename,m.content_type,m.size FROM media m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND m.message_id IS NOT NULL AND ${guard.sql}`).bind(ticketId,identity.actor.projectId,identity.actor.id,...guard.args),
  env.DB.prepare(`SELECT s.* ${surveyJoins} WHERE c.id=? AND c.project_id=? AND ct.id=? AND ${activeSurveySql} AND s.due_at<=? AND s.state IN ('pending','sent') AND s.token_revision=0 AND NOT EXISTS(SELECT 1 FROM csat_responses response WHERE response.resolution_id=s.resolution_id) AND ${guard.sql} LIMIT 1`).bind(ticketId,identity.actor.projectId,identity.actor.id,Date.now(),Date.now(),...guard.args)
 ])
 const survey=surveys.results[0] as Survey|undefined
 return {ticket,messages:messages.results.map((message:any)=>({...message,attachments:media.results.filter((item:any)=>item.message_id===message.id).map(({message_id,...item}:any)=>item)})),survey:survey?{state:'available',url:await surveyURL(env,survey)}:{state:ticket.status==='solved'?'unavailable':'open'}}
}
export async function replyPortalRequest(env:Env,identity:PortalIdentity,ticketId:string,body:any,defer?:DeferEmailDelivery){
 await portalRequest(env,identity,ticketId)
 if(reservedLocalId(body.localId))throw new HTTPException(400,{message:'Invalid local id'})
 if(typeof body.content==='string'&&!body.content.trim()&&!body.mediaIds?.length)throw new HTTPException(400,{message:'Enter a message or attach a file'})
 if(typeof body.localId!=='string'||!body.localId||body.localId.length>200||typeof body.content!=='string'||body.content.length>100000||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new HTTPException(400,{message:'Enter a message and reload the request before replying'})
 if(body.mediaIds!==undefined&&(!Array.isArray(body.mediaIds)||body.mediaIds.length>20||body.mediaIds.some((id:unknown)=>typeof id!=='string')))throw new HTTPException(400,{message:'Invalid attachments'})
 await enforceRateLimits(env,[['messagesPerConversationMinute',ticketId],['messagesPerContactHour',identity.actor.id]])
 const result=await admitMessage(env,{projectId:identity.actor.projectId,conversationId:ticketId,actor:identity.actor,sessionHash:identity.sessionHash,localId:body.localId,content:body.content,expectedRevision:body.expectedRevision,mediaIds:body.mediaIds||[],[messageAuthority]:portalSessionGuard(identity)})
 if(!result.accepted)throw new HTTPException(409,{message:'The request changed or is unavailable. Reload before replying.'})
 if(!result.duplicate){
  await auditStatement(env.DB,{projectId:identity.actor.projectId,category:'data',action:'portal.request.replied',actor:{type:'system'},source:'api',target:{type:'conversation',id:ticketId}}).run()
  try{await applyMessageEffects(env,result.message!,identity.actor,defer)}catch{return {accepted:true,duplicate:false,messageId:result.message!.id,effectsPending:true}}
 }
 return {accepted:true,duplicate:result.duplicate,messageId:result.message!.id}
}
export async function reopenPortalRequest(env:Env,identity:PortalIdentity,ticketId:string,expectedRevision:unknown){
 const ticket=await portalRequest(env,identity,ticketId)
 if(!Number.isSafeInteger(expectedRevision)||Number(expectedRevision)<0)throw new HTTPException(400,{message:'Reload the request before reopening'})
 if(ticket.status!=='solved')throw new HTTPException(409,{message:'This request is already open'})
 const guard=portalSessionGuard(identity),now=Date.now()
 const result=await env.DB.prepare(`UPDATE conversations SET resolved_at=NULL,status_id='open',status_category='open',ticket_actor_id=?,ticket_actor_type='contact',ticket_source='portal',updated_at=? WHERE id=? AND project_id=? AND contact_id=? AND revision=? AND status_category='solved' AND ${guard.sql} RETURNING id`).bind(identity.actor.id,now,ticketId,identity.actor.projectId,identity.actor.id,expectedRevision,...guard.args).all()
 if(!result.results.length)throw new HTTPException(409,{message:'This request changed or can no longer be reopened. Create a follow-up request if it is closed.'})
 await auditStatement(env.DB,{projectId:identity.actor.projectId,category:'data',action:'portal.request.reopened',actor:{type:'system'},source:'api',target:{type:'conversation',id:ticketId}}).run()
 await publishResolution(env,identity.actor.projectId,ticketId)
 return {reopened:true}
}
