import type {Actor,Env} from '../../platform/env'
import {syncSlaTickets} from './sla'
import {memberAccess} from '../access/gate'
import {admitMessage} from '../conversations/admission'
import {applyMessageEffects} from '../../message-effects'
import {publishActivity} from '../conversations/activity'
import {scheduledAdmission} from './schedule-authority'
import {workflowNow} from './clock'
import type {Spent} from './budget'
import {boundedDatabase} from '../../platform/d1-budget'
import {liveScheduleTicketSql,wakeDueSnoozes} from './schedules-snoozes'
import {openRerMailHold,rerMailHeld} from '../integrations/rer-mail-hold'
const liveScheduleSql=`EXISTS(SELECT 1 FROM workflow_schedules ws JOIN memberships wm ON wm.project_id=ws.project_id AND wm.user_id=ws.sender_id WHERE ws.id=? AND ws.conversation_id=c.id AND ws.state='sending' AND ws.expected_revision=c.revision AND ws.expected_last_message_id IS c.last_message_id AND ws.expected_assignee IS c.assigned_to AND ws.expected_group_id IS c.group_id AND wm.role=ws.sender_role AND (SELECT role_key FROM member_roles WHERE project_id=wm.project_id AND user_id=wm.user_id) IS ws.sender_role_key AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=wm.project_id AND mr.user_id=wm.user_id) IS ws.sender_role_updated_at AND EXISTS(SELECT 1 FROM memberships owner WHERE owner.project_id=ws.project_id AND owner.user_id=ws.owner_id))`
async function settle(env:Env,id:string,state:string,reason:string|null,now:number,messageId?:string,pendingVersion?:number){await env.DB.prepare(`UPDATE workflow_schedules SET state=?,reason=?,message_id=coalesce(?,message_id),updated_at=?,version=version+1 WHERE id=? AND ${pendingVersion===undefined?"state IN ('pending','sending')":"state='pending' AND version=?"}`).bind(state,reason,messageId??null,now,id,...(pendingVersion===undefined?[]:[pendingVersion])).run()}
/** The sending claim precedes message admission and mail. A lost process never
 * repeats the attempt; a committed message or provider record can be reconciled. */
async function sendScheduledReply(env:Env,row:any,now:number,refresh:Set<string>){
 // Each reply gets its own quantum. Recovery uses the phase database so even a
 // reply that exhausts its quantum can still record an uncertain send.
 const recovery=env,budget=boundedDatabase(env.DB,155)
 env={...env,DB:budget.database}
 let attempted=false,messageId:string|undefined
 try{
  await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'schedules',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='schedules' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(row.project_id).run()
  const access=await memberAccess(env.DB,row.project_id,row.sender_id)
  if(!access?.permissions.has('conversations.reply')){await settle(env,row.id,'cancelled','The sender no longer has permission to reply',now,undefined,row.version);return}
  // Set this before awaiting the claim: even a failed response can conceal a
  // committed sending claim, which must never be admitted again automatically.
  attempted=true
  const claim=await env.DB.prepare(`UPDATE workflow_schedules SET state='sending',attempted_at=?,updated_at=?,version=version+1 WHERE id=? AND state='pending' AND version=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=workflow_schedules.conversation_id AND c.project_id=workflow_schedules.project_id AND c.revision=workflow_schedules.expected_revision AND c.last_message_id IS workflow_schedules.expected_last_message_id AND c.assigned_to IS workflow_schedules.expected_assignee AND c.group_id IS workflow_schedules.expected_group_id AND c.status_category NOT IN ('solved','closed') AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id))`).bind(now,now,row.id,row.version).run()
  if(!claim.meta.changes){await settle(env,row.id,'cancelled','Ticket changed before the scheduled reply',now,undefined,row.version);return}
  const actor:Actor={id:row.sender_id,projectId:row.project_id,role:row.sender_role}
  const result=await admitMessage(env,{projectId:row.project_id,conversationId:row.conversation_id,actor,localId:`schedule:${row.id}`,content:row.body,expectedRevision:row.expected_revision,expectedLastMessageId:row.expected_last_message_id,[scheduledAdmission]:{sql:liveScheduleSql,params:[row.id]}})
  if(!result.accepted){await settle(env,row.id,'cancelled',result.reason??'Message admission refused',now);return}
  messageId=String(result.message!.id)
  refresh.add(row.conversation_id)
  await applyMessageEffects(env,result.message!,actor,undefined,{workflow:false})
  const broadcasts=await Promise.all([row.conversation_id,`project:${row.project_id}`].map(key=>env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'})))
  if(broadcasts.every(response=>response.ok))await env.DB.prepare(`UPDATE conversation_outbox SET delivered_at=? WHERE message_id=? AND delivered_at IS NULL AND NOT ${openRerMailHold}`).bind(Date.now(),messageId).run()
  const deliveries=(await env.DB.prepare("SELECT state,error FROM email_deliveries WHERE id=? OR substr(id,1,?)=?").bind(`message:${messageId}:notification`,`message:${messageId}:notification:`.length,`message:${messageId}:notification:`).all<{state:string;error:string|null}>()).results
  // A held managed send is pending and resent by the outbox, never an unknown outcome.
  const held=deliveries.some(d=>d.state==='sending'&&d.error===rerMailHeld),uncertain=deliveries.some(d=>d.state==='uncertain'||d.state==='sending'&&d.error!==rerMailHeld),failed=deliveries.some(d=>d.state==='failed')
  await settle(env,row.id,uncertain?'uncertain':failed?'failed':'sent',uncertain?'Mail delivery is uncertain; this reply will not be replayed':failed?'The reply was saved but its mail delivery failed':held?rerMailHeld:null,now,messageId)
 }catch(error){
  // Even a DB exception can hide a successful commit. No automatic replay.
  const limited=error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'
  await settle(recovery,row.id,attempted?'uncertain':'failed',attempted?(limited?'The scheduled reply reached its statement budget. Check the transcript and delivery before sending again.':messageId?'Reply saved; delivery did not settle. Check its delivery status.':'Attempt outcome unknown. Check the transcript before sending again.'):'The schedule could not be processed; automatic replay is stopped',now,messageId,attempted?undefined:row.version)
 }finally{
  await publishActivity(recovery,row.project_id,row.conversation_id,'assignment')
 }
}

export async function runWorkflowSchedules(env:Env,now=workflowNow(env),spent?:Spent){
 await env.DB.prepare("UPDATE workflow_schedules SET state='uncertain',reason='The worker stopped during a send. Check the transcript and delivery before composing a new reply.',updated_at=?,version=version+1 WHERE state='sending' AND attempted_at<=?").bind(now,now-120000).run()
 const refresh=new Set<string>()
 let processed=await wakeDueSnoozes(env,now,spent)
 try{
 while(!spent?.()){
  // Re-select after every attempt: the persisted workspace turn makes even one
  // workspace with a large backlog yield to every other due workspace.
  const row=await env.DB.prepare(`SELECT ws.* FROM workflow_schedules ws JOIN conversations c ON c.id=ws.conversation_id AND c.project_id=ws.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id LEFT JOIN workflow_queue_turns q ON q.queue='schedules' AND q.project_id=ws.project_id WHERE ws.kind='reply' AND ws.state='pending' AND ws.due_at<=? AND ${liveScheduleTicketSql} ORDER BY coalesce(q.turn,0),ws.due_at,ws.created_at,ws.project_id,ws.id LIMIT 1`).bind(now).first<any>()
  if(!row)break
  await sendScheduledReply(env,row,now,refresh)
  processed++
 }
 }finally{
  if(refresh.size){
   // These generated events only refresh SLA clocks. Capture their exact ids,
   // then refresh all this tick's replies together. New concurrent events stay pending.
   const events=(await env.DB.prepare("SELECT id FROM workflow_events WHERE state='pending' AND source='schedule' AND conversation_id IN (SELECT value FROM json_each(?)) AND coalesce(lease_until,0)<=?").bind(JSON.stringify([...refresh]),now).all<{id:number}>()).results
   await syncSlaTickets(env,[...refresh],now)
   if(events.length)await env.DB.prepare("UPDATE workflow_events SET state='complete',error=NULL,next_attempt_at=NULL WHERE state='pending' AND id IN (SELECT value FROM json_each(?)) AND coalesce(lease_until,0)<=?").bind(JSON.stringify(events.map(event=>event.id)),now).run()
  }
 }
 return {processed}
}
