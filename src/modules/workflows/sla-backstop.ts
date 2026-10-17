import type {Env} from '../../platform/env'
import {workflowNow} from './clock'
import {liveSlaTicketSql,syncSlaTickets} from './sla'
import {customerSlaMessageSql} from './sla-events'
import type {Spent} from './budget'
/** A slow rolling rebuild of every SLA ticket from its journal, behind the due-time
 * check: it catches what no event marks, such as a contact's plan changing policy. */
export async function runSlaBackstop(env:Env,now=workflowNow(env),spent?:Spent){
 const cursor=await env.DB.prepare("SELECT after_id FROM sla_scheduler_cursors WHERE id='tickets'").first<{after_id:string}>()
 const query=`SELECT c.id FROM conversations c WHERE c.id>? AND ${liveSlaTicketSql()} AND (${customerSlaMessageSql()} OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open') OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id AND json_array_length(s.state_json,'$.clocks')>0)) AND (c.status_category NOT IN ('solved','closed') OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open')) AND (EXISTS(SELECT 1 FROM sla_policies p WHERE p.project_id=c.project_id AND p.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id)) ORDER BY c.id LIMIT 40`
 let tickets=await env.DB.prepare(query).bind(cursor?.after_id??'').all<{id:string}>()
 if(!tickets.results.length&&cursor?.after_id)tickets=await env.DB.prepare(query).bind('').all<{id:string}>()
 const ids=spent?.()?[]:tickets.results.map(t=>t.id)
 let after=ids.length?ids[ids.length-1]:cursor?.after_id??''
 await syncSlaTickets(env,ids,now)
 if(!tickets.results.length)after=''
 // An idle minute writes nothing.
 if(after!==(cursor?.after_id??''))await env.DB.prepare("INSERT INTO sla_scheduler_cursors(id,after_id,updated_at) VALUES('tickets',?,?) ON CONFLICT(id) DO UPDATE SET after_id=excluded.after_id,updated_at=excluded.updated_at").bind(after,now).run()
 return {processed:ids.length}
}
