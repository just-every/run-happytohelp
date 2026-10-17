import type {Env} from '../../platform/env'
import * as notifications from '../integrations/notifications'
import {availableTicketSql} from '../tickets/model'
import {memberAccess} from '../access/gate'
import {workflowNow} from './clock'
import type {WorkflowGuard} from './actions'
export interface WorkflowNotification {projectId:string;conversationId:string;id:string;kind:string;recipientId?:string;message?:string;guard?:WorkflowGuard}
export interface WorkflowNotificationResult {state:'pending'|'complete'|'failed'|'uncertain'|'cancelled'|'not_delivered';detail?:string}
type Adapter=(env:Env,input:WorkflowNotification)=>Promise<{state:string;detail?:string}>
/** R4 owns delivery and recipient proof. Until its notice entry point is installed a
 * notice can never be sent, so it ends as not delivered with that reason: never a
 * simulated send, and never an intent that waits to send a stale notice later. */
const NOT_INSTALLED='Not sent: this installation cannot deliver workflow notices until ticket notification delivery is installed'
export async function notifyWorkflow(env:Env,input:WorkflowNotification):Promise<WorkflowNotificationResult>{
 const {projectId,conversationId,id,kind,recipientId,message}=input,now=workflowNow(env)
 const prior=await env.DB.prepare('SELECT state,detail FROM workflow_notifications WHERE id=? AND project_id=? AND conversation_id=?').bind(id,projectId,conversationId).first<any>()
 if(prior&&prior.state!=='pending')return {state:prior.state==='sending'?'uncertain':prior.state,detail:prior.detail??undefined}
 if(kind.startsWith('sla_')&&!recipientId)return {state:'cancelled',detail:'An SLA alert requires a named current operator'}
 if(recipientId){const access=await memberAccess(env.DB,projectId,recipientId);if(!access?.permissions.has('conversations.manage'))return {state:'cancelled',detail:'Recipient is no longer an authorized operator'}}
 const adapter=(notifications as unknown as {notifyWorkflowNotice?:Adapter}).notifyWorkflowNotice
 const guard=input.guard?`AND (${input.guard.sql})`:'',args=input.guard?.params??[]
 const ticket=`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${availableTicketSql()} AND NOT EXISTS(SELECT 1 FROM contact_erasures er WHERE er.project_id=c.project_id AND er.contact_id=c.contact_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) ${guard} ${recipientId?'AND EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=?)':''}`
 const ticketArgs=[projectId,conversationId,...args,...(recipientId?[recipientId]:[])]
 if(!await env.DB.prepare(ticket).bind(...ticketArgs).first())return {state:'cancelled',detail:'Ticket, recipient or workflow is no longer eligible'}
 await env.DB.prepare(`INSERT OR IGNORE INTO workflow_notifications(id,project_id,conversation_id,kind,recipient_id,message,state,detail,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(${ticket})`).bind(id,projectId,conversationId,kind,recipientId??null,message??null,adapter?'pending':'not_delivered',adapter?null:NOT_INSTALLED,now,now,...ticketArgs).run()
 if(!adapter)return {state:'not_delivered',detail:NOT_INSTALLED}
 const claim=await env.DB.prepare(`UPDATE workflow_notifications SET state='sending',detail=NULL,updated_at=? WHERE id=? AND project_id=? AND state='pending' AND EXISTS(${ticket})`).bind(now,id,projectId,...ticketArgs).run()
 if(!claim.meta.changes){const row=await env.DB.prepare('SELECT state,detail FROM workflow_notifications WHERE id=? AND project_id=?').bind(id,projectId).first<any>();return {state:row?.state==='sending'?'uncertain':row?.state??'cancelled',detail:row?.detail}}
 let result:WorkflowNotificationResult
 try{const delivered=await adapter(env,input);result={state:['complete','sent','suppressed','disabled'].includes(delivered.state)?'complete':['failed','not_configured'].includes(delivered.state)?'failed':['no_recipient','cancelled'].includes(delivered.state)?'cancelled':['pending','deferred'].includes(delivered.state)?'pending':'uncertain',detail:delivered.detail??(delivered.state==='complete'?undefined:delivered.state)}}catch{result={state:'uncertain',detail:'Delivery outcome is unknown; automatic replay is forbidden'}}
 await env.DB.prepare('UPDATE workflow_notifications SET state=?,detail=?,updated_at=? WHERE id=? AND project_id=?').bind(result.state,result.detail??null,workflowNow(env),id,projectId).run()
 return result
}
