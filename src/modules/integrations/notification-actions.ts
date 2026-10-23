import type {Env} from '../../platform/env'
import {projectAccess} from '../access/catalogue'
import {customerTicketNotification} from './triggers/customer'
import {notificationTicket,notificationTicketSql} from './triggers/eligibility'
import {notificationTemplateContext} from './triggers/context'
import {renderNotificationTemplate} from './triggers/templates'
import {emailConfigured,sendEmails,type EmailInput} from './email'
import {loopSuppressionHeaders} from './notification-delivery'
import {recipientReplyAddress} from './email-reply-address'
export interface TicketNotificationAction {
 projectId:string;conversationId:string;eventId:string;audience:'requester'|'assignee'|'group'|'followers'|'member';recipientId?:string;
 guard?:{sql:string;params:unknown[]};customerEvent?:'request_received'|'ticket_solved';
 template:{subject:string;body:string};actorId?:string;source?:'native'|'import'|'merge'|'isolated';expectedReplyTime?:string
}
/** Explicit R5 action; caller commits its authorized decision first. No rules,
 * timers or retries live here. The stable action ID freezes the entire audience. */
export async function sendTicketNotification(env:Env,event:TicketNotificationAction){
 if(event.source&&event.source!=='native')return {state:'suppressed'}
 if(!event.eventId||event.eventId.length>250)throw new Error('A stable action identity is required')
 if(!event.template||typeof event.template.subject!=='string'||typeof event.template.body!=='string'||!event.template.subject.trim()||!event.template.body.trim()||event.template.subject.length>200||event.template.body.length>10000)throw new Error('Provide a notification subject and body')
 if(!['requester','assignee','group','followers','member'].includes(event.audience))throw new Error('Invalid notification audience')
 if(event.audience==='member'&&!event.recipientId)throw new Error('A named member recipient is required')
 const claimEvent=`action:${event.eventId}:${event.audience}${event.audience==='member'?':'+event.recipientId:''}`
 if(event.audience==='requester')return customerTicketNotification(env,{...event,event:event.customerEvent??'request_received',claimEvent})
 const id=`ticket-notice:${event.projectId}:${event.conversationId}:${claimEvent}`
 const prior=await env.DB.prepare('SELECT state,outcome_json FROM notification_trigger_claims WHERE id=?').bind(id).first<any>()
 if(prior)return {state:prior.state,outcome:JSON.parse(prior.outcome_json)}
 const ticket=await notificationTicket(env,event.projectId,event.conversationId)
 if(!ticket)return {state:'suppressed'}
 const selectorArgs=event.audience==='member'?[event.recipientId!]:[]
 const selector=event.audience==='member'?'u.id=?':event.audience==='assignee'?'u.id=c.assigned_to':event.audience==='group'?`c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=c.project_id AND gm.group_id=c.group_id AND gm.user_id=u.id)`:`EXISTS(SELECT 1 FROM conversation_followers f WHERE f.conversation_id=c.id AND f.user_id=u.id)`
 const kind=event.audience==='member'||event.audience==='assignee'?'customer_updated':event.audience==='group'?'group':'follower'
 const users=await env.DB.prepare(`SELECT u.id,u.email,m.role,mr.role_key,pr.name role_name,pr.base role_base,pr.permissions_json role_permissions,coalesce(p.inbox,1) inbox,coalesce(p.email,1) email_preference FROM conversations c JOIN memberships m ON m.project_id=c.project_id JOIN users u ON u.id=m.user_id
 LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key
 LEFT JOIN notification_preferences p ON p.project_id=m.project_id AND p.user_id=m.user_id AND p.kind=? WHERE c.id=? AND c.project_id=? AND ${selector} AND u.id IS NOT ? ORDER BY u.id LIMIT 100`).bind(kind,ticket.id,event.projectId,...selectorArgs,event.actorId??null).all<any>()
 // Named SLA backups need operator authority without being the assignee. Freeze
 // the role definition alongside the address and preferences in the claim below.
 if(event.audience==='member')users.results=users.results.filter(user=>user.role==='owner'||projectAccess(user.role,user.role_key,user.role_name,user.role_base,user.role_permissions).permissions.includes('conversations.manage'))
 if(!users.results.length)return {state:'no_recipient'}
 const settings=await env.DB.prepare('SELECT inbound_address,is_enabled FROM email_settings WHERE project_id=?').bind(event.projectId).first<any>()
 const context=await notificationTemplateContext(env,ticket,{expectedReplyTime:event.expectedReplyTime,actorId:event.actorId})
 let subject:string,text:string
 try{subject=renderNotificationTemplate(event.template.subject,context);text=renderNotificationTemplate(event.template.body,context)}catch(error){
  const message=error instanceof Error?error.message:'Invalid notification template'
  await env.DB.prepare("INSERT OR IGNORE INTO notification_trigger_claims(id,project_id,conversation_id,event,state,outcome_json,created_at) VALUES(?,?,?,?,'template_error',?,?)").bind(id,event.projectId,ticket.id,claimEvent,JSON.stringify({error:message}),Date.now()).run()
  return {state:'template_error',error:message}
 }
 const eligible=users.results.filter(user=>user.email_preference&&user.email&&settings?.is_enabled!==0)
 // Inbox delivery has its own preference and never depends on mail setup.
 // Freeze unavailable email as terminal so later configuration cannot replay it.
 const unavailable=eligible.length>0&&!emailConfigured(env)
 const emails=new Set<string>(),inputs:EmailInput[]=[]
 for(const user of unavailable?[]:eligible){if(emails.has(user.email.toLowerCase()))continue;emails.add(user.email.toLowerCase());inputs.push({projectId:event.projectId,to:user.email,subject,text,idempotencyKey:inputs.length?`${id}:user:${user.id}`:id,headers:loopSuppressionHeaders({}),replyTo:settings?.inbound_address?await recipientReplyAddress(env,settings.inbound_address,event.projectId,ticket.id,user.email):undefined})}
 const claimToken=crypto.randomUUID()
 const claim=env.DB.prepare(`INSERT OR IGNORE INTO notification_trigger_claims(id,project_id,conversation_id,event,claim_token,state,outcome_json,created_at)
 SELECT ?,?,?,?,?,'claimed',?,? WHERE EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)
 ${event.guard?'AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ('+event.guard.sql+'))':''}
 AND NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN conversations c ON c.project_id=m.project_id AND c.id=? LEFT JOIN member_roles mr ON mr.project_id=m.project_id AND mr.user_id=m.user_id LEFT JOIN project_roles pr ON pr.project_id=m.project_id AND pr.id=mr.role_key LEFT JOIN notification_preferences p ON p.project_id=m.project_id AND p.user_id=m.user_id AND p.kind=? WHERE m.project_id=? AND u.id=json_extract(selected.value,'$.id') AND u.email=json_extract(selected.value,'$.email') AND ${selector} AND m.role IS json_extract(selected.value,'$.role') AND mr.role_key IS json_extract(selected.value,'$.role_key') AND pr.name IS json_extract(selected.value,'$.role_name') AND pr.base IS json_extract(selected.value,'$.role_base') AND pr.permissions_json IS json_extract(selected.value,'$.role_permissions') AND coalesce(p.inbox,1)=json_extract(selected.value,'$.inbox') AND coalesce(p.email,1)=json_extract(selected.value,'$.email_preference')))`)
 .bind(id,event.projectId,ticket.id,claimEvent,claimToken,JSON.stringify({recipients:inputs.map(input=>input.to)}),Date.now(),ticket.id,event.projectId,...(event.guard?[ticket.id,event.projectId,...event.guard.params]:[]),JSON.stringify(users.results),ticket.id,kind,event.projectId,...selectorArgs)
 const inbox=users.results.map(user=>env.DB.prepare(`INSERT OR IGNORE INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,email_address,state,created_at) SELECT ?,?,?,?,?,?,?,?,'action',? WHERE EXISTS(SELECT 1 FROM notification_trigger_claims WHERE id=? AND claim_token=? AND state='claimed')`).bind(`${id}:inbox:${user.id}`,event.projectId,ticket.id,user.id,kind,user.inbox,user.email_preference,user.email,Date.now(),id,claimToken))
 const unavailableOutcome=JSON.stringify({inbox:'recorded',email:'not_configured'})
 const result=await env.DB.batch([claim,...inbox,...(unavailable?[env.DB.prepare("UPDATE notification_trigger_claims SET state='not_configured',outcome_json=? WHERE id=? AND claim_token=? AND state='claimed'").bind(unavailableOutcome,id,claimToken)]:[])])
 if(!result[0].meta.changes){const saved=await env.DB.prepare('SELECT state,outcome_json FROM notification_trigger_claims WHERE id=?').bind(id).first<any>();return saved?{state:saved.state,outcome:JSON.parse(saved.outcome_json)}:{state:'cancelled'}}
 if(unavailable)return {state:'not_configured',outcome:{inbox:'recorded',email:'not_configured'}}
 try{
  const deliveries=await sendEmails(env,inputs),state=deliveries.some(d=>['uncertain','sending'].includes(d.state))?'uncertain':deliveries.some(d=>d.state==='failed')?'failed':'complete'
  await env.DB.prepare('UPDATE notification_trigger_claims SET state=?,outcome_json=? WHERE id=?').bind(state,JSON.stringify({deliveries}),id).run()
  return {state,deliveries}
 }catch{
  await env.DB.prepare("UPDATE notification_trigger_claims SET state='uncertain' WHERE id=?").bind(id).run();return {state:'uncertain'}
 }
}
