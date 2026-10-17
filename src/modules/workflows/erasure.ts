import type {Env} from '../../platform/env'

/** Erasure removes the workflow rows keyed to the contact's own tickets, matched by
 * id: journal events, follow-up links, SLA state and alerts, runs, receipts, notices,
 * time-rule state, routing decisions and schedules. Rules, policies, calendars and
 * operators belong to the workspace, and other customers' tickets keep their history;
 * no row is ever chosen by searching text for the contact's name, email or id. */
const owned='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
const linked=`project_id=?1 AND conversation_id IN (${owned})`
const tables=[
 ['workflow_events',linked],
 ['ticket_followups',`project_id=?1 AND (original_id IN (${owned}) OR conversation_id IN (${owned}))`],
 ['sla_alerts',linked],['ticket_sla_state',linked],['workflow_runs',linked],['workflow_action_receipts',linked],
 ['workflow_notifications',linked],['workflow_time_state',linked],['routing_decisions',linked],['workflow_schedules',linked],
] as const

/** Included in the existing erasure receipt's ticket_records before any delete. */
export const workflowErasureCount=`(SELECT ${tables.map(([table,where])=>`(SELECT count(*) FROM ${table} WHERE ${where})`).join('+')})`
export function workflowErasureStatements(env:Env,projectId:string,contactId:string){
 return tables.map(([table,where])=>env.DB.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(projectId,contactId))
}
