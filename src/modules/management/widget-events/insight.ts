import { enforceRateLimits } from '../../../platform/rate-limits'
import { trackingStatement } from '../../outcomes/state'
import { HTTPException } from 'hono/http-exception'
import { text } from '../common'
import { admitInsightPair } from '../../conversations/insight-admission'
import { followupId, createFollowupStatement, carryFollowupStatements } from '../../workflows/followups'
import { workflowNow, workflowEnvironment } from '../../workflows/clock'
import { onCustomerMessage } from '../../ai-support/service'
import {widgetMonitoringPolicy} from '../../customer-context/widget-policy'
import type { WidgetCommand } from './types'

interface InsightButton { id?: string; label: string; action?: string; text?: string }

export async function useInsight({ c, actor, conversation, data }: WidgetCommand) {
  const insightId = data.insight_id || data.insightId || data.id || ''
  const insight = await c.env.DB.prepare(
    'SELECT content,buttons FROM context_insights WHERE id=? AND project_id=? AND subject_id=? AND dismissed_at IS NULL',
  ).bind(insightId, actor.projectId, actor.contactId!).first<{ content: string; buttons: string }>()
  if (!insight) throw new HTTPException(404)
  const subject=await c.env.DB.prepare('SELECT consent,bot_enabled FROM context_subjects WHERE project_id=? AND subject_id=?').bind(actor.projectId,actor.contactId!).first<{consent:number;bot_enabled:number}>()
  if (subject&&(!subject.consent||!subject.bot_enabled))throw new HTTPException(403,{message:'Activity sharing has stopped'})
  if (data.close) {
    await c.env.DB.prepare('UPDATE context_insights SET dismissed_at=? WHERE id=? AND project_id=? AND subject_id=?')
      .bind(Date.now(), insightId, actor.projectId, actor.contactId!).run()
    return c.json({ dismissed: true })
  }

  const buttons = JSON.parse(insight.buttons) as InsightButton[]
  const choice = buttons.find(item =>
    (data.button_id && item.id === data.button_id) ||
    (data.label && item.label === data.label) ||
    (item.action === 'send' && item.text === (data.text || data.contact_message?.content)),
  )
  if (!choice) throw new HTTPException(400, { message: 'Select an existing insight response' })
  await enforceRateLimits(c.env,[['messagesPerConversationMinute',conversation.id],['messagesPerContactHour',actor.contactId!]])
  const contactLocalId = text(data.local_id || data.contact_message?.local_id || data.requestId, 200)
  const target = await insightConversation(c, actor, conversation, insightId, contactLocalId)
  const policy=await widgetMonitoringPolicy(c.env,actor.projectId)
  const result = await admitInsightPair(c.env, {
    actor,
    conversationId: target.id,
    insightId,
    button: choice.text || choice.label,
    aiLocalId: text(data.ai_message?.local_id, 200),
    contactLocalId,
    expectedRevision: target.revision,
    sessionHash: c.get('sessionHash'),
    monitoringRequired:!!subject,
    assistantId:policy.enabled&&policy.ready?policy.assistant?.id:undefined,
  })
  // A follow-up keeps the Closed ticket's requester, participants, tags and fields; replays re-run only idempotent links.
  const visitorMessage = result.accepted ? await c.env.DB.prepare('SELECT id,created_at FROM messages WHERE conversation_id=? AND local_id=?').bind(target.id, contactLocalId).first<{ id: string; created_at: number }>() : null
  if (target.id !== conversation.id && visitorMessage) await c.env.DB.batch(carryFollowupStatements(c.env, { id: target.id, originalId: conversation.id, messageId: visitorMessage.id, actorId: actor.id, localId: contactLocalId, now: visitorMessage.created_at }))
  // Admission commits the pair and outbox before delivery; replays schedule no work.
  if (result.accepted && !result.duplicate) {
    const socket = c.env.CONVERSATIONS.get(c.env.CONVERSATIONS.idFromName(target.id))
    c.executionCtx.waitUntil(socket.fetch('https://conversation.internal/broadcast', {
      method: 'POST', body: JSON.stringify({ conversationId: target.id }),
    }))
    const last = result.messages?.at(-1)
    if (last) c.executionCtx.waitUntil(onCustomerMessage(c.env, last, actor))
  }
  const assignment=result.accepted?await c.env.DB.prepare('SELECT ca.ai_id FROM conversation_ai ca JOIN conversations c ON c.id=ca.conversation_id WHERE c.id=? AND c.project_id=? AND c.assigned_to IS NULL').bind(target.id,actor.projectId).first<{ai_id:string|null}>():null
  return c.json({...result,conversationId:target.id,ai_id:assignment?.ai_id||null}, result.accepted ? 200 : 409)
}

/** A Closed ticket is final: the visitor's choice on one is admitted into its linked
 * follow-up, as a customer reply or email to it is (conversations/admission.ts). */
async function insightConversation(c: WidgetCommand['c'], actor: WidgetCommand['actor'], conversation: WidgetCommand['conversation'], insightId: string, contactLocalId: string) {
  const current = await c.env.DB.prepare('SELECT status_category FROM conversations WHERE id=? AND project_id=?').bind(conversation.id, actor.projectId).first<{ status_category: string }>()
  if (current?.status_category !== 'closed') return conversation
  // A replayed choice returns to the ticket that admitted it; a used insight opens nothing.
  const admitted = await c.env.DB.prepare('SELECT c.id,c.revision,c.assigned_to FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.project_id=? AND c.contact_id=? AND m.local_id=?').bind(actor.projectId, actor.contactId!, contactLocalId).first<WidgetCommand['conversation']>()
  if (admitted) return admitted
  if (await c.env.DB.prepare("SELECT 1 FROM message_authorship WHERE source_kind='insight' AND source_id=? AND kind='visitor'").bind(insightId).first()) return conversation
  await enforceRateLimits(c.env, [['conversationsPerContactHour', actor.contactId!]])
  const id = await followupId(actor.projectId, conversation.id, actor.id, contactLocalId), now = workflowNow(await workflowEnvironment(c.env))
  await c.env.DB.batch([
    createFollowupStatement(c.env, { id, now, actorId: actor.id, predicates: ['c.id=?', 'c.project_id=?', 'c.contact_id=?', "c.status_category='closed'"], args: [conversation.id, actor.projectId, actor.contactId!] }),
    trackingStatement(c.env, id, true),
  ])
  const created = await c.env.DB.prepare('SELECT id,revision,assigned_to FROM conversations WHERE id=? AND project_id=? AND contact_id=?').bind(id, actor.projectId, actor.contactId!).first<WidgetCommand['conversation']>()
  if (!created) throw new HTTPException(404)
  return created
}
