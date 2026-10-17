import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {availableTicketSql} from '../tickets/model'
import {workflowNow} from './clock'
import {calendarData,type WorkflowCalendar} from './calendars'
import {policyData,policyMatches,type SlaPolicy} from './sla-policy'
import {applySlaEvent,advanceSla,newSlaState,type SlaState} from './sla-clocks'
import {slaEvents,customerSlaMessageSql} from './sla-events'
import {syncSlaAlerts,deliverSlaAlerts} from './sla-alerts'

export const liveSlaTicketSql=(alias='c')=>`${availableTicketSql(alias)} AND NOT EXISTS(SELECT 1 FROM move_in_conversations imported WHERE imported.project_id=${alias}.project_id AND imported.conversation_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM reporting_legacy_conversations legacy WHERE legacy.project_id=${alias}.project_id AND legacy.conversation_id=${alias}.id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=${alias}.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
export function slaAlertData(row:any){return {...row}}
export async function syncTicketSla(env:Env,ticketId:string,now=workflowNow(env)){
 const ticket=await env.DB.prepare(`SELECT c.*,ct.metadata_json FROM conversations c JOIN contacts ct ON ct.project_id=c.project_id AND ct.id=c.contact_id WHERE c.id=? AND ${liveSlaTicketSql()}`).bind(ticketId).first<any>()
 if(!ticket)return null
 const policies=await env.DB.prepare('SELECT p.* FROM sla_policies p JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE p.project_id=? AND p.active=1 AND cal.active=1 ORDER BY p.position,p.id').bind(ticket.project_id).all<any>()
 const policy=policies.results.map(policyData).find(p=>policyMatches(p,ticket,JSON.parse(ticket.metadata_json)))
 if(!policy){
  await env.DB.batch([
   env.DB.prepare('DELETE FROM ticket_sla_state WHERE project_id=? AND conversation_id=?').bind(ticket.project_id,ticketId),
   env.DB.prepare("UPDATE sla_alerts SET state='resolved',resolved_at=? WHERE project_id=? AND conversation_id=? AND state='open'").bind(now,ticket.project_id,ticketId)
  ])
  return null
 }
 const calendar=calendarData(await env.DB.prepare('SELECT * FROM workflow_calendars WHERE project_id=? AND id=?').bind(ticket.project_id,policy.calendar_id).first<any>())
 const events=await slaEvents(env,ticket,now),state=newSlaState(ticket.created_at)
 let lastEventId=0
 for(const event of events){applySlaEvent(state,policy,calendar,event);lastEventId=Math.max(lastEventId,event.id)}
 advanceSla(state,policy,calendar,now)
 const serialized=JSON.stringify(state)
 const saved=await env.DB.prepare(`INSERT INTO ticket_sla_state(project_id,conversation_id,policy_id,policy_json,calendar_json,last_event_id,state_json,updated_at) SELECT c.project_id,c.id,?,?,?,?,?,? FROM conversations c WHERE c.project_id=? AND c.id=? AND c.ticket_version=? AND c.revision=? AND ${liveSlaTicketSql()} AND COALESCE((SELECT max(id) FROM workflow_events WHERE project_id=c.project_id AND conversation_id=c.id AND at<=?),0)=? AND EXISTS(SELECT 1 FROM sla_policies p JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id WHERE p.project_id=c.project_id AND p.id=? AND p.updated_at=? AND p.active=1 AND cal.updated_at=? AND cal.active=1) ON CONFLICT(project_id,conversation_id) DO UPDATE SET policy_id=excluded.policy_id,policy_json=excluded.policy_json,calendar_json=excluded.calendar_json,last_event_id=excluded.last_event_id,state_json=excluded.state_json,updated_at=excluded.updated_at`).bind(policy.id,JSON.stringify(policy),JSON.stringify(calendar),lastEventId,serialized,now,ticket.project_id,ticketId,ticket.ticket_version,ticket.revision,now,lastEventId,policy.id,policy.updated_at,calendar.updated_at).run()
 if(!saved.meta.changes)return null
 await syncSlaAlerts(env,ticket,policy,state,now)
 return {policy,calendar,...state}
}
export async function ticketSla(env:Env,projectId:string,id:string){
 const ticket=await env.DB.prepare(`SELECT c.id FROM conversations c WHERE c.project_id=? AND c.id=? AND ${liveSlaTicketSql()}`).bind(projectId,id).first()
 if(!ticket)throw new HTTPException(404)
 await syncTicketSla(env,id)
 const [row,alerts]=await Promise.all([
  env.DB.prepare('SELECT * FROM ticket_sla_state WHERE project_id=? AND conversation_id=?').bind(projectId,id).first<any>(),
  env.DB.prepare('SELECT * FROM sla_alerts WHERE project_id=? AND conversation_id=? ORDER BY created_at DESC,id').bind(projectId,id).all<any>()
 ])
 if(!row)return {policy:null,calendar:null,pause_reason:null,clocks:[],alerts:alerts.results.map(slaAlertData)}
 const state=JSON.parse(row.state_json) as SlaState
 return {policy:JSON.parse(row.policy_json) as SlaPolicy,calendar:JSON.parse(row.calendar_json) as WorkflowCalendar,pause_reason:state.pause_reason,clocks:state.clocks.map(({spent_ms,target_ms,breached_at,...clock})=>clock),last_event_id:row.last_event_id,updated_at:row.updated_at,alerts:alerts.results.map(slaAlertData)}
}
export async function runSlaAlerts(env:Env,now=workflowNow(env)){
 const cursor=await env.DB.prepare("SELECT after_id FROM sla_scheduler_cursors WHERE id='tickets'").first<{after_id:string}>()
 const query=`SELECT c.id FROM conversations c WHERE c.id>? AND ${liveSlaTicketSql()} AND (${customerSlaMessageSql()} OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open') OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id AND json_array_length(s.state_json,'$.clocks')>0)) AND (c.status_category NOT IN ('solved','closed') OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open')) AND (EXISTS(SELECT 1 FROM sla_policies p WHERE p.project_id=c.project_id AND p.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id)) ORDER BY c.id LIMIT 40`
 let tickets=await env.DB.prepare(query).bind(cursor?.after_id??'').all<{id:string}>()
 if(!tickets.results.length&&cursor?.after_id)tickets=await env.DB.prepare(query).bind('').all<{id:string}>()
 const failed:string[]=[]
 for(const ticket of tickets.results){try{await syncTicketSla(env,ticket.id,now)}catch{failed.push(ticket.id)}}
 const after=tickets.results.at(-1)?.id??''
 await env.DB.prepare("INSERT INTO sla_scheduler_cursors(id,after_id,updated_at) VALUES('tickets',?,?) ON CONFLICT(id) DO UPDATE SET after_id=excluded.after_id,updated_at=excluded.updated_at").bind(after,now).run()
 await deliverSlaAlerts(env,now)
 if(failed.length)throw new Error(`SLA refresh failed for tickets: ${failed.join(', ')}`)
 return {processed:tickets.results.length}
}
