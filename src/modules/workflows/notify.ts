import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {sendTicketNotification,type TicketNotificationAction} from '../integrations/notification-actions'
import {availableTicketSql} from '../tickets/model'
import {conversationHasMessages} from '../management/inbox-visible'
import {workflowNow} from './clock'
import type {WorkflowGuard} from './actions'
export interface WorkflowNotification {projectId:string;conversationId:string;id:string;kind:string;recipientId?:string;message?:string;guard?:WorkflowGuard}
export interface WorkflowNotificationResult {state:'pending'|'complete'|'failed'|'uncertain'|'cancelled'|'not_delivered';detail?:string}
/** The workflow claim owns execution; R4 owns recipient proof, the immutable
 * audience and provider delivery. A lost claim is uncertain, never replayable. */
export async function notifyWorkflow(env:Env,input:WorkflowNotification):Promise<WorkflowNotificationResult>{
 const {projectId,conversationId,id,kind,recipientId,message}=input,now=workflowNow(env)
 const prior=await env.DB.prepare('SELECT state,detail FROM workflow_notifications WHERE id=? AND project_id=? AND conversation_id=?').bind(id,projectId,conversationId).first<any>()
 if(prior&&prior.state!=='pending'){
  if(prior.state==='sending'){
   const detail='Notification claim was interrupted; delivery outcome is unknown; no automatic replay'
   await env.DB.prepare("UPDATE workflow_notifications SET state='uncertain',detail=?,updated_at=? WHERE id=? AND project_id=? AND conversation_id=? AND state='sending'").bind(detail,now,id,projectId,conversationId).run()
   return {state:'uncertain',detail}
  }
  return {state:prior.state,detail:prior.detail??undefined}
 }
 const customer=['customer_update','request_received','solved'].includes(kind)
 if(kind.startsWith('sla_')&&!recipientId)return {state:'cancelled',detail:'An SLA alert requires a named current operator'}
 if(customer&&recipientId)return {state:'cancelled',detail:'Customer notices use the ticket’s current proven customer addresses'}
 const audience:TicketNotificationAction['audience']=customer?'requester':kind==='group'||kind==='followers'?kind:recipientId?'member':kind==='assignee'?'assignee':'member'
 if(audience==='member'&&!recipientId)return {state:'cancelled',detail:'The notification requires a named current operator'}
 const guard=input.guard?`AND (${input.guard.sql})`:'',args=input.guard?.params??[]
 const recipientCheck=recipientId?(kind==='group'?"AND c.assigned_to IS NULL AND c.group_id=? AND EXISTS(SELECT 1 FROM ticket_groups g WHERE g.project_id=c.project_id AND g.id=c.group_id)":'AND EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=?)'):''
 const ticket=`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${availableTicketSql()} AND ${conversationHasMessages()} AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ${guard} ${recipientCheck}`
 const ticketArgs=[projectId,conversationId,...args,...(recipientId?[recipientId]:[])]
 if(!await env.DB.prepare(ticket).bind(...ticketArgs).first())return {state:'cancelled',detail:'Ticket, recipient or workflow is no longer eligible'}
 await env.DB.prepare(`INSERT OR IGNORE INTO workflow_notifications(id,project_id,conversation_id,kind,recipient_id,message,state,detail,created_at,updated_at) SELECT ?,?,?,?,?,?,'pending',NULL,?,? WHERE EXISTS(${ticket})`).bind(id,projectId,conversationId,kind,recipientId??null,message??null,now,now,...ticketArgs).run()
 const claim=await env.DB.prepare(`UPDATE workflow_notifications SET state='sending',detail=NULL,updated_at=? WHERE id=? AND project_id=? AND state='pending' AND EXISTS(${ticket})`).bind(now,id,projectId,...ticketArgs).run()
 if(!claim.meta.changes){const row=await env.DB.prepare('SELECT state,detail FROM workflow_notifications WHERE id=? AND project_id=?').bind(id,projectId).first<any>();return {state:row?.state==='sending'?'uncertain':row?.state??'cancelled',detail:row?.detail}}
 let result:WorkflowNotificationResult
 try{
  // Rule/run identities can exceed R4's event-id limit; hash the complete scoped
  // identity, including a named backup recipient, without truncation collisions.
  const eventId=`workflow:${await hashToken(JSON.stringify([projectId,conversationId,id,kind,recipientId??null]))}`
  const subject=kind==='request_received'?'Request #{{ticket.id}} received':kind==='solved'?'Request #{{ticket.id}} solved':'Support ticket #{{ticket.id}}'
  const body=message||(kind==='request_received'?'We received your support request #{{ticket.id}}.':kind==='solved'?'Your support request #{{ticket.id}} has been solved. Reply if you need more help.':customer?'There is an update to your support request #{{ticket.id}}.':'Support ticket #{{ticket.id}} needs your attention.')
  const delivered=await sendTicketNotification(env,{projectId,conversationId,eventId,audience,recipientId,template:{subject,body},source:'native',...(kind==='solved'?{customerEvent:'ticket_solved' as const}:{}),guard:{sql:`EXISTS(${ticket})`,params:ticketArgs}})
  const state=delivered.state
  const locallySuppressed=state==='suppressed'&&('deliveries' in delivered||'outcome' in delivered&&Array.isArray(delivered.outcome?.deliveries))
  result=state==='complete'||state==='sent'||locallySuppressed?{state:'complete',...(state==='suppressed'?{detail:'Development mail was suppressed; no external delivery occurred'}:{})}
   :state==='not_configured'?{state:'not_delivered',detail:'Not sent: email delivery is not configured'}
   :state==='no_recipient'?{state:'not_delivered',detail:customer?'Not sent: no proven eligible customer address':'Not sent: no current permitted member is eligible for this notice'}
   :state==='disabled'?{state:'not_delivered',detail:'Not sent: ticket email is disabled'}
   :state==='cancelled'||state==='not_new_request'||state==='suppressed'?{state:'cancelled',detail:'Ticket, recipient or workflow changed before the delivery claim'}
   :state==='failed'||state==='template_error'?{state:'failed',detail:state==='template_error'?'Notification template could not be rendered':'Email delivery failed'}
   :{state:'uncertain',detail:'Delivery outcome is unknown; automatic replay is forbidden'}
 }catch{result={state:'uncertain',detail:'Delivery outcome is unknown; automatic replay is forbidden'}}
 await env.DB.prepare('UPDATE workflow_notifications SET state=?,detail=?,updated_at=? WHERE id=? AND project_id=?').bind(result.state,result.detail??null,workflowNow(env),id,projectId).run()
 return result
}
