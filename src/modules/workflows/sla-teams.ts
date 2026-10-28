import type {Env} from '../../platform/env'
import type {Spent} from './budget'
import {liveSlaTicketSql} from './sla'
import {memberAccess} from '../access/gate'
import {loadConnection} from '../escalations/connections'
import {sendTeamsAlert} from './sla-teams-transport'

// Connection revisions freeze both channel and installation consent. Reconnecting
// requires a fresh policy selection; it cannot redirect an already queued alert.
const eligible=`EXISTS(SELECT 1 FROM conversations c JOIN sla_policies p ON p.project_id=c.project_id AND p.id=sla_alerts.policy_id JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id JOIN escalation_teams_connections d ON d.project_id=p.project_id AND d.id=p.teams_connection_id AND d.updated_at=p.teams_connection_version WHERE c.project_id=sla_alerts.project_id AND c.id=sla_alerts.conversation_id AND ${liveSlaTicketSql()} AND c.status_category NOT IN ('solved','closed') AND s.policy_id=p.id AND p.active=1 AND cal.active=1 AND p.teams_connection_id=sla_alerts.teams_connection_id AND p.teams_connection_version=sla_alerts.teams_connection_version AND d.token_cipher IS NOT NULL AND EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=c.project_id AND m.user_id=sla_alerts.recipient_id) AND (c.assigned_to=sla_alerts.recipient_id OR EXISTS(SELECT 1 FROM json_each(p.backup_user_ids_json) b WHERE b.value=sla_alerts.recipient_id)))`
/** One durable claim per invocation; interrupted or uncertain sends never replay. */
export async function deliverSlaTeams(env:Env,now:number,spent?:Spent){
 await env.DB.prepare("UPDATE sla_alerts SET teams_state='uncertain',teams_next_attempt_at=NULL,teams_error='Delivery interrupted; reconcile in Teams before further action' WHERE teams_state='sending' AND teams_started_at<?").bind(now-3600000).run()
 if(spent?.())return
 const alert=await env.DB.prepare("SELECT a.* FROM sla_alerts a LEFT JOIN workflow_queue_turns q ON q.queue='sla-teams' AND q.project_id=a.project_id WHERE a.teams_state='pending' AND coalesce(a.teams_next_attempt_at,0)<=? ORDER BY coalesce(q.turn,0),coalesce(a.teams_next_attempt_at,a.created_at),a.id LIMIT 1").bind(now).first<any>()
 if(!alert)return
 await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'sla-teams',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='sla-teams' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(alert.project_id).run()
 const claim=await env.DB.prepare(`UPDATE sla_alerts SET teams_state='sending',teams_attempts=teams_attempts+1,teams_started_at=?,teams_next_attempt_at=NULL WHERE id=? AND teams_state='pending' AND state='open' AND teams_attempts<5 AND coalesce(teams_next_attempt_at,0)<=? AND ${eligible}`).bind(now,alert.id,now).run()
 if(!claim.meta.changes){await env.DB.prepare("UPDATE sla_alerts SET teams_state='cancelled',teams_next_attempt_at=NULL,teams_error='Alert, backup authority or connection consent is no longer current' WHERE id=? AND teams_state='pending'").bind(alert.id).run();return}
 let crossed=false
 try{
  // loadConnection rechecks the installing member's current owner/admin authority.
  const {row,connection}=await loadConnection(env,alert.project_id,'teams')
  const installer=row.installed_by?await memberAccess(env.DB,alert.project_id,row.installed_by):null
  if(!installer?.permissions.has('integrations.install')||!['owner','admin'].includes(installer.base)||row.id!==alert.teams_connection_id||!await env.DB.prepare(`SELECT 1 FROM sla_alerts WHERE id=? AND teams_state='sending' AND state='open' AND ${eligible}`).bind(alert.id).first()){
   await env.DB.prepare("UPDATE sla_alerts SET teams_state='cancelled',teams_error='Authority or connection changed before send' WHERE id=? AND teams_state='sending'").bind(alert.id).run();return
  }
  const body=`SLA ${alert.kind}: ${alert.metric.replaceAll('_',' ')}\nTicket ${alert.conversation_id}\nNamed operator ${alert.recipient_id}\nOpen HappyToHelp to inspect and acknowledge this alert.`
  crossed=true
  const result=await sendTeamsAlert(connection,body,now),attempt=Number(alert.teams_attempts)+1
  const retry=result.state==='rate_limited'&&attempt<5
  const delay=Math.max([60000,300000,900000,3600000][attempt-1]??3600000,result.retryAfterMs??0),next=retry&&Number.isSafeInteger(now+delay)?now+delay:null
  const state=retry&&next!==null?'pending':result.state==='rate_limited'?'failed':result.state
  const detail=state==='accepted'?null:state==='uncertain'?'Teams did not confirm delivery; reconcile before further action':state==='pending'?'Teams asked us to wait before retrying':'Teams refused the alert or exhausted rate-limit retries; check the connection'
  await env.DB.prepare("UPDATE sla_alerts SET teams_state=?,teams_next_attempt_at=?,teams_error=? WHERE id=? AND teams_state='sending'").bind(state,next,detail,alert.id).run()
 }catch{
  await env.DB.prepare("UPDATE sla_alerts SET teams_state=?,teams_next_attempt_at=NULL,teams_error=? WHERE id=? AND teams_state='sending'").bind(crossed?'uncertain':'cancelled',crossed?'Delivery outcome unknown; no automatic replay':'Teams configuration or installation authority unavailable; no send attempted',alert.id).run()
 }
}
