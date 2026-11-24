import type {Env} from '../../platform/env'
import {workflowNow} from './clock'
import {liveSlaTicketSql,syncSlaTickets} from './sla'
import {customerSlaMessageSql} from './sla-events'
import type {Spent} from './budget'
const PAGE=40
/** A finished lap rests this long before the next, unless a policy or calendar changes first. */
export const SLA_BACKSTOP_REST=3600000
/** Workspaces whose rolling lap is due: one is mid-lap, has never run, rested a full
 * interval, or changed a policy or calendar since its last page. `rested` is the rest cutoff. */
export const slaBackstopDueSql=(rested:string)=>`SELECT p.id FROM projects p LEFT JOIN sla_scheduler_cursors k ON k.id='tickets:'||p.id
 LEFT JOIN workflow_queue_turns q ON q.queue='sla-backstop' AND q.project_id=p.id
 WHERE (EXISTS(SELECT 1 FROM sla_policies policy WHERE policy.project_id=p.id AND policy.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state state WHERE state.project_id=p.id))
 AND (k.id IS NULL OR k.after_id<>'' OR k.updated_at<=${rested}
  OR EXISTS(SELECT 1 FROM sla_policies policy WHERE policy.project_id=p.id AND policy.updated_at>k.updated_at)
  OR EXISTS(SELECT 1 FROM workflow_calendars cal WHERE cal.project_id=p.id AND cal.updated_at>k.updated_at))`
/** Only tickets that can hold a running clock are candidates: open tickets through a
 * partial index and any ticket with an open alert. A page reads at most two short
 * index ranges, so its cost follows the open queue, never the closed history. */
const page=`SELECT k.id,(${liveSlaTicketSql()} AND (${customerSlaMessageSql()} OR EXISTS(SELECT 1 FROM sla_alerts a WHERE a.project_id=c.project_id AND a.conversation_id=c.id AND a.state='open') OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id AND json_array_length(s.state_json,'$.clocks')>0)) AND (EXISTS(SELECT 1 FROM sla_policies p WHERE p.project_id=c.project_id AND p.active=1) OR EXISTS(SELECT 1 FROM ticket_sla_state s WHERE s.project_id=c.project_id AND s.conversation_id=c.id))) live
 FROM (SELECT id FROM (SELECT id FROM (SELECT id FROM conversations INDEXED BY conversations_sla_open WHERE project_id=?1 AND id>?2 AND status_category NOT IN ('solved','closed') ORDER BY id LIMIT ${PAGE})
  UNION SELECT id FROM (SELECT DISTINCT conversation_id id FROM sla_alerts INDEXED BY sla_alerts_open_ticket WHERE project_id=?1 AND conversation_id>?2 AND state='open' ORDER BY conversation_id LIMIT ${PAGE})) ORDER BY id LIMIT ${PAGE}) k
 JOIN conversations c ON c.project_id=?1 AND c.id=k.id ORDER BY k.id`
/** A slow rolling rebuild of every SLA ticket from its journal, behind the due-time
 * check: it catches what no event marks, such as a contact's plan changing policy. */
export async function runSlaBackstop(env:Env,now=workflowNow(env),spent?:Spent){
 const project=await env.DB.prepare(`${slaBackstopDueSql('?1')} ORDER BY coalesce(q.turn,0),p.id LIMIT 1`).bind(now-SLA_BACKSTOP_REST).first<{id:string}>()
 if(!project)return {processed:0}
 await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'sla-backstop',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='sla-backstop' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(project.id).run()
 const cursorId=`tickets:${project.id}`
 const cursor=await env.DB.prepare("SELECT after_id FROM sla_scheduler_cursors WHERE id=?").bind(cursorId).first<{after_id:string}>()
 const candidates=(await env.DB.prepare(page).bind(project.id,cursor?.after_id??'').all<{id:string;live:number}>()).results
 const ids=candidates.filter(row=>row.live).map(row=>row.id)
 await syncSlaTickets(env,ids,now)
 // A short page ends the lap; the empty cursor then rests until the next one is due.
 const after=candidates.length<PAGE?'':candidates[candidates.length-1].id
 await env.DB.prepare("INSERT INTO sla_scheduler_cursors(id,after_id,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET after_id=excluded.after_id,updated_at=excluded.updated_at").bind(cursorId,after,now).run()
 return {processed:ids.length}
}
