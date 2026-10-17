import {notificationTemplateContext} from './context'
import type {Env} from '../../../platform/env'
import {emailConfigured,sendEmails,type EmailInput} from '../email'
import {loopSuppressionHeaders} from '../notification-delivery'
import {recipientReplyAddress} from '../email-reply-address'
import {customerNoticeAddress,notificationRecipients,type NotificationContact} from '../notification-recipients'
import {provenAddressSql} from '../inbound-authority'
import {noticeParticipantSql} from '../participant-proof'
import type {TicketNotificationEvent} from '../triggers'
import {notificationTicket,notificationTicketSql} from './eligibility'
import {defaultTriggers,renderNotificationTemplate} from './templates'

export async function customerTicketNotification(env:Env,event:TicketNotificationEvent & {claimEvent?:string;template?:{subject:string;body:string}}){
 const claimEvent=event.claimEvent??event.event
 const id=`ticket-notice:${event.projectId}:${event.conversationId}:${claimEvent}`
 const prior=await env.DB.prepare('SELECT state,outcome_json FROM notification_trigger_claims WHERE id=?').bind(id).first<any>()
 if(prior)return {state:prior.state,outcome:JSON.parse(prior.outcome_json)}
 const ticket=await notificationTicket(env,event.projectId,event.conversationId)
 if(!ticket||event.event==='ticket_solved'&&!['solved','closed'].includes(ticket.status_category))return {state:'suppressed'}
 // Acknowledgement belongs to the ticket's first customer message, never to empty widget admission.
 if(!event.template&&event.event==='request_received'){
  const first=await env.DB.prepare("SELECT id FROM messages WHERE conversation_id=? AND project_id=? AND actor_role='contact' ORDER BY revision,id LIMIT 1").bind(ticket.id,event.projectId).first<{id:string}>()
  if(first?.id!==event.eventId)return {state:'not_new_request'}
 }
 const custom=await env.DB.prepare(`SELECT * FROM notification_triggers WHERE project_id=? AND event=? AND channel IN ('*',?) AND brand_id IN ('*',?) ORDER BY (channel<>'*')+(brand_id<>'*') DESC,channel DESC LIMIT 1`).bind(event.projectId,event.event,ticket.notification_channel,ticket.brand_id??event.projectId).first<any>()
 const trigger=event.template?{...event.template,enabled:1,expected_reply_time:event.expectedReplyTime}:custom??defaultTriggers.find(t=>t.event===event.event)!
 if(!trigger.enabled)return {state:'disabled'}
 if(!emailConfigured(env))return {state:'not_configured'}
 const settings=await env.DB.prepare('SELECT inbound_address,is_enabled FROM email_settings WHERE project_id=?').bind(event.projectId).first<any>()
 if(settings?.is_enabled===0)return {state:'disabled'}
 // An operator-set preference proves that address, never a Reply-To or collector.
 const operatorAddress=(ct:string)=>`json_extract(${ct}.metadata_json,'$.provided_email_source')='operator' AND nullif(trim(json_extract(${ct}.metadata_json,'$.provided_email')),'') IS NOT NULL`
 const participant=(ct:string)=>`((${provenAddressSql(ct)} AND ${noticeParticipantSql(ct,'cp')}) OR (${operatorAddress(ct)}))`
 const contacts=await env.DB.prepare(`SELECT ct.* FROM contacts ct WHERE ct.project_id=? AND (ct.id=? OR (
 coalesce(json_extract(ct.metadata_json,'$.unverified_sender'),0)!=1
 AND EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=? AND cp.contact_id=ct.id AND ${participant('ct')}))) ORDER BY ct.id=? DESC,ct.id`)
 .bind(event.projectId,ticket.contact_id,ticket.id,ticket.contact_id).all<NotificationContact>()
 const {recipients}=notificationRecipients(contacts.results,undefined,undefined,contact=>customerNoticeAddress(contact,ticket.notification_channel==='widget'?ticket.contact_id:undefined))
 if(!recipients.length)return {state:'no_recipient'}
 const context=await notificationTemplateContext(env,ticket,{expectedReplyTime:event.expectedReplyTime??trigger.expected_reply_time,actorId:event.actorId})
 let inputs:EmailInput[]
 try{
  const subject=renderNotificationTemplate(trigger.subject,context),text=renderNotificationTemplate(trigger.body,context)
  inputs=await Promise.all(recipients.map(async(recipient,index)=>({projectId:event.projectId,to:recipient.email,subject,text,headers:loopSuppressionHeaders({}),replyTo:settings?.inbound_address?await recipientReplyAddress(env,settings.inbound_address,event.projectId,ticket.id,recipient.email):undefined,idempotencyKey:index===0?id:`${id}:contact:${recipient.id}`})))
 }catch(error){
  const message=error instanceof Error?error.message:'Invalid notification template'
  await env.DB.prepare("INSERT OR IGNORE INTO notification_trigger_claims(id,project_id,conversation_id,event,state,outcome_json,created_at) VALUES(?,?,?,?,'template_error',?,?)").bind(id,event.projectId,ticket.id,claimEvent,JSON.stringify({error:message}),Date.now()).run()
  return {state:'template_error',error:message}
 }
 // This fence owns the complete immutable recipient set, including development suppression.
 const snapshot=contacts.results.filter(contact=>recipients.some(r=>r.id===contact.id))
 const claim=await env.DB.prepare(`INSERT OR IGNORE INTO notification_trigger_claims(id,project_id,conversation_id,event,state,outcome_json,created_at)
 SELECT ?,?,?,?,'claimed',?,? WHERE EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)
 AND NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM contacts current
 WHERE current.id=json_extract(j.value,'$.id') AND current.project_id=? AND current.email IS json_extract(j.value,'$.email')
 AND current.metadata_json IS json_extract(j.value,'$.metadata_json')
 AND current.is_verified IS json_extract(j.value,'$.is_verified') AND current.external_id IS json_extract(j.value,'$.external_id')
 AND (current.id=? OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=? AND cp.contact_id=current.id AND ${participant('current')}))))`)
 .bind(id,event.projectId,ticket.id,claimEvent,JSON.stringify({recipients:recipients.map(r=>r.email)}),Date.now(),ticket.id,event.projectId,JSON.stringify(snapshot),event.projectId,ticket.contact_id,ticket.id).run()
 if(!claim.meta.changes)return {state:'claimed'}
 try{
  const outcomes=await sendEmails(env,inputs)
  const state=outcomes.some(row=>['sending','uncertain'].includes(row.state))?'uncertain':outcomes.some(row=>row.state==='failed')?'failed':outcomes.every(row=>row.state==='suppressed')?'suppressed':'complete'
  await env.DB.prepare('UPDATE notification_trigger_claims SET state=?,outcome_json=? WHERE id=?').bind(state,JSON.stringify({deliveries:outcomes}),id).run()
  return {state,deliveries:outcomes}
 }catch(error){
  const deliveries=await env.DB.prepare('SELECT state,recipient FROM email_deliveries WHERE id=? OR substr(id,1,?)=?').bind(id,id.length+1,id+':').all()
  await env.DB.prepare("UPDATE notification_trigger_claims SET state='uncertain',outcome_json=? WHERE id=?").bind(JSON.stringify({deliveries:deliveries.results,error:error instanceof Error?error.message:'Delivery outcome unknown'}),id).run()
  return {state:'uncertain'}
 }
}
