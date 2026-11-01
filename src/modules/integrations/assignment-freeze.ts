import type {Env} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
import type {OperatorNotification} from './operator-notifications'
import {notificationTicketSql} from './triggers/eligibility'

const claimId="'ticket-notice:'||o.project_id||':'||o.conversation_id||':team:assignment:'||o.id"
const inboxId="CASE WHEN substr(o.id,1,11)='assignment:' THEN o.id ELSE 'team-notice:'||o.project_id||':assignment:'||o.id||':'||o.user_id END"
// Reuse the live ticket predicate without a per-notice repository read. This is
// a correlated EXISTS, so each assignment keeps its own project/contact fence.
const eligible=notificationTicketSql.replace('c.id=? AND c.project_id=?','c.id=o.conversation_id AND c.project_id=o.project_id')

/** Freeze independent scheduled assignment audiences in one atomic transaction.
 * Known preparation failures retain their original per-event recovery path.
 * A new storage fault rolls the entire freeze back before any external send. */
export async function freezeAssignmentNotifications(env:Env,rows:OperatorNotification[]){
 const ids=rows.filter(row=>row.kind==='assignment'&&!row.recovery_id).map(row=>row.id)
 const empty={completed:new Set<string>(),queued:false}
 if(!ids.length||!cronRoom(env,9))return empty
 const selected=JSON.stringify(ids),token=crypto.randomUUID(),stamp=Date.now()
 const noRecovery="NOT EXISTS(SELECT 1 FROM notification_trigger_claims r WHERE r.id='operator-recovery:'||o.id)"
 const result=await env.DB.batch<{id:string}>([
  env.DB.prepare(`INSERT OR IGNORE INTO notification_trigger_claims(id,project_id,conversation_id,event,claim_token,state,outcome_json,created_at)
   SELECT ${claimId},o.project_id,o.conversation_id,'team:assignment:'||o.id,?2,'complete',
    json_object('recipients',json(CASE WHEN m.user_id IS NOT NULL AND u.id IS NOT NULL AND EXISTS(SELECT 1 FROM conversations assigned WHERE assigned.id=o.conversation_id AND assigned.project_id=o.project_id AND assigned.assigned_to=o.user_id) THEN json_array(o.user_id) ELSE '[]' END)),?3
   FROM json_each(?1) selected JOIN operator_notifications o ON o.id=selected.value
   LEFT JOIN memberships m ON m.project_id=o.project_id AND m.user_id=o.user_id LEFT JOIN users u ON u.id=m.user_id
   WHERE o.state='pending' AND o.kind='assignment' AND ${noRecovery} AND EXISTS(${eligible})`).bind(selected,token,stamp),
  env.DB.prepare(`INSERT OR IGNORE INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,email_address,created_at)
   SELECT ${inboxId},o.project_id,o.conversation_id,o.user_id,'assignment',coalesce(p.inbox,1),coalesce(p.email,s.is_notifiable_on_conversation_assignment,1),u.email,o.created_at
   FROM json_each(?1) selected JOIN operator_notifications o ON o.id=selected.value
   JOIN notification_trigger_claims claim ON claim.id=${claimId} AND claim.claim_token=?2 AND claim.state='complete'
   JOIN users u ON u.id=o.user_id
   LEFT JOIN notification_preferences p ON p.project_id=o.project_id AND p.user_id=o.user_id AND p.kind='assignment'
   LEFT JOIN user_settings s ON s.user_id=o.user_id
   WHERE EXISTS(SELECT 1 FROM json_each(claim.outcome_json,'$.recipients') recipient WHERE recipient.value=o.user_id)`).bind(selected,token),
  env.DB.prepare(`UPDATE operator_notifications AS o SET state='complete'
   WHERE o.id IN (SELECT value FROM json_each(?1)) AND o.state='pending' AND o.kind='assignment' AND ${noRecovery}
   AND EXISTS(SELECT 1 FROM notification_trigger_claims claim WHERE claim.id=${claimId} AND claim.claim_token=?2 AND claim.state='complete'
    AND (json_array_length(claim.outcome_json,'$.recipients')=0 OR EXISTS(SELECT 1 FROM notification_inbox inbox WHERE inbox.id=${inboxId} AND inbox.project_id=o.project_id AND inbox.conversation_id=o.conversation_id AND inbox.user_id=o.user_id))) RETURNING id`).bind(selected,token),
 ])
 return {completed:new Set(result[2].results.map(row=>String(row.id))),queued:Boolean(result[1].meta.changes)}
}
