import type {Actor,Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {sendEmail,emailConfigured} from '../integrations/email'
import {renderConversationEmail} from '../integrations/email-content'
import {recipientReplyAddress} from '../integrations/email-reply-address'
import {loopSuppressionHeaders} from '../integrations/notification-delivery'
import {notificationAddress} from '../integrations/notification-recipients'
import {problemAvailableSql,problemRequesterSql} from './problem-model'
export async function problemDestination(env:Env,projectId:string,ticket:any,requester?:{id:string;name:string|null;email:string|null;metadata_json:string}){
 const contact=requester??await env.DB.prepare('SELECT id,name,email,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(projectId,ticket.contact_id).first<any>()
 if(!contact)return {reason:'Requester is unavailable'}
 const metadata=JSON.parse(contact.metadata_json||'{}')
 if(metadata.is_erased||metadata.is_erasing||metadata.is_deleted||metadata.is_blocked)return {reason:'Requester is unavailable'}
 if(ticket.channel==='widget')return {channel:'widget',contact_id:contact.id,contact_name:contact.name,contact_email:contact.email,metadata_json:contact.metadata_json,recipient:null,mailbox_id:ticket.mailbox_id??null}
 if(ticket.channel!=='email')return {reason:`No native ${ticket.channel} reply transport is available. No reply was sent.`}
 if(metadata.portal_notification_emails===0)return {reason:'Requester has opted out of email notifications'}
 const recipient=notificationAddress(contact)
 if(!recipient)return {reason:'Requester has no usable email reply address'}
 const settings=await env.DB.prepare('SELECT is_enabled FROM email_settings WHERE project_id=?').bind(projectId).first<{is_enabled:number}>()
 if(settings?.is_enabled===0)return {reason:'Workspace email is disabled'}
 if(ticket.mailbox_id){if(!await env.DB.prepare("SELECT 1 FROM mailbox_connections WHERE project_id=? AND id=? AND status='connected'").bind(projectId,ticket.mailbox_id).first())return {reason:'Incident mailbox is disconnected'}}
 else if(!emailConfigured(env))return {reason:'Email provider is not configured'}
 return {channel:'email',contact_id:contact.id,contact_name:contact.name,contact_email:contact.email,metadata_json:contact.metadata_json,recipient,mailbox_id:ticket.mailbox_id??null}
}
export const sameDestination=(left:any,right:any)=>JSON.stringify(left)===JSON.stringify(right)
/** Called by notifyMessage before its ordinary participant fan-out, including on
 * outbox recovery. A durable sending claim is terminal: it is never replayed. */
export async function problemMessageDelivery(env:Env,message:any,actor:Actor):Promise<{state:string;reason?:string}|null>{
 if(typeof message.local_id!=='string'||!message.local_id.startsWith('problem:'))return null
 const row=await env.DB.prepare('SELECT a.*,p.actor_id,p.plan_json,p.state preview_state,p.problem_ticket_version,p.problem_revision,p.problem_last_message_id FROM ticket_problem_attempts a JOIN ticket_problem_previews p ON p.id=a.preview_id WHERE a.project_id=? AND a.local_id=? AND a.incident_id=?').bind(actor.projectId,message.local_id,message.conversation_id).first<any>()
 if(!row)return {state:'blocked',reason:'Problem reply receipt is unavailable; no automatic delivery'}
 if(row.message_id!==message.id||!['ready','sending','sent'].includes(row.state))return {state:row.state,reason:row.reason??undefined}
 if(row.state!=='ready')return {state:row.state,reason:row.state==='sending'?'Delivery is uncertain and will not be replayed':row.reason??undefined}
 const plan=JSON.parse(row.plan_json),item=plan.tickets.find((entry:any)=>entry.id===row.incident_id)
 const access=await memberAccess(env.DB,row.project_id,row.actor_id)
 const ticket=await env.DB.prepare(`SELECT c.*,${problemRequesterSql()} problem_requester_json FROM conversations c WHERE c.id=? AND c.project_id=? AND ${problemAvailableSql()} AND EXISTS(SELECT 1 FROM ticket_problem_incidents link JOIN ticket_problems problem ON problem.project_id=link.project_id AND problem.conversation_id=link.problem_id WHERE link.project_id=c.project_id AND link.incident_id=c.id AND link.problem_id=? AND problem.version=?) AND EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=? AND role=?) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`).bind(row.incident_id,row.project_id,row.problem_id,plan.problem_version,row.actor_id,plan.actor_role).first<any>()
 const destination=ticket?await problemDestination(env,row.project_id,ticket,JSON.parse(ticket.problem_requester_json)):null
 if(!item||row.preview_state!=='executing'||message.content!==item.reply||!ticket||ticket.last_message_id!==message.id||ticket.revision!==item.expected_revision+1||ticket.ticket_version!==item.expected_version+1||!access?.permissions.has('conversations.reply')||!access.permissions.has('conversations.manage')||access.key!==plan.role_key||!sameDestination(destination,item.destination)){
  await env.DB.prepare("UPDATE ticket_problem_attempts SET state='blocked',reason='Ticket, requester, consent, link or sender authority changed before delivery',updated_at=? WHERE id=? AND state='ready'").bind(Date.now(),row.id).run()
  return {state:'blocked',reason:'Ticket, requester, consent, link or sender authority changed before delivery'}
 }
 const claimed=await env.DB.prepare(`UPDATE ticket_problem_attempts SET state='sending',updated_at=? WHERE id=? AND state='ready' AND message_id=? AND EXISTS(SELECT 1 FROM ticket_problem_previews p JOIN ticket_problems problem ON problem.project_id=p.project_id AND problem.conversation_id=p.problem_id JOIN conversations root ON root.id=p.problem_id AND root.project_id=p.project_id WHERE p.id=ticket_problem_attempts.preview_id AND p.state='executing' AND problem.version=p.problem_version AND root.ticket_version=p.problem_ticket_version AND root.revision=p.problem_revision AND root.last_message_id IS p.problem_last_message_id AND ${problemAvailableSql('root')}) AND EXISTS(SELECT 1 FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id JOIN memberships m ON m.project_id=c.project_id AND m.user_id=? WHERE c.project_id=ticket_problem_attempts.project_id AND c.id=ticket_problem_attempts.incident_id AND c.ticket_version=? AND c.revision=? AND c.last_message_id=? AND c.channel=? AND c.mailbox_id IS ? AND ct.id=? AND ct.name IS ? AND ct.email IS ? AND ct.metadata_json=? AND m.role=? AND (SELECT role_key FROM member_roles WHERE project_id=m.project_id AND user_id=m.user_id) IS ? AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=m.project_id AND mr.user_id=m.user_id) IS ? AND ${problemAvailableSql()} AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))`).bind(Date.now(),row.id,message.id,row.actor_id,item.expected_version+1,item.expected_revision+1,message.id,item.destination.channel,item.destination.mailbox_id,item.destination.contact_id,item.destination.contact_name,item.destination.contact_email,item.destination.metadata_json,plan.actor_role,plan.role_assignment,plan.role_updated_at).run()
 if(!claimed.meta.changes)return {state:'uncertain',reason:'Another worker owns this delivery; it will not be replayed'}
 try{
  let state='sent',reason:string|undefined
  if(item.destination.channel==='email'){
   const settings=await env.DB.prepare('SELECT inbound_address FROM email_settings WHERE project_id=? AND is_enabled=1').bind(row.project_id).first<{inbound_address:string}>()
   const {omitted,...content}=await renderConversationEmail(env,{projectId:row.project_id,conversationId:row.incident_id,messages:[message]})
   const replyTo=settings?await recipientReplyAddress(env,settings.inbound_address,row.project_id,row.incident_id,item.destination.recipient):undefined
   const result=await sendEmail(env,{...content,to:item.destination.recipient,replyTo,projectId:row.project_id,subject:'Reply to your support conversation',headers:loopSuppressionHeaders(message),idempotencyKey:`message:${message.id}:notification`})
   state=result.state
   if(state!=='sent')reason=state==='suppressed'?'Development mail was suppressed; incident remains open':`Email delivery is ${state}; incident remains open`
  }
  const terminal=state==='sent'?'sent':['failed','suppressed'].includes(state)?'failed':'uncertain'
  await env.DB.prepare("UPDATE ticket_problem_attempts SET state=?,reason=?,updated_at=? WHERE id=? AND state='sending'").bind(terminal,reason??null,Date.now(),row.id).run()
  return {state:terminal,...(reason?{reason}:{})}
 }catch{
  const delivery=await env.DB.prepare('SELECT state,error FROM email_deliveries WHERE id=?').bind(`message:${message.id}:notification`).first<{state:string;error:string|null}>()
  const state=delivery?.state==='failed'?'failed':'uncertain',reason=state==='failed'?'Email provider rejected delivery; incident remains open':'Delivery could not be confirmed; incident remains open and this send will not be replayed'
  await env.DB.prepare("UPDATE ticket_problem_attempts SET state=?,reason=?,updated_at=? WHERE id=? AND state='sending'").bind(state,reason,Date.now(),row.id).run()
  return {state,reason}
 }
}
