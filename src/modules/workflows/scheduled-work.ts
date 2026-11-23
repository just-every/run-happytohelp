import type {Env} from '../../platform/env'
import {workflowNow} from './clock'
import {dueTimeRule,timeRuleCursor} from './time-rules'

/** Check the inputs of the entire workflow pass. Once admitted, its phases
 * still run in order because one phase can produce work for another. */
export async function scheduledWorkflowWork(env:Env){
 const now=workflowNow(env)
 const row=await env.DB.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM ticket_sla_state)
  OR EXISTS(SELECT 1 FROM sla_policies WHERE active=1)
  OR EXISTS(SELECT 1 FROM sla_alerts WHERE notification_state='sending' AND notification_started_at<?2
   OR notification_state='pending' AND coalesce(notification_next_attempt_at,0)<=?1)
  OR EXISTS(SELECT 1 FROM sla_alerts WHERE slack_state='sending' AND slack_started_at<?2
   OR slack_state='pending' AND coalesce(slack_next_attempt_at,0)<=?1)
  OR EXISTS(SELECT 1 FROM workflow_events WHERE state='pending' AND coalesce(next_attempt_at,0)<=?1 AND coalesce(lease_until,0)<=?1)
  OR EXISTS(SELECT 1 FROM workflow_runs INDEXED BY workflow_runs_active_due WHERE state IN ('running','pending') AND coalesce(next_attempt_at,0)<=?1 AND coalesce(lease_until,0)<=?1)
  OR EXISTS(SELECT 1 FROM workflow_schedules WHERE state='pending' OR state='sending' AND attempted_at<=?3)
  THEN 'all' WHEN EXISTS(SELECT 1 FROM workflow_rules r ${timeRuleCursor} WHERE ${dueTimeRule('?4')}) THEN 'time' END AS scope`).bind(now,now-3600000,now-120000,Math.floor(now/3600000)).first<{scope:'all'|'time'|null}>()
 return row?.scope
}
