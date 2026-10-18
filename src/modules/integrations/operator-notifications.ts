import {dispatchPendingTeammateNotifications} from './notification-teammate-delivery'
import {teammateTicketNotification} from './notification-teammates'
import type {Env} from '../../platform/env'
import {boundedDatabase} from '../../platform/d1-budget'
import {cronConsumer,cronRoom} from '../../platform/cron-budget'
import {scheduledReservations} from '../../platform/scheduled-budget'
import {isProjectActive} from '../../platform/project-status'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {emailConfigured,type EmailInput} from './email'
import {recipientReplyAddress} from './email-reply-address'
import {renderConversationDigest} from './email-content'
import {batchOperatorActivity} from './operator-activity'
import {deliverNotification,loopSuppressionHeaders,recordedNotification} from './notification-delivery'

export interface AssignmentNotification {
 id:string;projectId:string;conversationId:string;actorId:string;previousAssignee:string|null;assignee:string|null
}
/** Append to the authority-guarded transition transaction, using its receipt
 * predicate. A committed assignment survives a crash before immediate dispatch. */
export function assignmentNotificationStatement(env:Env,event:AssignmentNotification,acceptedSql:string,acceptedArgs:unknown[]){
 return env.DB.prepare(`INSERT OR IGNORE INTO operator_notifications(id,project_id,conversation_id,user_id,kind,through_revision,created_at)
 SELECT ?,c.project_id,c.id,?,'assignment',c.revision,? FROM conversations c
 WHERE c.id=? AND c.project_id=? AND c.assigned_to=? AND ? IS NOT NULL AND ? IS NOT ? AND ?<>? AND (${acceptedSql})`)
 .bind(`assignment:${event.id}`,event.assignee,Date.now(),event.conversationId,event.projectId,event.assignee,event.assignee,event.assignee,event.previousAssignee,event.assignee,event.actorId,...acceptedArgs)
}
const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
type Notification={id:string;project_id:string;conversation_id:string;user_id:string;kind:'assignment'|'unread';batch_id:string|null;through_revision:number}
type Recipient={email:string;assigned_to:string|null;assignment_preference:number;unassigned_preference:number;read_revision:number;inbound_address:string|null;is_enabled:number|null}
async function recipient(env:Env,row:Notification){
 return env.DB.prepare(`SELECT u.email,c.assigned_to,coalesce(s.is_notifiable_on_conversation_assignment,1) assignment_preference,
 coalesce(p.is_notified_on_unassigned_activity,0) unassigned_preference,coalesce(r.revision,0) read_revision,e.inbound_address,e.is_enabled
 FROM conversations c JOIN users u ON u.id=? JOIN memberships m ON m.user_id=u.id AND m.project_id=c.project_id
 LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN user_project_preferences p ON p.project_id=m.project_id AND p.user_id=u.id
 LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=u.id LEFT JOIN email_settings e ON e.project_id=c.project_id
 WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND (?='assignment' OR c.resolved_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM notification_preferences np WHERE np.project_id=c.project_id AND np.user_id=u.id AND np.kind='customer_updated' AND np.email=0)
 AND (c.assigned_to=u.id OR (?='unread' AND c.assigned_to IS NULL AND p.is_notified_on_unassigned_activity=1
 AND NOT EXISTS(SELECT 1 FROM conversation_ai ai WHERE ai.conversation_id=c.id AND ai.ai_id IS NOT NULL)))`)
 .bind(row.user_id,row.conversation_id,row.project_id,row.kind,row.kind).first<Recipient>()
}
async function sendNotification(env:Env,row:Notification){
 if(row.kind==='assignment'){return await teammateTicketNotification(env,{projectId:row.project_id,conversationId:row.conversation_id,event:'assignment',eventId:row.id,recipientIds:[row.user_id]})}
 if(await recordedNotification(env,row.id))return
 if(!await isProjectActive(env,row.project_id)||!emailConfigured(env))return
 const user=await recipient(env,row)
 if(!user||user.is_enabled===0||!user.email)return
 let text=''
 let rich:Pick<EmailInput,'html'|'attachments'>={}
 if(row.kind==='unread'){
  const unread=await env.DB.prepare(`SELECT m.id,m.actor_id,m.actor_role,m.content,m.revision FROM operator_notification_activity a JOIN messages m ON m.id=a.message_id AND m.project_id=a.project_id AND m.conversation_id=a.conversation_id
   WHERE a.batch_id=? AND a.conversation_id=? AND a.project_id=? AND m.revision>? ORDER BY m.revision LIMIT 100`)
   .bind(row.batch_id,row.conversation_id,row.project_id,user.read_revision).all<{id:string;actor_id:string;actor_role:string;content:string;revision:number}>()
  if(!unread.results.length)return
  const context=await env.DB.prepare('SELECT actor_role,content FROM messages WHERE conversation_id=? AND project_id=? AND revision<? ORDER BY revision DESC LIMIT 3')
   .bind(row.conversation_id,row.project_id,unread.results[0].revision).all<{actor_role:string;content:string}>()
  const previous=context.results.reverse()
  const rendered=await renderConversationDigest(env,{projectId:row.project_id,conversationId:row.conversation_id,messages:unread.results})
  text=[...(previous.length?['Previous context:',...previous.map(m=>`${m.actor_role}: ${m.content}`),'']:[]),'Unread customer messages:',...unread.results.map(m=>m.content),...(rendered.attachments.length?['Attachments:',...rendered.attachments.map(file=>file.filename)]:[]),...(rendered.omitted.length?['Not attached (view in the conversation):',...rendered.omitted.map(file=>file.url?`${file.filename}: ${file.url}`:file.filename)]:[])].join('\n\n')
  rich={html:[...(previous.length?['<h2>Previous context:</h2>',...previous.map(m=>`<p>${escapeHtml(m.actor_role)}: ${escapeHtml(m.content).replace(/\n/g,'<br />')}</p>`)]:[]),'<h2>Unread customer messages:</h2>',rendered.html].join(''),attachments:rendered.attachments}
 }
 if(typeof env.APP_ORIGIN==='string'){
  const url=new URL(`/projects/${encodeURIComponent(row.project_id)}/conversations/${encodeURIComponent(row.conversation_id)}`,env.APP_ORIGIN).href
  text+=`\n\nOpen conversation: ${url}`
  if(rich.html)rich.html+=`<p>Open conversation: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`
 }
 const replyTo=await recipientReplyAddress(env,user.inbound_address,row.project_id,row.conversation_id,user.email)
 await deliverNotification(env,{projectId:row.project_id,to:user.email,subject:'Unread HappyToHelp conversation messages',text,...rich,replyTo,headers:loopSuppressionHeaders({}),idempotencyKey:row.id})
}
/** Bounded scheduled recovery. No attempted provider delivery is replayed.
 * `now` allows the scheduler's clock to be supplied by a caller. */
export async function dispatchOperatorNotifications(env:Env,options:{projectId?:string;conversationId?:string;now?:number}={}){
 const budget=boundedDatabase(env.DB,scheduledReservations.notifications)
 env={...env,DB:budget.database}
 // Reserve a turn for both delivery queues, even with sustained teammate work.
 // Earlier unused credit rolls forward; unclaimed activity and pending rows keep
 // their existing ordering and remain recoverable on the next tick.
 await dispatchPendingTeammateNotifications(cronConsumer(env,19),options)
 await batchOperatorActivity(cronConsumer(env,22-budget.statements),options.now??Date.now(),options.projectId,options.conversationId)
 env=cronConsumer(env,scheduledReservations.notifications-budget.statements)
 const pending=await env.DB.prepare(`SELECT * FROM operator_notifications WHERE state='pending' ${options.projectId?'AND project_id=?':''} ${options.conversationId?'AND conversation_id=?':''} ORDER BY created_at,id LIMIT 100`)
 .bind(...(options.projectId?[options.projectId]:[]),...(options.conversationId?[options.conversationId]:[])).all<Notification>()
 for(const row of pending.results){
  // Rendering is two bulk reads, even for a full 100-message digest. Admission
  // includes assignment's one-recipient fan-out and every failure receipt.
  if(!cronRoom(env,row.kind==='assignment'?21:18))break
  try{
   const result=await sendNotification(env,row)
   if(!emailConfigured(env)||result?.state==='awaiting_provider')continue
   await env.DB.prepare("UPDATE operator_notifications SET state='complete' WHERE id=?").bind(row.id).run()
  }catch{console.error('Operator notification pending',row.id)}
 }
}
