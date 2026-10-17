import type {Env} from '../../platform/env'
import {workflowNow} from './clock'
import {advanceSla,slaNextCheck,type SlaState} from './sla-clocks'
import {desiredSlaAlerts,slaAlertStatements,type SlaAlertTicket} from './sla-alerts'
import {liveSlaTicketSql,syncSlaTickets} from './sla'
import type {Spent} from './budget'
const CHUNK=200
const journalFrontier=(state:string)=>`COALESCE((SELECT max(e.id) FROM workflow_events e WHERE e.project_id=${state}.project_id AND e.conversation_id=${state}.conversation_id AND e.at<=?1),0)=${state}.last_event_id`
/** A stored state is current when no journal event, policy or calendar change has
 * happened since it was saved; it then only needs time to pass. */
const dueStates=`SELECT s.project_id,s.conversation_id,s.policy_json,s.calendar_json,s.state_json,s.last_event_id,s.updated_at,s.next_check_at,s.policy_id,c.assigned_to,c.ticket_version,c.revision,
 (${liveSlaTicketSql()} AND ${journalFrontier('s')} AND EXISTS(SELECT 1 FROM sla_policies p JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE p.project_id=s.project_id AND p.id=s.policy_id AND p.active=1 AND cal.active=1 AND p.updated_at=json_extract(s.policy_json,'$.updated_at') AND cal.id=json_extract(s.calendar_json,'$.id') AND cal.updated_at=json_extract(s.calendar_json,'$.updated_at'))) current
 FROM ticket_sla_state s JOIN conversations c ON c.project_id=s.project_id AND c.id=s.conversation_id LEFT JOIN workflow_queue_turns q ON q.queue='sla-due' AND q.project_id=s.project_id
 WHERE s.next_check_at<=?1 AND s.conversation_id NOT IN (SELECT value FROM json_each(?2)) ORDER BY coalesce(q.turn,0),s.next_check_at,s.conversation_id LIMIT ${CHUNK}`
const saveStates=`UPDATE ticket_sla_state SET state_json=json_extract(u.value,'$.state'),next_check_at=json_extract(u.value,'$.next'),updated_at=?1 FROM json_each(?2) u
 WHERE ticket_sla_state.project_id=json_extract(u.value,'$.p') AND ticket_sla_state.conversation_id=json_extract(u.value,'$.c') AND ticket_sla_state.updated_at=json_extract(u.value,'$.was') AND ticket_sla_state.last_event_id=json_extract(u.value,'$.event') AND ${journalFrontier('ticket_sla_state')}`
const parkStates=`UPDATE ticket_sla_state SET next_check_at=NULL FROM json_each(?1) u WHERE ticket_sla_state.project_id=json_extract(u.value,'$.p') AND ticket_sla_state.conversation_id=json_extract(u.value,'$.c') AND ticket_sla_state.updated_at=json_extract(u.value,'$.was')`
/** The SLA check reads tickets by their next due moment through an index, so its cost
 * follows the alerts that are due, not the size of the open queue. Current states are
 * advanced and their alerts recorded in three statements per chunk; states an event or
 * a configuration change made stale are rebuilt from their journals together, and one
 * that cannot be rebuilt leaves the due queue for the rolling backstop scan. */
export async function runDueSla(env:Env,now=workflowNow(env),spent?:Spent){
 const seen:string[]=[];let recorded=0
 for(;;){
  if(spent?.())break
  const rows=(await env.DB.prepare(dueStates).bind(now,JSON.stringify(seen)).all<any>()).results
  if(!rows.length)break
  seen.push(...rows.map(row=>row.conversation_id))
  await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'sla-due',value,(SELECT coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='sla-due') FROM json_each(?) WHERE true ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(JSON.stringify([...new Set(rows.map(row=>row.project_id))])).run()
  const updates:unknown[]=[],alerts:SlaAlertTicket[]=[],stale=rows.filter(row=>!row.current)
  for(const row of rows){if(!row.current)continue
   const policy=JSON.parse(row.policy_json),calendar=JSON.parse(row.calendar_json),state=JSON.parse(row.state_json) as SlaState,key={p:row.project_id,c:row.conversation_id,event:row.last_event_id}
   advanceSla(state,policy,calendar,now)
   updates.push({...key,was:row.updated_at,state:JSON.stringify(state),next:slaNextCheck(state,policy,calendar)})
   alerts.push({p:row.project_id,c:row.conversation_id,v:row.ticket_version,r:row.revision,policy:row.policy_id,status:state.status,clocks:state.clocks,alerts:desiredSlaAlerts({project_id:row.project_id,id:row.conversation_id,assigned_to:row.assigned_to},policy,state,now)})
  }
  if(updates.length){const [saved]=await env.DB.batch([env.DB.prepare(saveStates).bind(now,JSON.stringify(updates)),...slaAlertStatements(env,alerts,now,false)]);recorded+=saved.meta.changes??0}
  if(stale.length&&!spent?.()){
   await syncSlaTickets(env,stale.map(row=>row.conversation_id),now)
   await env.DB.prepare(parkStates).bind(JSON.stringify(stale.map(row=>({p:row.project_id,c:row.conversation_id,was:row.updated_at})))).run()
  }

 }
 return {recorded}
}
