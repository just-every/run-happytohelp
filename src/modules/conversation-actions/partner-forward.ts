import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {requiredString} from '../../platform/db'
import {ticketAuthority,availableTicketSql,type TicketAuthority} from '../tickets/model'
import {recipientAddress} from '../management/conversation-transcript'
import {renderConversationEmail} from '../integrations/email-content'
import {sendEmail} from '../integrations/email'
import {receivingState} from '../integrations/inbound-capability'
import {mailbox} from '../integrations/inbound-routing'
import {writableConversationSql} from './merge-read'
import {publishConversationAction} from './activity'

export async function partnerReplyToken(env:Env,id:string,recipient:string){
 const secret=env.INBOUND_EMAIL_TOKEN
 if(typeof secret!=='string'||!secret)throw new HTTPException(503,{message:'Reply email is not configured'})
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const bytes=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['partner-v1',id,recipient])))
 return Array.from(new Uint8Array(bytes)).map(n=>n.toString(16).padStart(2,'0')).join('').slice(0,32)
}
async function selected(env:Env,projectId:string,id:string,input:any){
 if(!Array.isArray(input.message_ids)||input.message_ids.length<1||input.message_ids.length>50||input.message_ids.some((n:unknown)=>typeof n!=='string'))throw new HTTPException(400,{message:'Select between 1 and 50 customer-visible messages'})
 const ids=[...new Set(input.message_ids as string[])].sort()
 const messages=(await env.DB.prepare("SELECT * FROM messages WHERE project_id=? AND conversation_id=? AND id IN (SELECT value FROM json_each(?)) AND actor_role IN ('contact','operator','owner','admin','ai') AND actor_id<>'legacy-system' AND erased_at IS NULL ORDER BY revision").bind(projectId,id,JSON.stringify(ids)).all<any>()).results
 if(messages.length!==ids.length)throw new HTTPException(400,{message:'Only customer-visible messages from this ticket may be forwarded. Private notes and other tickets are excluded.'})
 return {ids,messages}
}
export async function previewPartnerForward(env:Env,actor:Actor,conversation:any,input:any,authority:TicketAuthority){
 await ticketAuthority(env,actor,authority,'conversations.reply',conversation.id)
 const recipient=recipientAddress(input.recipient),{ids,messages}=await selected(env,actor.projectId,conversation.id,input)
 const [files,customer]=await Promise.all([
  env.DB.prepare('SELECT id,filename,size FROM media WHERE project_id=? AND conversation_id=? AND message_id IN (SELECT value FROM json_each(?)) ORDER BY id').bind(actor.projectId,conversation.id,JSON.stringify(ids)).all(),
  env.DB.prepare('SELECT id,name,email FROM contacts WHERE project_id=? AND id=?').bind(actor.projectId,conversation.contact_id).first(),
 ])
 return {recipient,message_ids:ids,messages:messages.map(m=>({id:m.id,content:m.content,actor_role:m.actor_role})),attachments:files.results,customer_identity:customer,channel:conversation.channel,private_notes_included:false,reply_visibility:'private',external_participant:true,customer_notified:false,expected_version:conversation.ticket_version}
}
export async function forwardToPartner(env:Env,actor:Actor,conversation:any,input:any,authority:TicketAuthority){
 const guard=await ticketAuthority(env,actor,authority,'conversations.reply',conversation.id),recipient=recipientAddress(input.recipient),command=requiredString(input.idempotencyKey,'idempotencyKey',200),subject=requiredString(input.subject,'subject',500),note=typeof input.note==='string'?input.note:''
 if(/[\r\n]/.test(subject)||note.length>10000)throw new HTTPException(400,{message:'Invalid subject or forwarding note'})
 if(!Number.isSafeInteger(input.expected_version)||input.expected_version!==conversation.ticket_version)throw new HTTPException(409,{message:'Ticket changed. Preview the forward again.'})
 const {ids,messages}=await selected(env,actor.projectId,conversation.id,input),intent=await hashToken(JSON.stringify({recipient,subject,note,ids,version:input.expected_version}))
 const existing=await env.DB.prepare('SELECT id,intent_hash,state FROM partner_forwards WHERE project_id=? AND conversation_id=? AND actor_id=? AND command_key=?').bind(actor.projectId,conversation.id,actor.id,command).first<any>()
 if(existing){if(existing.intent_hash!==intent)throw new HTTPException(409,{message:'Forward command identity conflict'});return {id:existing.id,state:existing.state,duplicate:true}}
 const settings=await env.DB.prepare('SELECT inbound_address FROM email_settings WHERE project_id=? AND is_enabled=1').bind(actor.projectId).first<{inbound_address:string}>(),base=mailbox(settings?.inbound_address)
 if(!base||!(await receivingState(env,base)).ready)throw new HTTPException(503,{message:'A receiving mailbox is required for partner replies'})
 const id=crypto.randomUUID(),token=await partnerReplyToken(env,id,recipient),digest=await hashToken(token),rendered=await renderConversationEmail(env,{projectId:actor.projectId,conversationId:conversation.id,messages})
 if(rendered.omitted.length)throw new HTTPException(409,{message:'A selected attachment cannot be forwarded. Select messages whose attachments are available and within the email limit.'})
 const text=[note,rendered.text,'Replies are private to the support team.'].filter(Boolean).join('\n\n'),now=Date.now()
 const r=await env.DB.prepare(`INSERT INTO partner_forwards(id,project_id,conversation_id,actor_id,command_key,intent_hash,recipient,subject,content,message_ids_json,grant_hash,created_at)
 SELECT ?,c.project_id,c.id,?,?,?,?,?,?,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.ticket_version=? AND ${availableTicketSql()} AND ${writableConversationSql()} AND EXISTS(${guard.sql})`).bind(id,actor.id,command,intent,recipient,subject,text,JSON.stringify(ids),digest,now,conversation.id,actor.projectId,input.expected_version,...guard.params).run()
 if(!r.meta.changes)throw new HTTPException(409,{message:'Ticket or sending authority changed. Preview again.'})
 const replyTo=`${base.slice(0,base.indexOf('@'))}+r.${token}@${base.slice(base.indexOf('@')+1)}`
 // The durable prepared row is a send claim. A crash never automatically replays it.
 await env.DB.prepare("UPDATE partner_forwards SET state='sending' WHERE id=?").bind(id).run()
 try{
  const result=await sendEmail(env,{to:recipient,subject,text,attachments:rendered.attachments,replyTo,projectId:actor.projectId,idempotencyKey:`partner:${id}`,headers:{'Auto-Submitted':'auto-generated','X-Auto-Response-Suppress':'All'}})
  await env.DB.prepare('UPDATE partner_forwards SET state=? WHERE id=?').bind(result.state,id).run()
  await publishConversationAction(env,actor.projectId,[conversation.id],'partner_forward')
  return {id,state:result.state}
 }catch(error){
  const delivery=await env.DB.prepare('SELECT state FROM email_deliveries WHERE id=? AND project_id=?').bind(`partner:${id}`,actor.projectId).first<{state:string}>()
  await env.DB.prepare('UPDATE partner_forwards SET state=? WHERE id=?').bind(delivery?.state??'uncertain',id).run()
  throw error
 }
}
