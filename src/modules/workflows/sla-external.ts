import type {Env} from '../../platform/env'
import type {Spent} from './budget'
import {deliverSlaSlack} from './sla-slack'
import {deliverSlaTeams} from './sla-teams'

/** One shared scan and send quantum for external SLA channels. An installation
 * without Teams retains the existing idle statement cost and workflow shares. */
export async function deliverSlaExternal(env:Env,now:number,spent?:Spent){
 await env.DB.prepare(`UPDATE sla_alerts SET
 slack_state=CASE WHEN slack_state='sending' AND slack_started_at<?1 THEN 'uncertain' ELSE slack_state END,
 slack_next_attempt_at=CASE WHEN slack_state='sending' AND slack_started_at<?1 THEN NULL ELSE slack_next_attempt_at END,
 slack_error=CASE WHEN slack_state='sending' AND slack_started_at<?1 THEN 'Delivery interrupted; reconcile in Slack before further action' ELSE slack_error END,
 teams_state=CASE WHEN teams_state='sending' AND teams_started_at<?1 THEN 'uncertain' ELSE teams_state END,
 teams_next_attempt_at=CASE WHEN teams_state='sending' AND teams_started_at<?1 THEN NULL ELSE teams_next_attempt_at END,
 teams_error=CASE WHEN teams_state='sending' AND teams_started_at<?1 THEN 'Delivery interrupted; reconcile in Teams before further action' ELSE teams_error END
 WHERE (slack_state='sending' AND slack_started_at<?1) OR (teams_state='sending' AND teams_started_at<?1)`).bind(now-3600000).run()
 if(spent?.())return
 const alert=await env.DB.prepare(`SELECT a.*,d.channel FROM sla_alerts a JOIN (
 SELECT id,project_id,'slack' channel,coalesce(slack_next_attempt_at,created_at) due_at FROM sla_alerts WHERE slack_state='pending' AND coalesce(slack_next_attempt_at,0)<=?1
 UNION ALL SELECT id,project_id,'teams' channel,coalesce(teams_next_attempt_at,created_at) due_at FROM sla_alerts WHERE teams_state='pending' AND coalesce(teams_next_attempt_at,0)<=?1
 ) d ON d.id=a.id AND d.project_id=a.project_id LEFT JOIN workflow_queue_turns q ON q.queue='sla-'||d.channel AND q.project_id=a.project_id
 ORDER BY coalesce(q.turn,0),d.due_at,a.id,d.channel LIMIT 1`).bind(now).first<any>()
 if(!alert)return
 await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT ?,?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue IN ('sla-slack','sla-teams') ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind('sla-'+alert.channel,alert.project_id).run()
 if(alert.channel==='teams')await deliverSlaTeams(env,now,alert)
 else await deliverSlaSlack(env,now,alert)
}
