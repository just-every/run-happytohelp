import type {Env} from '../../platform/env'
import type {Generation} from './repository'
import type {GenerationEffects} from './generation-effects'
import {assignmentHistoryStatement} from '../outcomes/assignment-history'
import {assignmentNotificationStatement} from '../integrations/notifications'
import {dispatchRequestAssignment} from '../integrations/notification-request'
import {publishActivity} from '../conversations/activity'
import {activeSourceProjectSql} from '../knowledge/public-sources'
/** Assignment is the only mutation a customer-facing model may request. */
export function handoffTool(env:Env,row:Generation,effects:GenerationEffects){
 return {allowSummary:false,definition:{type:'function',function:{name:'switch_agent',description:'Hand this conversation to a human teammate. Pass agent_id="human" to select an active project teammate, or their exact user ID. This changes assignment only; it performs no customer account action.',parameters:{type:'object',properties:{agent_id:{type:'string'}},required:['agent_id'],additionalProperties:false}}},function:async(agentId:string)=>{
  const user=await env.DB.prepare("SELECT u.id,u.name FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.project_id=? AND (?='human' OR m.user_id=?) ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,u.id LIMIT 1").bind(row.project_id,agentId,agentId).first<{id:string;name:string}>()
  if(!user)return {transferred:false,reason:'No matching human teammate'}
  const receipt=crypto.randomUUID(),now=Date.now(),accepted='EXISTS(SELECT 1 FROM ai_handoff_receipts WHERE id=?)'
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT OR IGNORE INTO ai_handoff_receipts(id,project_id,conversation_id,generation_id,agent_id,revision,created_at)
    SELECT ?,c.project_id,c.id,?,?,c.revision,? FROM conversations c
    WHERE c.id=? AND c.project_id=? AND c.revision=? AND c.last_message_id IS ? AND c.assigned_to IS NULL AND c.resolved_at IS NULL AND ${activeSourceProjectSql('c.project_id')} AND EXISTS(SELECT 1 FROM memberships WHERE project_id=c.project_id AND user_id=?) AND EXISTS(SELECT 1 FROM ai_generations g JOIN conversation_ai ca ON ca.conversation_id=g.conversation_id JOIN ai_profiles a ON a.id=ca.ai_id AND a.project_id=g.project_id WHERE g.id=? AND g.state='running' AND g.ai_id=a.id AND a.is_enabled=1 AND a.model=json_extract(g.ai_profile_json,'$.model') AND a.prompt=json_extract(g.ai_profile_json,'$.prompt') AND (SELECT revision FROM context_subjects WHERE project_id=c.project_id AND subject_id=c.contact_id)=g.source_context_revision)`).bind(receipt,row.id,user.id,now,row.conversation_id,row.project_id,row.source_revision,row.source_last_message_id,user.id,row.id),
   env.DB.prepare('UPDATE conversations SET assigned_to=?,updated_at=? WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM ai_handoff_receipts WHERE id=?)').bind(user.id,now,row.conversation_id,row.project_id,receipt),
   env.DB.prepare('UPDATE conversation_ai SET ai_id=NULL WHERE conversation_id=? AND EXISTS(SELECT 1 FROM ai_handoff_receipts WHERE id=?)').bind(row.conversation_id,receipt),
   assignmentHistoryStatement(env,{id:receipt,conversationId:row.conversation_id,actorId:row.ai_id,agentId:user.id,createdAt:now},accepted,[receipt]),
   assignmentNotificationStatement(env,{id:receipt,projectId:row.project_id,conversationId:row.conversation_id,actorId:row.ai_id,previousAssignee:null,assignee:user.id},accepted,[receipt]),
  ])
  if(!result[0].meta.changes)return {transferred:false,reason:'Conversation or authority changed'}
  // The same guarded receipt owns assignment history and its recoverable notice.
  // Queue execution without a request budget leaves delivery to the scheduler.
  await dispatchRequestAssignment(env,row.project_id,row.conversation_id)
  await publishActivity(env,row.project_id,row.conversation_id,'assignment')
  await effects.emit(env,row,{type:'settings',payload:{human:user}})
  return {transferred:true,agent:user}
 }}
}
