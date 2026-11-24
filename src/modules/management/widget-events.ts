import {campaignAction} from '../widget/campaigns/events'
import {rateResolution,optOutWidgetSurveys} from '../outcomes/rating'
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { requireActor } from '../../platform/auth'
import { enforceRateLimit } from '../../platform/rate-limits'
import { updateContact, recordPresence } from './widget-events/contact'
import { markAsRead, assignAi, requestReply } from './widget-events/conversation'
import { useInsight } from './widget-events/insight'
import { dispatchContextAction } from './widget-events/context'
import type { WidgetCommandData, WidgetConversation } from './widget-events/types'

export const widgetEvents = new Hono<AppEnv>()

widgetEvents.post('/:id/widget-events', async c => {
  const actor = await requireActor(c)
  if (actor.role !== 'contact') throw new HTTPException(403, {message:'A visitor session is required for widget events'})
  // Authenticate and establish conversation ownership before dispatching any action.
  const conversation = await c.env.DB.prepare(
    'SELECT id,revision,assigned_to FROM conversations WHERE id=? AND project_id=? AND contact_id=?',
  ).bind(c.req.param('id'), actor.projectId, actor.contactId!).first<WidgetConversation>()
  if (!conversation) throw new HTTPException(404, {message:'Conversation is unavailable for this visitor'})
  await enforceRateLimit(c.env, 'widgetEventsPerContactMinute', actor.contactId!)

  const body = await c.req.json<{ action: string; data?: WidgetCommandData }>().catch(()=>null)
  if (typeof body?.action !== 'string') throw new HTTPException(400, {message:'A widget action is required'})
  const action = body.action
  const data = body.data || {}
  const command = { c, actor, conversation, action, data }
  switch (action) {
    case 'campaignEvaluate':
    case 'campaignEvent': return campaignAction(command,data)
    case 'rateResolution': return rateResolution(command)
    case 'optOutResolutionSurveys': return optOutWidgetSurveys(command)
    case 'contact': return updateContact(command)
    case 'pingActive':
    case 'instruction': return recordPresence(command)
    case 'pingAction':
      await recordPresence(command)
      return dispatchContextAction(command, data)
    case 'markAsRead':
      if (body.data !== undefined && (!body.data || typeof body.data !== 'object' || Array.isArray(body.data))) {
        throw new HTTPException(400, {message:'Read data must be an object'})
      }
      return markAsRead(command)
    case 'assignAi': return assignAi(command)
    case 'useInsight': return useInsight(command)
    case 'request': return requestReply(command)
    default: return dispatchContextAction(command, data)
  }
})
