import type {Env} from '../../platform/env'
import {workflowNow} from './clock'
import {dueTimeRule,timeRuleCursor} from './time-rule-due'
import {slaBackstopDueSql,SLA_BACKSTOP_REST} from './sla-backstop-due'

/** Check the inputs of the entire workflow pass: SLA work joins it only when a stored
 * clock is due or a workspace's backstop lap is, never merely because SLA is on. Once admitted, its phases
 * still run in order because one phase can produce work for another. */
export const workflowScopeSql=`CASE WHEN EXISTS(SELECT 1 FROM ticket_sla_state INDEXED BY ticket_sla_state_due WHERE next_check_at<=?1)
  OR EXISTS(${slaBackstopDueSql('?5')})
  OR EXISTS(SELECT 1 FROM sla_alerts WHERE notification_state='sending' AND notification_started_at<?2
   OR notification_state='pending' AND coalesce(notification_next_attempt_at,0)<=?1)
  OR EXISTS(SELECT 1 FROM sla_alerts WHERE slack_state='sending' AND slack_started_at<?2
   OR slack_state='pending' AND coalesce(slack_next_attempt_at,0)<=?1)
  OR EXISTS(SELECT 1 FROM workflow_events WHERE state='pending' AND coalesce(next_attempt_at,0)<=?1 AND coalesce(lease_until,0)<=?1)
  OR EXISTS(SELECT 1 FROM workflow_runs INDEXED BY workflow_runs_active_due WHERE state IN ('running','pending') AND coalesce(next_attempt_at,0)<=?1 AND coalesce(lease_until,0)<=?1)
  OR EXISTS(SELECT 1 FROM workflow_schedules s WHERE state='sending' AND attempted_at<=?3 OR state='pending' AND
   (due_at<=?1 OR kind='snooze' AND EXISTS(SELECT 1 FROM conversations d WHERE d.id=s.dependency_id AND d.project_id=s.project_id AND d.status_category IN ('solved','closed'))))
  THEN 'all' WHEN EXISTS(SELECT 1 FROM workflow_rules r ${timeRuleCursor} WHERE ${dueTimeRule('?4')}) THEN 'time' END`
export const workflowDueBindings=(now:number)=>[now,now-3600000,now-120000,Math.floor(now/3600000),now-SLA_BACKSTOP_REST]

export async function scheduledWorkflowWork(env:Env){
 const row=await env.DB.prepare(`SELECT ${workflowScopeSql} AS scope`).bind(...workflowDueBindings(workflowNow(env))).first<{scope:'all'|'time'|null}>()
 return row?.scope
}
