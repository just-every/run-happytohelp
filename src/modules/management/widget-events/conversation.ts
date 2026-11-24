import {assignmentHistoryStatement} from '../../outcomes/assignment-history'
import {publishActivity} from '../../conversations/activity'
import {recordMessageReads} from '../../conversations/reads'
import { HTTPException } from 'hono/http-exception'
import { requestGeneration } from '../../ai-support/repository'
import { clientGenerationId } from '../../ai-support/generation-id'
import { AiReplyCeilingReached } from '../../ai-support/reply-ceiling'
import {onAssistantAssignment} from '../../ai-support/customer-message'
import {assertModelConfigured} from '../../ai-support/configuration'
import type { WidgetCommand } from './types'

export async function markAsRead({ c, actor, conversation, data }: WidgetCommand) {
  // Only the durable write is part of the acknowledgement. An operator's
  // connection can disappear while the live notification is in flight.
  await recordMessageReads(c.env,actor,conversation,data.ids,activity=>c.executionCtx.waitUntil(activity))
  return c.json({ read: true })
}

export async function assignAi({ c, actor, conversation, data }: WidgetCommand) {
  const key = data.ai_id || data.aiId || data.id
  const assistant=key?await c.env.DB.prepare('SELECT model FROM ai_profiles WHERE id=? AND project_id=? AND is_enabled=1').bind(key,actor.projectId).first<{model:string}>():null
  if(key&&!assistant)throw new HTTPException(400)
  if(assistant)assertModelConfigured(c.env,assistant.model)
  const previous=await c.env.DB.prepare('SELECT ai_id FROM conversation_ai WHERE conversation_id=?').bind(conversation.id).first<{ai_id:string|null}>()
  if (conversation.assigned_to) throw new HTTPException(409, { message: 'A human is handling this conversation' })
  const sessionHash=c.get('sessionHash');if(!sessionHash)throw new HTTPException(401)
  const now=Date.now(),receipt=crypto.randomUUID()
  const guard=`c.id=? AND c.project_id=? AND c.contact_id=? AND c.revision=? AND c.assigned_to IS NULL AND c.resolved_at IS NULL
    AND EXISTS(SELECT 1 FROM sessions s JOIN contacts ct ON ct.id=s.contact_id AND ct.project_id=s.project_id WHERE s.token_hash=? AND s.actor_id=? AND s.role='contact' AND s.project_id=c.project_id AND s.contact_id=c.contact_id AND s.revoked_at IS NULL AND s.expires_at>? AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1)
    AND NOT EXISTS(SELECT 1 FROM project_settings WHERE project_id=c.project_id AND json_extract(settings_json,'$.deleted_at') IS NOT NULL)
    ${key?'AND EXISTS(SELECT 1 FROM ai_profiles WHERE id=? AND project_id=c.project_id AND is_enabled=1)':''}`
  const values=[conversation.id,actor.projectId,actor.contactId!,conversation.revision,sessionHash,actor.id,now,...(key?[key]:[])]
  const accepted='EXISTS(SELECT 1 FROM conversation_tracking WHERE conversation_id=? AND transition_id=?)'
  const result=await c.env.DB.batch([
    c.env.DB.prepare(`INSERT OR IGNORE INTO conversation_tracking(conversation_id,project_id,initial_history_complete,cycle_history_complete,cycle_start_revision,cycle_start_at) SELECT c.id,c.project_id,0,0,c.revision,c.created_at FROM conversations c WHERE ${guard}`).bind(...values),
    c.env.DB.prepare(`UPDATE conversation_tracking SET transition_id=? WHERE conversation_id IN (SELECT c.id FROM conversations c WHERE ${guard})`).bind(receipt,...values),
    assignmentHistoryStatement(c.env,{id:receipt,conversationId:conversation.id,actorId:actor.id,agentId:null,aiId:key||null,createdAt:now},`${accepted} AND (SELECT ai_id FROM conversation_ai WHERE conversation_id=c.id) IS NOT ?`,[conversation.id,receipt,key||null]),
    c.env.DB.prepare(`INSERT INTO conversation_ai(conversation_id,ai_id) SELECT ?,? WHERE ${accepted} ON CONFLICT(conversation_id) DO UPDATE SET ai_id=excluded.ai_id`).bind(conversation.id,key||null,conversation.id,receipt),
    ...((previous?.ai_id||null)!==(key||null)?[c.env.DB.prepare(`UPDATE ai_generations SET state='cancelled',updated_at=? WHERE conversation_id=? AND project_id=? AND state IN ('queued','running') AND ${accepted}`).bind(new Date(now).toISOString(),conversation.id,actor.projectId,conversation.id,receipt)]:[]),
  ])
  if(!result[1].meta.changes)throw new HTTPException(409,{message:'Conversation or visitor authority changed'})
  await publishActivity(c.env,actor.projectId,conversation.id,'assignment')
  if(key)await onAssistantAssignment(c.env,actor.projectId,conversation.id,{
    sql:`${guard} AND EXISTS(SELECT 1 FROM conversation_tracking WHERE conversation_id=c.id AND transition_id=?) AND EXISTS(SELECT 1 FROM conversation_ai WHERE conversation_id=c.id AND ai_id=?)`,
    params:[...values,receipt,key],
  })
  return c.json({ assigned: true })
}

/** A visitor's explicit reply request: over a daily AI ceiling it answers 429 until 00:00 UTC. */
export async function requestReply({ c, actor, conversation, data }: WidgetCommand) {
  const generation = await requestGeneration(c.env, {
    projectId: actor.projectId,
    conversationId: conversation.id,
    actor,
    expectedRevision: conversation.revision,
    id: clientGenerationId(data.requestId),
  })
  if ('ceilingReached' in generation) throw new AiReplyCeilingReached()
  return c.json(generation, 202)
}
