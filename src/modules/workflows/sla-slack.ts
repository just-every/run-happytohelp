import {ticketScopeSql} from '../access/ticket-scope'
import type {Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import type {Spent} from './budget'
import {liveSlaTicketSql} from './sla'
import {destination} from '../api-integrations/destinations'
import {httpsTransport} from '../api-integrations/transport'
import {createSlackIncomingWebhookProtocol,createSlackBotProtocol,renderSlackEvent,serializeSlackMessage} from '../../vendor/base/modules/integrations/slack/index.ts'

// A destination is frozen at alert creation. Policy opt-out, membership removal,
// reassignment, acknowledgment and resolution all fence the next provider claim.
async function installationAuthorized(env:Env,projectId:string,destinationId:string){
 const installer=await env.DB.prepare("SELECT actor_id FROM native_integration_audit WHERE project_id=? AND resource_id=? AND action='destination.created'").bind(projectId,destinationId).first<{actor_id:string}>()
 const access=installer?.actor_id?await memberAccess(env.DB,projectId,installer.actor_id):null
 return !!access?.permissions.has('integrations.install')&&['owner','admin'].includes(access.base)
}
const eligible=`EXISTS(SELECT 1 FROM conversations c JOIN sla_policies p ON p.project_id=c.project_id AND p.id=sla_alerts.policy_id JOIN workflow_calendars cal ON cal.project_id=p.project_id AND cal.id=p.calendar_id JOIN ticket_sla_state s ON s.project_id=c.project_id AND s.conversation_id=c.id WHERE c.project_id=sla_alerts.project_id AND c.id=sla_alerts.conversation_id AND ${liveSlaTicketSql()} AND ${ticketScopeSql('sla_alerts.recipient_id','c','c.group_id',false)} AND c.status_category NOT IN ('solved','closed') AND s.policy_id=p.id AND p.active=1 AND cal.active=1 AND p.slack_destination_id=sla_alerts.slack_destination_id AND EXISTS(SELECT 1 FROM memberships m WHERE m.project_id=c.project_id AND m.user_id=sla_alerts.recipient_id) AND (c.assigned_to=sla_alerts.recipient_id OR EXISTS(SELECT 1 FROM json_each(p.backup_user_ids_json) b WHERE b.value=sla_alerts.recipient_id)) AND EXISTS(SELECT 1 FROM native_integration_destinations d WHERE d.project_id=c.project_id AND d.id=sla_alerts.slack_destination_id AND d.kind='slack' AND d.enabled=1 ))`
/** One bounded send per tick. Only an explicit rate-limit refusal may retry.
 * Interrupted claims and unknown provider effects remain terminal and inspectable. */
export async function deliverSlaSlack(env:Env,now:number,spent?:Spent){
 await env.DB.prepare("UPDATE sla_alerts SET slack_state='uncertain',slack_next_attempt_at=NULL,slack_error='Delivery interrupted; reconcile in Slack before further action' WHERE slack_state='sending' AND slack_started_at<?").bind(now-3600000).run()
 if(spent?.())return
 const alert=await env.DB.prepare("SELECT a.* FROM sla_alerts a LEFT JOIN workflow_queue_turns q ON q.queue='sla-slack' AND q.project_id=a.project_id WHERE a.slack_state='pending' AND coalesce(a.slack_next_attempt_at,0)<=? ORDER BY coalesce(q.turn,0),coalesce(a.slack_next_attempt_at,a.created_at),a.id LIMIT 1").bind(now).first<any>()
 if(!alert)return
 await env.DB.prepare("INSERT INTO workflow_queue_turns(queue,project_id,turn) SELECT 'sla-slack',?,coalesce(max(turn),0)+1 FROM workflow_queue_turns WHERE queue='sla-slack' ON CONFLICT(queue,project_id) DO UPDATE SET turn=excluded.turn").bind(alert.project_id).run()
 const claim=await env.DB.prepare(`UPDATE sla_alerts SET slack_state='sending',slack_attempts=slack_attempts+1,slack_started_at=?,slack_next_attempt_at=NULL WHERE id=? AND slack_state='pending' AND state='open' AND slack_attempts<5 AND coalesce(slack_next_attempt_at,0)<=? AND ${eligible}`).bind(now,alert.id,now).run()
 if(!claim.meta.changes){await env.DB.prepare("UPDATE sla_alerts SET slack_state='cancelled',slack_next_attempt_at=NULL,slack_error='Alert, backup authority or destination is no longer eligible' WHERE id=? AND slack_state='pending'").bind(alert.id).run();return}
 if(!await installationAuthorized(env,alert.project_id,alert.slack_destination_id)){
  await env.DB.prepare("UPDATE sla_alerts SET slack_state='cancelled',slack_next_attempt_at=NULL,slack_error='Installation authority was revoked; an administrator must reconnect' WHERE id=? AND slack_state='sending'").bind(alert.id).run();return
 }
 let crossed=false
 try{
  const target=await destination(env,alert.project_id,alert.slack_destination_id)
  const protocol=target.mode==='bot'?createSlackBotProtocol({resolveDestination:async()=>target.secret}):createSlackIncomingWebhookProtocol({resolveDestination:async()=>target.secret.url})
  // Fixed metadata only: never send customer text, names, addresses or private notes.
  const message=renderSlackEvent('sla',{}, {sla:()=>({summary:`SLA ${alert.kind}: ${alert.metric.replaceAll('_',' ')}`,sections:[`Ticket ${alert.conversation_id}`,`Named operator ${alert.recipient_id}`, 'Open HappyToHelp to inspect and acknowledge this alert.']})})
  const wire=await protocol.prepare({id:alert.id,tenant:alert.project_id,destinationId:alert.slack_destination_id,event:'sla',protocol:protocol.id,body:serializeSlackMessage(message,target.mode==='bot'?target.secret.channel:undefined)},now)
  // Recheck current authority after asynchronous credential preparation.
  if(!await installationAuthorized(env,alert.project_id,alert.slack_destination_id)||!await env.DB.prepare(`SELECT 1 FROM sla_alerts WHERE id=? AND slack_state='sending' AND state='open' AND ${eligible}`).bind(alert.id).first()){
   await env.DB.prepare("UPDATE sla_alerts SET slack_state='cancelled',slack_error='Authority changed before send' WHERE id=? AND slack_state='sending'").bind(alert.id).run();return
  }
  crossed=true
  const result=protocol.classify(await httpsTransport.send(wire),now),attempt=Number(alert.slack_attempts)+1
  const retry=result.kind==='retryable'&&attempt<5
  const state=retry?'pending':result.kind==='accepted'?'accepted':result.kind==='uncertain'?'uncertain':'failed'
  const delay=Math.max([60000,300000,900000,3600000][attempt-1]??3600000,result.retryAfterMs??0)
  const next=retry&&Number.isSafeInteger(now+delay)?now+delay:null
  const detail=result.kind==='accepted'?null:result.kind==='uncertain'?'Slack did not confirm delivery; reconcile before further action':result.kind==='retryable'?(retry&&next!==null?'Slack asked us to wait before retrying':'Slack rate limits stopped delivery; no further automatic attempts'):'Slack refused the alert; check the connection'
  await env.DB.prepare("UPDATE sla_alerts SET slack_state=?,slack_next_attempt_at=?,slack_error=? WHERE id=? AND slack_state='sending'").bind(retry&&next===null?'failed':state,next,detail,alert.id).run()
 }catch{
  await env.DB.prepare("UPDATE sla_alerts SET slack_state=?,slack_next_attempt_at=NULL,slack_error=? WHERE id=? AND slack_state='sending'").bind(crossed?'uncertain':'failed',crossed?'Delivery outcome unknown; no automatic replay':'Slack configuration unavailable; no send attempted',alert.id).run()
 }
}
