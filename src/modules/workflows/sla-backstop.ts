import type {Env} from '../../platform/env'
import {workflowNow} from './clock'
import {liveSlaTicketSql,syncSlaTickets} from './sla'
import {customerSlaMessageSql} from './sla-events'
import type {Spent} from './budget'
/** A slow rolling rebuild of every SLA ticket from its journal, behind the due-time
 * check: it catches what no event marks, such as a contact's plan changing policy. */
export async function runSlaBackstop(env:Env,now=workflowNow(env),spent?:Spent){
 const project=await env.DB.prepare(`SELECT p.id FROM projects p LEFT JOIN workflow_queue_turns q ON q.queue='sla-backstop' AND q.project_id=p.id WHERE EXISTS(SELECT 1 FROM sla_policies policy WHERE policy.project_id=p.id AND policy.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state state WHERE state.project_id=p.id) ORDER BY coalesce(q.turn,0),p.id LIMIT 1`).first<{id:string}>()
 if(!project)return {processed:0}
 await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'sla-backstop',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='sla-backstop' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(project.id).run()
 const cursorId=`tickets:${project.id}`
 const cursor=await env.DB.prepare("SELECT after_id FROM sla_scheduler_cursors WHERE id=?").bind(cursorId).first<{after_id:string}>()
 const query=`SELECT c.id FROM conversations c WHERE c.project_id=? AND c.id>? AND ${liveSlaTicketSql()} AND (${customerSlaMessageSql()} OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open') OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id AND json_array_length(s.state_json,'$.clocks')>0)) AND (c.status_category NOT IN ('solved','closed') OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open')) AND (EXISTS(SELECT 1 FROM sla_policies p WHERE p.project_id=c.project_id AND p.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id)) ORDER BY c.id LIMIT 40`
 let tickets=await env.DB.prepare(query).bind(project.id,cursor?.after_id??'').all<{id:string}>()
 if(!tickets.results.length&&cursor?.after_id)tickets=await env.DB.prepare(query).bind(project.id,'').all<{id:string}>()
 const ids=tickets.results.map(t=>t.id)
 let after=ids.length?ids[ids.length-1]:cursor?.after_id??''
 await syncSlaTickets(env,ids,now)
 if(!tickets.results.length)after=''
 // An idle minute writes nothing.
 if(after!==(cursor?.after_id??''))await env.DB.prepare("INSERT INTO sla_scheduler_cursors(id,after_id,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET after_id=excluded.after_id,updated_at=excluded.updated_at").bind(cursorId,after,now).run()
 return {processed:ids.length}
}
