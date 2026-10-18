import type {Env} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {isAutomaticInboundEmail} from './inbound-origin'

/** Operator activity is grouped after 60 seconds without transcript activity.
 * Reads are revision frontiers per recipient. Assignment-mail preferences do not
 * control unread mail. AI-owned conversations stay with the AI. */
export async function queueOperatorActivity(env:Env,message:any,projectId:string){
 if(await isAutomaticInboundEmail(env,projectId,message))return {state:'automatic'}
 await env.DB.prepare(`INSERT OR IGNORE INTO operator_notification_activity(message_id,project_id,conversation_id,revision)
 SELECT m.id,m.project_id,m.conversation_id,m.revision FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id
 WHERE m.id=? AND m.project_id=? AND m.actor_role='contact' AND ${contactAvailableSql()}`)
 .bind(message.id,projectId).run()
 return {state:'queued'}
}

export async function batchOperatorActivity(env:Env,now:number,projectId?:string,conversationId?:string){
 const rows=await env.DB.prepare(`SELECT a.project_id,a.conversation_id FROM operator_notification_activity a
 JOIN conversations c ON c.id=a.conversation_id AND c.project_id=a.project_id
 WHERE a.batch_id IS NULL AND c.updated_at<=? AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.created_at>?)
 ${projectId?'AND a.project_id=?':''} ${conversationId?'AND a.conversation_id=?':''}
 GROUP BY a.project_id,a.conversation_id ORDER BY MIN(a.revision) LIMIT 25`)
 .bind(now-60000,now-60000,...(projectId?[projectId]:[]),...(conversationId?[conversationId]:[])).all<{project_id:string;conversation_id:string}>()
 for(const row of rows.results){
  if(!cronRoom(env,2))break
  const batch=crypto.randomUUID()
  // The transaction claims at most 100 messages and snapshots the eligible
  // recipients together. Concurrent schedulers can never claim the same message.
  await env.DB.batch([
   env.DB.prepare(`UPDATE operator_notification_activity SET batch_id=? WHERE message_id IN (
    SELECT a.message_id FROM operator_notification_activity a JOIN conversations c ON c.id=a.conversation_id AND c.project_id=a.project_id
    WHERE a.batch_id IS NULL AND a.project_id=? AND a.conversation_id=? AND c.updated_at<=?
    AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.created_at>?)
    ORDER BY a.revision LIMIT 100)`)
    .bind(batch,row.project_id,row.conversation_id,now-60000,now-60000),
   env.DB.prepare(`INSERT OR IGNORE INTO operator_notifications(id,project_id,conversation_id,user_id,kind,batch_id,through_revision,created_at)
    SELECT 'unread:'||?||':'||m.user_id,c.project_id,c.id,m.user_id,'unread',?,MAX(a.revision),?
    FROM conversations c JOIN operator_notification_activity a ON a.conversation_id=c.id AND a.project_id=c.project_id AND a.batch_id=?
    JOIN memberships m ON m.project_id=c.project_id
    LEFT JOIN user_project_preferences p ON p.project_id=m.project_id AND p.user_id=m.user_id
    LEFT JOIN conversation_reads r ON r.conversation_id=c.id AND r.user_id=m.user_id
    WHERE c.id=? AND c.project_id=? AND c.resolved_at IS NULL AND ${contactAvailableSql()}
    AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=c.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)
    AND (c.assigned_to=m.user_id OR (c.assigned_to IS NULL AND p.is_notified_on_unassigned_activity=1
     AND NOT EXISTS(SELECT 1 FROM conversation_ai ai WHERE ai.conversation_id=c.id AND ai.ai_id IS NOT NULL)))
    AND a.revision>coalesce(r.revision,0) GROUP BY c.id,m.user_id`)
    .bind(batch,batch,now,batch,row.conversation_id,row.project_id)
  ])
 }
}
