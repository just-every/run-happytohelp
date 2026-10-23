import type {Env} from '../../platform/env'
import {availableTicketSql} from '../tickets/model'
import {notifyWorkflow} from './notify'
import type {SlaPolicy} from './sla-policy'
import type {SlaState} from './sla-clocks'
import {customerSlaMessageSql} from './sla-events'
import type {Spent} from './budget'
import {boundedDatabase} from '../../platform/d1-budget'

const activeProject=`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM move_in_conversations imported WHERE imported.project_id=c.project_id AND imported.conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations legacy WHERE legacy.project_id=c.project_id AND legacy.conversation_id=c.id)`
const deliveryEligible=`${activeProject} AND ${customerSlaMessageSql()}`
export type DesiredSlaAlert={id:string;metric:string;cycle:number;kind:string;recipient:string|null;resolved_at:number|null}
export function desiredSlaAlerts(ticket:{project_id:string;id:string;assigned_to?:string|null},policy:SlaPolicy,state:SlaState,now:number){
 const desired:DesiredSlaAlert[]=[]
 for(const clock of state.clocks){
  if(clock.metric==='unattended'&&!clock.breached)continue
  const resolved=clock.completed_at!==null||['solved','closed'].includes(state.status)
  const kind=clock.metric==='unattended'?'unattended':clock.breached?'breach':!resolved&&!state.pause_reason&&clock.remaining_minutes<=policy.approaching_minutes?'approaching':null
  if(!kind)continue
  const recipients=[...new Set<string|null>([ticket.assigned_to??null,...policy.backup_user_ids])]
  for(const recipient of recipients)desired.push({id:JSON.stringify(['sla',ticket.project_id,ticket.id,policy.id,clock.metric,clock.cycle,kind,recipient]),metric:clock.metric,cycle:clock.cycle,kind,recipient,resolved_at:resolved?clock.completed_at??now:null})
 }
 return desired
}
/** One saved SLA state: its ticket frontier, the policy it was saved under and its clocks. */
export type SlaAlertTicket={p:string;c:string;v:number;r:number;policy:string;status:string;clocks:SlaState['clocks'];alerts:DesiredSlaAlert[]}
const savedFrontier=`EXISTS(SELECT 1 FROM conversations c JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id WHERE c.project_id=json_extract(t.value,'$.p') AND c.id=json_extract(t.value,'$.c') AND c.ticket_version=json_extract(t.value,'$.v') AND c.revision=json_extract(t.value,'$.r') AND s.policy_id=json_extract(t.value,'$.policy') AND s.updated_at=?1 AND ${availableTicketSql()} AND ${activeProject})`
/** Alerts follow the state saved at `now`: two statements for any number of tickets,
 * clocks or backups. A ticket whose save lost a race keeps its alerts unchanged. */
export function slaAlertStatements(env:Env,tickets:SlaAlertTicket[],now:number,resolve=true){
 const json=JSON.stringify(tickets),clock="json_each(t.value,'$.clocks') clock WHERE json_extract(clock.value,'$.metric')=sla_alerts.metric AND json_extract(clock.value,'$.cycle')=sla_alerts.cycle"
 return [
  ...(resolve?[env.DB.prepare(`UPDATE sla_alerts SET state='resolved',resolved_at=COALESCE(resolved_at,(SELECT json_extract(clock.value,'$.completed_at') FROM ${clock} LIMIT 1),?1) FROM json_each(?2) t WHERE sla_alerts.project_id=json_extract(t.value,'$.p') AND sla_alerts.conversation_id=json_extract(t.value,'$.c') AND sla_alerts.state<>'resolved' AND (sla_alerts.policy_id<>json_extract(t.value,'$.policy') OR json_extract(t.value,'$.status') IN ('solved','closed') OR NOT EXISTS(SELECT 1 FROM ${clock} AND json_extract(clock.value,'$.completed_at') IS NULL)) AND ${savedFrontier}`).bind(now,json)]:[]),
  env.DB.prepare(`INSERT OR IGNORE INTO sla_alerts(id,project_id,conversation_id,policy_id,metric,cycle,kind,recipient_id,state,created_at,resolved_at,notification_state) SELECT json_extract(a.value,'$.id'),json_extract(t.value,'$.p'),json_extract(t.value,'$.c'),json_extract(t.value,'$.policy'),json_extract(a.value,'$.metric'),json_extract(a.value,'$.cycle'),json_extract(a.value,'$.kind'),json_extract(a.value,'$.recipient'),CASE WHEN json_extract(a.value,'$.resolved_at') IS NULL THEN 'open' ELSE 'resolved' END,?1,json_extract(a.value,'$.resolved_at'),CASE WHEN json_extract(a.value,'$.resolved_at') IS NOT NULL OR json_extract(a.value,'$.recipient') IS NULL THEN 'complete' ELSE 'pending' END FROM json_each(?2) t,json_each(t.value,'$.alerts') a WHERE ${savedFrontier}`).bind(now,json)
 ]
}
export async function deliverSlaAlerts(env:Env,now:number,spent?:Spent){
 // One notice owns this quantum; reserve three statements for an uncertain outcome.
 const recovery=env,budget=boundedDatabase(env.DB,42)
 env={...env,DB:budget.database}
 let current:any,attempted=false
 const delays=[1,5,15,60]
 try{
 // A previous claim can have crossed the provider boundary before a restart.
 // Its outcome remains inspectable and is never automatically sent again.
 await env.DB.prepare("UPDATE sla_alerts SET notification_state='uncertain',notification_next_attempt_at=NULL,notification_error='Delivery was interrupted; reconcile before any further send' WHERE notification_state='sending' AND notification_started_at<?").bind(now-3600000).run()
 const query="SELECT * FROM (SELECT a.*,coalesce(q.turn,0) served,row_number() OVER (PARTITION BY a.project_id ORDER BY coalesce(a.notification_next_attempt_at,a.created_at),a.id) workspace_turn FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id LEFT JOIN workflow_queue_turns q ON q.queue='sla-notices' AND q.project_id=a.project_id WHERE a.notification_state='pending' AND coalesce(a.notification_next_attempt_at,0)<=? AND a.state='open' AND c.status_category NOT IN ('solved','closed') AND "+availableTicketSql()+' AND '+deliveryEligible+') WHERE workspace_turn=1 ORDER BY served,coalesce(notification_next_attempt_at,created_at),project_id,id LIMIT 1'
 const pending=await env.DB.prepare(query).bind(now).all<any>()
 for(const alert of pending.results){
  if(spent?.())break
  current=alert;attempted=false
  await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'sla-notices',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='sla-notices' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(alert.project_id).run()
  if(alert.notification_attempts>=5){await env.DB.prepare("UPDATE sla_alerts SET notification_state='not_delivered',notification_next_attempt_at=NULL,notification_error='Notification stopped after 5 attempts' WHERE id=? AND notification_state='pending'").bind(alert.id).run();continue}
  const claimed=await env.DB.prepare(`UPDATE sla_alerts SET notification_state='sending',notification_started_at=?,notification_attempts=notification_attempts+1,notification_next_attempt_at=NULL WHERE id=? AND state='open' AND notification_state='pending' AND notification_attempts<5 AND coalesce(notification_next_attempt_at,0)<=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=sla_alerts.project_id AND c.id=sla_alerts.conversation_id AND c.status_category NOT IN ('solved','closed') AND ${availableTicketSql()} AND ${deliveryEligible})`).bind(now,alert.id,now).run()
  if(!claimed.meta.changes)continue
  attempted=true
  try{
   const result=await notifyWorkflow(env,{projectId:alert.project_id,conversationId:alert.conversation_id,id:alert.id,kind:`sla_${alert.kind}`,recipientId:alert.recipient_id??undefined,message:`${alert.metric.replaceAll('_',' ')} SLA ${alert.kind}`,guard:{sql:`c.status_category NOT IN ('solved','closed') AND ${deliveryEligible} AND EXISTS(SELECT 1 FROM sla_alerts a JOIN sla_policies p ON p.project_id=a.project_id AND p.id=a.policy_id JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE a.id=? AND a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open' AND a.notification_state='sending' AND p.active=1 AND cal.active=1)`,params:[alert.id]}})
   const attempt=Number(alert.notification_attempts)+1,pendingAgain=result.state==='pending'&&attempt<5,outcome=result.state==='cancelled'?'complete':result.state==='pending'&&!pendingAgain?'not_delivered':result.state
   if(result.state==='pending'&&!pendingAgain)await env.DB.prepare("UPDATE workflow_notifications SET state='not_delivered',detail='Notification stopped after 5 attempts',updated_at=? WHERE id=? AND state='pending'").bind(now,alert.id).run()
   const detail=result.state==='pending'&&!pendingAgain?`${result.detail??'Notification delivery is waiting'}. Stopped after 5 attempts.`:result.detail
   await env.DB.prepare("UPDATE sla_alerts SET notification_state=?,notification_next_attempt_at=?,notification_error=? WHERE id=? AND notification_state='sending'").bind(outcome,pendingAgain?now+delays[attempt-1]*60000:null,detail?JSON.stringify(detail).slice(0,2000):null,alert.id).run()
  }catch(error){
   await recovery.DB.prepare("UPDATE sla_alerts SET notification_state='uncertain',notification_next_attempt_at=NULL,notification_error=? WHERE id=? AND notification_state='sending'").bind(error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'?'Delivery reached its statement budget; reconcile before any further send':'Delivery outcome unknown; reconcile before any further send',alert.id).run()
   return
  }
 }
 }catch(error){
  if(current)await recovery.DB.prepare("UPDATE sla_alerts SET notification_state=?,notification_next_attempt_at=NULL,notification_error=? WHERE id=? AND notification_state IN ('pending','sending')").bind(attempted?'uncertain':'failed',error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'?'Notification exceeded its statement budget; automatic replay is stopped':attempted?'Delivery outcome unknown; reconcile before any further send':'Notification processing failed; automatic replay is stopped',current.id).run()
  else console.error('SLA notification selection failed')
 }
}
