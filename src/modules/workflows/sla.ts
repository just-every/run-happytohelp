import {conversationHasMessages} from '../management/inbox-visible'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {availableTicketSql} from '../tickets/model'
import {workflowNow} from './clock'
import {calendarData,type WorkflowCalendar} from './calendars'
import {policyData,policyMatches,type SlaPolicy} from './sla-policy'
import {applySlaEvent,advanceSla,newSlaState,slaNextCheck,type SlaState} from './sla-clocks'
import {slaEvents,slaEventSources} from './sla-events'
import {desiredSlaAlerts,slaAlertStatements,type SlaAlertTicket} from './sla-alerts'

export const liveSlaTicketSql=(alias='c',requireMessages=true)=>`${availableTicketSql(alias)} ${requireMessages?'AND '+conversationHasMessages(alias):''} AND NOT EXISTS(SELECT 1 FROM move_in_conversations imported WHERE imported.project_id=${alias}.project_id AND imported.conversation_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations legacy WHERE legacy.project_id=${alias}.project_id AND legacy.conversation_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=${alias}.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
export function slaAlertData(row:any){return {...row}}
const keyJson=(rows:{project_id:string;id:string}[])=>JSON.stringify(rows.map(r=>[r.project_id,r.id]))
const keyed=(alias:string)=>`(${alias}.project_id,${alias}.conversation_id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))`
// A journal event dated after now (a clock behind its writer) is also a moment the state needs.
const future='(SELECT min(e.at) FROM workflow_events e WHERE e.project_id=c.project_id AND e.conversation_id=c.id AND e.at>?1)'
const saveStates=`INSERT INTO ticket_sla_state(project_id,conversation_id,policy_id,policy_json,calendar_json,last_event_id,state_json,next_check_at,updated_at)
 SELECT c.project_id,c.id,json_extract(u.value,'$.policy'),json_extract(u.value,'$.policy_json'),json_extract(u.value,'$.calendar_json'),json_extract(u.value,'$.event'),json_extract(u.value,'$.state'),min(coalesce(json_extract(u.value,'$.next'),${future}),coalesce(${future},json_extract(u.value,'$.next'))),?1
 FROM json_each(?2) u JOIN conversations c ON c.project_id=json_extract(u.value,'$.p') AND c.id=json_extract(u.value,'$.c')
 WHERE c.ticket_version=json_extract(u.value,'$.v') AND c.revision=json_extract(u.value,'$.r') AND ${liveSlaTicketSql()} AND COALESCE((SELECT max(id) FROM workflow_events WHERE project_id=c.project_id AND conversation_id=c.id AND at<=?1),0)=json_extract(u.value,'$.event')
 AND EXISTS(SELECT 1 FROM sla_policies p JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE p.project_id=c.project_id AND p.id=json_extract(u.value,'$.policy') AND p.updated_at=json_extract(u.value,'$.policy_at') AND p.active=1 AND cal.updated_at=json_extract(u.value,'$.calendar_at') AND cal.active=1)
 ON CONFLICT(project_id,conversation_id) DO UPDATE SET policy_id=excluded.policy_id,policy_json=excluded.policy_json,calendar_json=excluded.calendar_json,last_event_id=excluded.last_event_id,state_json=excluded.state_json,next_check_at=excluded.next_check_at,updated_at=excluded.updated_at`
/** Rebuilds SLA state from the journal for any number of tickets in a fixed number of
 * statements, and records their alerts. Each save is guarded by the ticket frontier,
 * journal, policy and calendar it was computed from, so a race loses only that save. */
export async function syncSlaTickets(env:Env,ids:string[],now=workflowNow(env)){
 if(!ids.length)return
 const tickets=(await env.DB.prepare(`SELECT c.*,ct.metadata_json,COALESCE(c.request_form_id,(SELECT form_id FROM request_form_submissions r WHERE r.project_id=c.project_id AND r.conversation_id=c.id LIMIT 1)) form_id,(SELECT json_group_object(v.field_id,json(v.value_json)) FROM ticket_field_values v JOIN ticket_fields f ON f.project_id=v.project_id AND f.id=v.field_id WHERE v.project_id=c.project_id AND v.conversation_id=c.id AND json_array_length(f.read_roles_json)=0 AND json_array_length(f.write_roles_json)=0) fields_json FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id AND ct.id=c.contact_id WHERE c.id IN (SELECT value FROM json_each(?)) AND ${liveSlaTicketSql()}`).bind(JSON.stringify(ids)).all<any>()).results
 if(!tickets.length)return
 const projects=JSON.stringify([...new Set(tickets.map(t=>t.project_id))])
 const [policyRows,calendarRows]=await Promise.all([
  env.DB.prepare('SELECT p.* FROM sla_policies p JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE p.project_id IN (SELECT value FROM json_each(?)) AND p.active=1 AND cal.active=1 ORDER BY p.project_id,p.position,p.id').bind(projects).all<any>(),
  env.DB.prepare('SELECT * FROM workflow_calendars WHERE project_id IN (SELECT value FROM json_each(?))').bind(projects).all<any>()
 ])
 const policies=policyRows.results.map(policyData),calendars=new Map(calendarRows.results.map(row=>[`${row.project_id}\n${row.id}`,calendarData(row)]))
 const matched:{ticket:any;policy:SlaPolicy;calendar:WorkflowCalendar}[]=[],unmatched:any[]=[]
 for(const ticket of tickets){const policy=policies.find(p=>p.project_id===ticket.project_id&&policyMatches(p,{...ticket,fields:JSON.parse(ticket.fields_json)},JSON.parse(ticket.metadata_json)));if(policy)matched.push({ticket,policy,calendar:calendars.get(`${policy.project_id}\n${policy.calendar_id}`)!});else unmatched.push(ticket)}
 const statements:D1PreparedStatement[]=[]
 if(unmatched.length)statements.push(
  env.DB.prepare(`DELETE FROM ticket_sla_state WHERE ${keyed('ticket_sla_state')}`).bind(keyJson(unmatched)),
  env.DB.prepare(`UPDATE sla_alerts SET state='resolved',resolved_at=? WHERE ${keyed('sla_alerts')} AND state='open'`).bind(now,keyJson(unmatched)))
 if(matched.length){
  const sources=await slaEventSources(env,matched.map(m=>m.ticket),now),saves:unknown[]=[],alerts:SlaAlertTicket[]=[]
  for(const {ticket,policy,calendar} of matched){
   const state=newSlaState(ticket.created_at)
   let lastEventId=0
   for(const event of slaEvents(ticket,sources.get(ticket.id)!,now)){applySlaEvent(state,policy,calendar,event);lastEventId=Math.max(lastEventId,event.id)}
   advanceSla(state,policy,calendar,now)
   const key={p:ticket.project_id,c:ticket.id,v:ticket.ticket_version,r:ticket.revision,policy:policy.id}
   saves.push({...key,policy_json:JSON.stringify(policy),calendar_json:JSON.stringify(calendar),event:lastEventId,state:JSON.stringify(state),next:slaNextCheck(state,policy,calendar),policy_at:policy.updated_at,calendar_at:calendar.updated_at})
   alerts.push({...key,status:state.status,clocks:state.clocks,alerts:desiredSlaAlerts(ticket,policy,state,now)})
  }
  statements.push(env.DB.prepare(saveStates).bind(now,JSON.stringify(saves)),...slaAlertStatements(env,alerts,now))
 }
 await env.DB.batch(statements)
}
export async function ticketSla(env:Env,projectId:string,id:string){
 const ticket=await env.DB.prepare(`SELECT c.id FROM conversations c WHERE c.project_id=? AND c.id=? AND ${liveSlaTicketSql('c',false)}`).bind(projectId,id).first()
 if(!ticket)throw new HTTPException(404)
 await syncSlaTickets(env,[id])
 const [row,alerts]=await Promise.all([
  env.DB.prepare('SELECT * FROM ticket_sla_state WHERE project_id=? AND conversation_id=?').bind(projectId,id).first<any>(),
  env.DB.prepare('SELECT * FROM sla_alerts WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC,id').bind(projectId,id).all<any>()
 ])
 if(!row)return {policy:null,calendar:null,pause_reason:null,clocks:[],alerts:alerts.results.map(slaAlertData)}
 const state=JSON.parse(row.state_json) as SlaState
 return {policy:JSON.parse(row.policy_json) as SlaPolicy,calendar:JSON.parse(row.calendar_json) as WorkflowCalendar,pause_reason:state.pause_reason,clocks:state.clocks.map(({spent_ms,target_ms,breached_at,...clock})=>clock),last_event_id:row.last_event_id,updated_at:row.updated_at,alerts:alerts.results.map(slaAlertData)}
}
