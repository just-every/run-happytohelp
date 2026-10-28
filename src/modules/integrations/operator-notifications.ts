import {ticketScopeSql} from '../access/ticket-scope'
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
export type OperatorNotification={id:string;project_id:string;conversation_id:string;user_id:string;kind:'assignment'|'unread';batch_id:string|null;through_revision:number;recovery_id?:string|null}
type Notification=OperatorNotification
// The ordinary paths cost 21/18. Two failure-accounting statements also fit
// when preparation fails before a provider claim can be recorded.
export const operatorNotificationCost={assignment:23,unread:20}
export const operatorPendingSql="SELECT o.*,(SELECT id FROM notification_trigger_claims WHERE id='operator-recovery:'||o.id) recovery_id FROM operator_notifications o"
export const operatorAdmission=(row:OperatorNotification)=>operatorNotificationCost[row.kind]+(row.recovery_id?1:0)
type Recipient={email:string;assigned_to:string|null;assignment_preference:number;unassigned_preference:number;read_revision:number;inbound_address:string|null;is_enabled:number|null}
async function recipient(env:Env,row:Notification){
 return env.DB.prepare(`SELECT u.email,c.assigned_to,coalesce(s.is_notifiable_on_conversation_assignment,1) assignment_preference,
 coalesce(p.is_notified_on_unassigned_activity,0) unassigned_preference,coalesce(r.revision,0) read_revision,e.inbound_address,e.is_enabled
 FROM conversations c JOIN users u ON u.id=? JOIN memberships m ON m.user_id=u.id AND m.project_id=c.project_id
 LEFT JOIN user_settings s ON s.user_id=u.id LEFT JOIN user_project_preferences p ON p.project_id=m.project_id AND p.user_id=u.id
 LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=u.id LEFT JOIN email_settings e ON e.project_id=c.project_id
 WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND ${ticketScopeSql('m.user_id')} AND (?='assignment' OR c.resolved_at IS NULL)
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
 if(!await recipient(env,row))return
 await deliverNotification(env,{projectId:row.project_id,to:user.email,subject:'Unread HappyToHelp conversation messages',text,...rich,replyTo,headers:loopSuppressionHeaders({}),idempotencyKey:row.id})
}
export async function deliverOperatorNotification(env:Env,row:OperatorNotification){
 try{
  await sendNotification(env,row)
  if(row.recovery_id)await env.DB.prepare("UPDATE notification_trigger_claims SET state='complete' WHERE id=?").bind(row.recovery_id).run()
  // Assignment has durably frozen the inbox audience. Optional email is owned
  // by that inbox row, including awaiting_provider and terminal send outcomes.
  await env.DB.prepare("UPDATE operator_notifications SET state='complete' WHERE id=?").bind(row.id).run()
  return true
 }catch(error){
  // Known provider outcomes are already terminal. Only failures before that
  // durable attempt reach here; three preparations end visibly, across restarts.
  const failure=env.DB.prepare(`INSERT INTO notification_trigger_claims(id,project_id,conversation_id,event,state,outcome_json,created_at)
   VALUES(?,?,?,?,'pending',json_object('attempts',1,'reason','Notification preparation failed'),?)
   ON CONFLICT(id) DO UPDATE SET state=CASE WHEN json_extract(outcome_json,'$.attempts')+1>=3 THEN 'failed' ELSE 'pending' END,
   outcome_json=json_set(outcome_json,'$.attempts',json_extract(outcome_json,'$.attempts')+1)
   RETURNING json_extract(outcome_json,'$.attempts') attempts`).bind('operator-recovery:'+row.id,row.project_id,row.conversation_id,'operator-recovery:'+row.id,Date.now())
  // A terminal preparation outcome and removal from recovery are one commit.
  // A lost response or restart cannot resurrect a visibly failed notification.
  const result=await env.DB.batch<{attempts:number}>([failure,env.DB.prepare("UPDATE operator_notifications SET state='complete' WHERE id=? AND EXISTS(SELECT 1 FROM notification_trigger_claims WHERE id=? AND state='failed')").bind(row.id,'operator-recovery:'+row.id)])
  console.error('Operator notification preparation failed',row.id,error instanceof Error?error.name:'Error')
  return (result[0].results[0]?.attempts??0)>=3
 }
}
/** Bounded scheduled recovery. No attempted provider delivery is replayed.
 * `now` allows the scheduler's clock to be supplied by a caller. */
export async function dispatchOperatorNotifications(env:Env,options:{projectId?:string;conversationId?:string;now?:number;statementLimit?:number}={}){
 const limit=options.statementLimit??scheduledReservations.notifications
 const budget=boundedDatabase(env.DB,limit)
 env={...env,DB:budget.database}
 // Older Workers claimed inbox mail as sending. An abandoned claim has an
 // unknown outcome, never permission to submit the provider call again.
 await env.DB.prepare("UPDATE notification_inbox SET state='uncertain' WHERE state='sending'").run()
 // Reserve a turn for both delivery queues, even with sustained teammate work.
 // Earlier unused credit rolls forward; unclaimed activity and pending rows keep
 // their existing ordering and remain recoverable on the next tick.
 const teammatesDeferred=await dispatchPendingTeammateNotifications(cronConsumer(env,Math.max(19,Math.floor((limit-budget.statements-3)/2))),options)
 await batchOperatorActivity(cronConsumer(env,Math.min(51,limit-budget.statements-25)),options.now??Date.now(),options.projectId,options.conversationId)
 const deliveryEnv=env
 env=cronConsumer(env,limit-budget.statements)
 const pending=await env.DB.prepare(`${operatorPendingSql} WHERE o.state='pending' ${options.projectId?'AND o.project_id=?':''} ${options.conversationId?'AND o.conversation_id=?':''} ORDER BY o.created_at,o.id LIMIT 100`)
 .bind(...(options.projectId?[options.projectId]:[]),...(options.conversationId?[options.conversationId]:[])).all<Notification>()
 for(const row of pending.results){
  // Rendering is two bulk reads, even for a full 100-message digest. Admission
  // includes assignment's one-recipient fan-out and every failure receipt.
  if(!cronRoom(env,operatorAdmission(row)))break
  if(!await deliverOperatorNotification(env,row))break
 }
 // Pending work may be empty or cheaper than its admission. Let the teammate
 // queue spend that settled remainder instead of leaving it idle.
 if(teammatesDeferred&&limit-budget.statements>=19)await dispatchPendingTeammateNotifications(cronConsumer(deliveryEnv,limit-budget.statements),options)
}
