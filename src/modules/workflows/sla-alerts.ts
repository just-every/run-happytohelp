import type {Env} from '../../platform/env'
import {availableTicketSql} from '../tickets/model'
import {notifyWorkflow} from './notify'
import type {SlaPolicy} from './sla-policy'
import type {SlaState} from './sla-clocks'
import {customerSlaMessageSql} from './sla-events'
import type {Spent} from './budget'

const activeProject=`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM move_in_conversations imported WHERE imported.project_id=c.project_id AND imported.conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations legacy WHERE legacy.project_id=c.project_id AND legacy.conversation_id=c.id)`
const deliveryEligible=`${activeProject} AND ${customerSlaMessageSql()}`
export async function syncSlaAlerts(env:Env,ticket:any,policy:SlaPolicy,state:SlaState,now:number){
 const desired:Array<{id:string;metric:string;cycle:number;kind:string;recipient:string|null;resolved_at:number|null}>=[]
 for(const clock of state.clocks){
  if(clock.metric==='unattended'&&!clock.breached)continue
  const resolved=clock.completed_at!==null||['solved','closed'].includes(state.status)
  const kind=clock.metric==='unattended'?'unattended':clock.breached?'breach':!resolved&&!state.pause_reason&&clock.remaining_minutes<=policy.approaching_minutes?'approaching':null
  if(!kind)continue
  const recipients=kind==='approaching'?[ticket.assigned_to??null]:[...new Set<string|null>([ticket.assigned_to??null,...policy.backup_user_ids])]
  for(const recipient of recipients)desired.push({id:JSON.stringify(['sla',ticket.project_id,ticket.id,policy.id,clock.metric,clock.cycle,kind,recipient]),metric:clock.metric,cycle:clock.cycle,kind,recipient,resolved_at:resolved?clock.completed_at??now:null})
 }
 const frontier=`SELECT 1 FROM conversations c JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND s.policy_id=? AND s.updated_at=? AND ${availableTicketSql()} AND ${activeProject}`
 const frontierArgs=[ticket.project_id,ticket.id,ticket.ticket_version,ticket.revision,policy.id,now]
 const clocks=JSON.stringify(state.clocks)
 // Two statements regardless of the number of historical clocks or backups.
 await env.DB.batch([
  env.DB.prepare(`UPDATE sla_alerts SET state='resolved',resolved_at=COALESCE(resolved_at,(SELECT json_extract(clock.value,'$.completed_at') FROM json_each(?) clock WHERE json_extract(clock.value,'$.metric')=sla_alerts.metric AND json_extract(clock.value,'$.cycle')=sla_alerts.cycle LIMIT 1),?) WHERE project_id=? AND conversation_id=? AND state<>'resolved' AND (policy_id<>? OR ? IN ('solved','closed') OR NOT EXISTS(SELECT 1 FROM json_each(?) clock WHERE json_extract(clock.value,'$.metric')=sla_alerts.metric AND json_extract(clock.value,'$.cycle')=sla_alerts.cycle AND json_extract(clock.value,'$.completed_at') IS NULL)) AND EXISTS(${frontier})`).bind(clocks,now,ticket.project_id,ticket.id,policy.id,state.status,clocks,...frontierArgs),
  env.DB.prepare(`INSERT OR IGNORE INTO sla_alerts(id,project_id,conversation_id,policy_id,metric,cycle,kind,recipient_id,state,created_at,resolved_at,notification_state) SELECT json_extract(a.value,'$.id'),?,?,?,json_extract(a.value,'$.metric'),json_extract(a.value,'$.cycle'),json_extract(a.value,'$.kind'),json_extract(a.value,'$.recipient'),CASE WHEN json_extract(a.value,'$.resolved_at') IS NULL THEN 'open' ELSE 'resolved' END,?,json_extract(a.value,'$.resolved_at'),CASE WHEN json_extract(a.value,'$.resolved_at') IS NOT NULL OR json_extract(a.value,'$.recipient') IS NULL THEN 'complete' ELSE 'pending' END FROM json_each(?) a WHERE EXISTS(${frontier})`).bind(ticket.project_id,ticket.id,policy.id,now,JSON.stringify(desired),...frontierArgs)
 ])
}
export async function deliverSlaAlerts(env:Env,now:number,spent?:Spent){
 // A previous claim can have crossed the provider boundary before a restart.
 // Its outcome remains inspectable and is never automatically sent again.
 await env.DB.prepare("UPDATE sla_alerts SET notification_state='uncertain',notification_error='Delivery was interrupted; reconcile before any further send' WHERE notification_state='sending' AND notification_started_at<?").bind(now-3600000).run()
 const cursor=await env.DB.prepare("SELECT after_id FROM sla_scheduler_cursors WHERE id='notifications'").first<{after_id:string}>()
 const query="SELECT a.* FROM sla_alerts a JOIN conversations c ON c.project_id=a.project_id AND c.id=a.conversation_id WHERE a.id>? AND a.notification_state='pending' AND a.state='open' AND c.status_category NOT IN ('solved','closed') AND "+availableTicketSql()+' AND '+deliveryEligible+' ORDER BY a.id LIMIT 40'
 let pending=await env.DB.prepare(query).bind(cursor?.after_id??'').all<any>()
 if(!pending.results.length&&cursor?.after_id)pending=await env.DB.prepare(query).bind('').all<any>()
 let after=cursor?.after_id??''
 for(const alert of pending.results){
  if(spent?.())break
  after=alert.id
  const claimed=await env.DB.prepare(`UPDATE sla_alerts SET notification_state='sending',notification_started_at=? WHERE id=? AND state='open' AND notification_state='pending' AND EXISTS(SELECT 1 FROM conversations c WHERE c.project_id=sla_alerts.project_id AND c.id=sla_alerts.conversation_id AND c.status_category NOT IN ('solved','closed') AND ${availableTicketSql()} AND ${deliveryEligible})`).bind(now,alert.id).run()
  if(!claimed.meta.changes)continue
  try{
   const result=await notifyWorkflow(env,{projectId:alert.project_id,conversationId:alert.conversation_id,id:alert.id,kind:`sla_${alert.kind}`,recipientId:alert.recipient_id??undefined,message:`${alert.metric.replaceAll('_',' ')} SLA ${alert.kind}`,guard:{sql:`c.status_category NOT IN ('solved','closed') AND ${deliveryEligible} AND EXISTS(SELECT 1 FROM sla_alerts a JOIN sla_policies p ON p.project_id=a.project_id AND p.id=a.policy_id JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE a.id=? AND a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open' AND a.notification_state='sending' AND p.active=1 AND cal.active=1)`,params:[alert.id]}})
   const outcome=result.state==='cancelled'?'complete':result.state
   await env.DB.prepare("UPDATE sla_alerts SET notification_state=?,notification_error=? WHERE id=? AND notification_state='sending'").bind(outcome,result.detail?JSON.stringify(result.detail).slice(0,2000):null,alert.id).run()
  }catch{
   await env.DB.prepare("UPDATE sla_alerts SET notification_state='uncertain',notification_error='Delivery outcome unknown; reconcile before any further send' WHERE id=? AND notification_state='sending'").bind(alert.id).run()
  }
 }
 if(!pending.results.length)after=''
 if(after!==(cursor?.after_id??''))await env.DB.prepare("INSERT INTO sla_scheduler_cursors(id,after_id,updated_at) VALUES('notifications',?,?) ON CONFLICT(id) DO UPDATE SET after_id=excluded.after_id,updated_at=excluded.updated_at").bind(after,now).run()
}
