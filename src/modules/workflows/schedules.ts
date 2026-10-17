import type {Actor,Env} from '../../platform/env'
import {memberAccess} from '../access/gate'
import {admitMessage} from '../conversations/admission'
import {applyMessageEffects} from '../../message-effects'
import {publishActivity} from '../conversations/activity'
import {scheduledAdmission} from './schedule-authority'
import {workflowNow} from './clock'
import type {Spent} from './budget'
const liveScheduleSql=`EXISTS(SELECT 1 FROM workflow_schedules ws JOIN memberships wm ON wm.project_id=ws.project_id AND wm.user_id=ws.sender_id WHERE ws.id=? AND ws.conversation_id=c.id AND ws.state='sending' AND ws.expected_revision=c.revision AND ws.expected_last_message_id IS c.last_message_id AND ws.expected_assignee IS c.assigned_to AND ws.expected_group_id IS c.group_id AND wm.role=ws.sender_role AND (SELECT role_key FROM member_roles WHERE project_id=wm.project_id AND user_id=wm.user_id) IS ws.sender_role_key AND (SELECT pr.updated_at FROM member_roles mr JOIN project_roles pr ON pr.project_id=mr.project_id AND pr.id=mr.role_key WHERE mr.project_id=wm.project_id AND mr.user_id=wm.user_id) IS ws.sender_role_updated_at AND EXISTS(SELECT 1 FROM memberships owner WHERE owner.project_id=ws.project_id AND owner.user_id=ws.owner_id))`
async function settle(env:Env,id:string,state:string,reason:string|null,now:number,messageId?:string){await env.DB.prepare("UPDATE workflow_schedules SET state=?,reason=?,message_id=coalesce(?,message_id),updated_at=?,version=version+1 WHERE id=? AND state IN ('pending','sending')").bind(state,reason,messageId??null,now,id).run()}
/** The sending claim precedes message admission and mail. A lost process never
 * repeats the attempt; a committed message or provider record can be reconciled. */
export async function runWorkflowSchedules(env:Env,now=workflowNow(env),spent?:Spent){
 await env.DB.prepare("UPDATE workflow_schedules SET state='uncertain',reason='The worker stopped during a send. Check the transcript and delivery before composing a new reply.',updated_at=?,version=version+1 WHERE state='sending' AND attempted_at<=?").bind(now,now-120000).run()
 const rows=await env.DB.prepare(`SELECT ws.* FROM workflow_schedules ws JOIN conversations c ON c.id=ws.conversation_id JOIN contacts ct ON ct.id=c.contact_id WHERE ws.state='pending' AND ((ws.due_at IS NOT NULL AND ws.due_at<=?) OR ws.kind='snooze' AND EXISTS(SELECT 1 FROM conversations d WHERE d.project_id=ws.project_id AND d.id=ws.dependency_id AND d.status_category IN ('solved','closed'))) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=ws.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id) ORDER BY ws.due_at,ws.created_at LIMIT 50`).bind(now).all<any>()
 let processed=0
 for(const row of rows.results){
  if(spent?.())break
  processed++
  if(row.kind==='snooze'){await settle(env,row.id,'woken',row.dependency_id?'Dependency completed or wake time reached':'Wake time reached',now);await publishActivity(env,row.project_id,row.conversation_id,'assignment');continue}
  const access=await memberAccess(env.DB,row.project_id,row.sender_id)
  if(!access?.permissions.has('conversations.reply')){await settle(env,row.id,'cancelled','The sender no longer has permission to reply',now);continue}
  const claim=await env.DB.prepare(`UPDATE workflow_schedules SET state='sending',attempted_at=?,updated_at=?,version=version+1 WHERE id=? AND state='pending' AND version=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=workflow_schedules.conversation_id AND c.project_id=workflow_schedules.project_id AND c.revision=workflow_schedules.expected_revision AND c.last_message_id IS workflow_schedules.expected_last_message_id AND c.assigned_to IS workflow_schedules.expected_assignee AND c.group_id IS workflow_schedules.expected_group_id AND c.status_category NOT IN ('solved','closed') AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.contact_id))`).bind(now,now,row.id,row.version).run()
  if(!claim.meta.changes){await settle(env,row.id,'cancelled','Ticket changed before the scheduled reply',now);continue}
  const actor:Actor={id:row.sender_id,projectId:row.project_id,role:row.sender_role}
  let messageId:string|undefined
  try{
   const result=await admitMessage(env,{projectId:row.project_id,conversationId:row.conversation_id,actor,localId:`schedule:${row.id}`,content:row.body,expectedRevision:row.expected_revision,expectedLastMessageId:row.expected_last_message_id,[scheduledAdmission]:{sql:liveScheduleSql,params:[row.id]}})
   if(!result.accepted){await settle(env,row.id,'cancelled',result.reason??'Message admission refused',now);continue}
   messageId=String(result.message!.id)
   await applyMessageEffects(env,result.message!,actor)
   const deliveries=(await env.DB.prepare("SELECT state FROM email_deliveries WHERE id=? OR substr(id,1,?)=?").bind(`message:${messageId}:notification`,`message:${messageId}:notification:`.length,`message:${messageId}:notification:`).all<{state:string}>()).results
   const uncertain=deliveries.some(d=>['uncertain','sending'].includes(d.state)),failed=deliveries.some(d=>d.state==='failed')
   await settle(env,row.id,uncertain?'uncertain':failed?'failed':'sent',uncertain?'Mail delivery is uncertain; this reply will not be replayed':failed?'The reply was saved but its mail delivery failed':null,now,messageId)
  }catch{
   // Even a DB exception can hide a successful commit. No automatic replay.
   await settle(env,row.id,'uncertain',messageId?'Reply saved; delivery did not settle. Check its delivery status.':'Attempt outcome unknown. Check the transcript before sending again.',now,messageId)
  }
  await publishActivity(env,row.project_id,row.conversation_id,'assignment')
 }
 return {processed}
}
