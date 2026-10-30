import {syncSharedStatus} from '../support-channels/shared-sync'
import {agentOperation,nativeAgentAuthority,type NativeAgentAuthority} from '../../platform/agent-authority'
import {inTicketBatch,admitTicketWork} from './request-batch'
import {auditStatement,type AuditEvent} from '../audit/record'
import {processWorkflowEvents} from '../workflows/events'
import {workflowNow,workflowEnvironment} from '../workflows/clock'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {getTicket,availableTicketSql,type TicketAuthority} from './model'
import {prepareTicketChange,type TicketChange} from './mutate-validation'
import {publishResolution} from '../outcomes/state'
import {assignmentHistoryStatement} from '../outcomes/assignment-history'
import {assignmentNotificationStatement} from '../integrations/notifications'
import {dispatchRequestAssignment} from '../integrations/notification-request'
import {publishActivity} from '../conversations/activity'
import {onAssistantAssignment} from '../ai-support/customer-message'
import {assertModelConfigured} from '../ai-support/configuration'
import {notifyTicketEvent} from '../integrations/triggers'
export type {TicketChange} from './mutate-validation'
export class TicketCommittedError extends HTTPException {
 readonly committed=true
 readonly ticketId:string
 readonly ticketVersion:number
 constructor(ticketId:string,ticketVersion:number,cause:unknown){
  super(503,{message:'Ticket changes were saved, but the update could not finish refreshing. Reload before making further changes.',cause,res:new Response(JSON.stringify({error:'Ticket changes were saved, but refresh or notification failed. Reload before making further changes.',code:'ticket_committed',committed:true,id:ticketId,ticket_version:ticketVersion}),{status:503,headers:{'Content-Type':'application/json'}})})
  this.ticketId=ticketId
  this.ticketVersion=ticketVersion
 }
}
export async function previewTicket(env:Env,actor:Actor,id:string,change:TicketChange,authority:TicketAuthority){const checked=await prepareTicketChange(env,actor,id,change,authority);return {ticket:await getTicket(env,actor,id,authority.tokenAuthority),changes:checked.change}}
/** The receipt is written with live authority, schema and ticket frontier checks.
 * Every effect in the transaction depends on that receipt. */
export async function mutateTicket(env:Env,actor:Actor,id:string,input:TicketChange,authority:TicketAuthority,receiptAudit?:AuditEvent,receiptId?:string){
 env=await workflowEnvironment(env)
 const {change,current,next,fields,values,guard,predicates,params}=await prepareTicketChange(env,actor,id,input,authority)
 if(change.ai_id&&!change.agent_id&&current.last_message_id){const model=await env.DB.prepare("SELECT a.model FROM ai_profiles a JOIN messages m ON m.id=? AND m.actor_role='contact' WHERE a.project_id=? AND a.id=?").bind(current.last_message_id,actor.projectId,change.ai_id).first<{model:string}>();if(model)assertModelConfigured(env,model.model)}
 const now=Math.max(workflowNow(env),current.updated_at+1),receipt=receiptId??crypto.randomUUID(),source=authority.source??(authority.tokenAuthority?'api':'dashboard'),actorType=authority.tokenAuthority?'api':'user',actorId=authority.tokenAuthority?.tokenId??actor.id
 const accepted='EXISTS(SELECT 1 FROM ticket_history WHERE id=? AND conversation_id=?)'
 const history:Record<string,unknown>={}
 for(const key of ['status_id','status_category','priority','subject','channel','group_id','requester_id','submitter_id','submitter_type','assigned_to','current_ai_id'])if(current[key]!==next[key])history[key]={from:current[key],to:next[key]}
 if(Object.keys(fields).length)history.fields=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,{from:values[key]??null,to:value}]))
 if(change.tags_add?.length||change.tags_remove?.length)history.tags={add:change.tags_add,remove:change.tags_remove}
 // Tags retain the inbox activity timestamp; their history and ticket version
 // advance independently, including an add/remove pair before strict import undo.
 const tagsOnly=Object.keys(change).every(key=>key.startsWith('expected_')||key==='tags_add'||key==='tags_remove')
 const updatedAt=tagsOnly?current.updated_at:now
 // Attribute ticket metadata before changing it; the trigger records each actual field transition.
 const statements=[env.DB.prepare(`INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json) SELECT ?,c.project_id,c.id,?,?,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.ticket_version=? AND c.updated_at=? AND c.revision=? AND c.last_message_id IS ? AND c.status_category<>'closed' AND ${availableTicketSql()} AND EXISTS(${guard.sql}) ${predicates.map(p=>'AND '+p).join(' ')}`).bind(receipt,actorId,actorType,source,now,JSON.stringify(history),id,actor.projectId,current.ticket_version,current.updated_at,current.revision,current.last_message_id,...guard.params,...params)]
 // Tag changes do not create outcome cycles. Tracking precedes resolution or
 // assignment changes so those cycles retain their provenance.
 if(!tagsOnly)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT id,project_id,0,0,revision,created_at FROM conversations WHERE id=? AND ${accepted}`).bind(id,receipt,id))
 statements.push(env.DB.prepare(`UPDATE conversations SET status_id=?,status_category=?,resolved_at=?,subject=?,priority=?,channel=?,brand_id=project_id,group_id=?,requester_id=?,contact_id=?,submitter_id=?,submitter_type=?,assigned_to=?,ticket_actor_id=?,ticket_actor_type=?,ticket_source=?,updated_at=? WHERE id=? AND ${accepted}`).bind(next.status_id,next.status_category,['solved','closed'].includes(next.status_category)?current.resolved_at??now:null,next.subject,next.priority,next.channel,next.group_id,next.requester_id,next.requester_id,next.submitter_id,next.submitter_type,next.assigned_to,actorId,actorType,source,updatedAt,id,receipt,id))
 for(const [field,value] of Object.entries(fields))statements.push(value===null?env.DB.prepare(`DELETE FROM ticket_field_values WHERE project_id=? AND conversation_id=? AND field_id=? AND ${accepted}`).bind(actor.projectId,id,field,receipt,id):env.DB.prepare(`INSERT INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT ?,?,?,? WHERE ${accepted} ON CONFLICT(project_id,conversation_id,field_id) DO UPDATE SET value_json=excluded.value_json`).bind(actor.projectId,id,field,JSON.stringify(value),receipt,id))
 for(const tag of change.tags_add??[])statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversation_tags(project_id,conversation_id,tag_id) SELECT ?,?,? WHERE ${accepted}`).bind(actor.projectId,id,tag,receipt,id))
 for(const tag of change.tags_remove??[])statements.push(env.DB.prepare(`DELETE FROM conversation_tags WHERE project_id=? AND conversation_id=? AND tag_id=? AND ${accepted}`).bind(actor.projectId,id,tag,receipt,id))
 const assignmentChanged=current.assigned_to!==next.assigned_to||current.current_ai_id!==next.current_ai_id
 if('ai_id' in change||change.agent_id)statements.push(env.DB.prepare(`INSERT INTO conversation_ai(conversation_id,ai_id) SELECT ?,? WHERE ${accepted} ON CONFLICT(conversation_id) DO UPDATE SET ai_id=excluded.ai_id`).bind(id,next.current_ai_id,receipt,id))
 if(assignmentChanged||['solved','closed'].includes(next.status_category))statements.push(env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE project_id=? AND conversation_id=? AND state IN ('queued','running') AND ${accepted}`).bind(new Date(now).toISOString(),actor.projectId,id,receipt,id))
 if(assignmentChanged){statements.push(assignmentHistoryStatement(env,{id:receipt,conversationId:id,actorId,agentId:next.assigned_to,aiId:next.current_ai_id,createdAt:now},accepted,[receipt,id]),assignmentNotificationStatement(env,{id:receipt,projectId:actor.projectId,conversationId:id,actorId,previousAssignee:current.assigned_to,assignee:next.assigned_to},accepted,[receipt,id]))}
 if(receiptAudit)statements.push(auditStatement(env.DB,receiptAudit,now,{sql:accepted,params:[receipt,id]}))
 if(authority[nativeAgentAuthority])statements.push(agentOperation(env,authority as NativeAgentAuthority,'conversation',id,{sql:accepted,params:[receipt,id]},{history_id:receipt}))
 admitTicketWork(env,statements.length+(inTicketBatch(env)?24:64))
 let committed=false
 try{committed=Boolean((await env.DB.batch(statements))[0].meta.changes)}catch(error){
  // Confirm the native receipt after a lost response. The successful bulk audit
  // is in that same transaction, so confirmed changes always have their receipt.
  try{committed=Boolean(await env.DB.prepare('SELECT 1 FROM ticket_history WHERE id=? AND conversation_id=?').bind(receipt,id).first())}catch{throw new HTTPException(503,{message:'Ticket outcome could not be confirmed. Reload before trying again.'})}
  if(!committed)throw error
 }
 if(!committed)throw new HTTPException(409,{message:'Ticket, field configuration or authority changed. Reload before applying changes.'})
 try{
 if(!inTicketBatch(env))await processWorkflowEvents(env,id)
 if(assignmentChanged)await dispatchRequestAssignment(env,actor.projectId,id)
 if(assignmentChanged){await publishActivity(env,actor.projectId,id,'assignment')}
 if(change.ai_id&&!change.agent_id)await onAssistantAssignment(env,actor.projectId,id,{sql:`${accepted} AND c.assigned_to IS NULL AND c.last_message_id IS ? AND EXISTS(SELECT 1 FROM conversation_ai WHERE conversation_id=c.id AND ai_id=?) AND EXISTS(${guard.sql}) AND ${availableTicketSql()}`,params:[receipt,id,current.last_message_id,change.ai_id,...guard.params]},assignmentChanged)
 if(current.group_id!==next.group_id&&next.group_id){const members=await env.DB.prepare('SELECT user_id FROM ticket_group_members WHERE project_id=? AND group_id=?').bind(actor.projectId,next.group_id).all<{user_id:string}>();await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:id,event:'group',eventId:receipt,actorId:actor.id,recipientIds:members.results.map(m=>m.user_id)})}
 await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:id,event:'ticket_updated',eventId:receipt,actorId:actor.id})
 if(assignmentChanged||current.status_id!==next.status_id)await syncSharedStatus(env,actor.projectId,id)
 if(current.status_id!==next.status_id)await publishResolution(env,actor.projectId,id)
 return inTicketBatch(env)?{ticket_version:current.ticket_version+1}:await getTicket(env,actor,id,authority.tokenAuthority)
 }catch(error){throw new TicketCommittedError(id,current.ticket_version+1,error)}
}
