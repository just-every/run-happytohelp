import {workflowEnvironment} from './modules/workflows/clock'
import {processWorkflowEvents} from './modules/workflows/events'
import {isProjectActive} from './platform/project-status'
import type { Actor, Env } from './platform/env'
import { onCustomerMessage } from './modules/ai-support/service'
import { isAutomaticInboundEmail,notifyMessage } from './modules/integrations'
import type {DeferEmailDelivery} from './modules/integrations/email'
import {postAwayReply} from './modules/management/away-reply'

// Admission persists its outbox in the same transaction as the message. HTTP
// handlers make effects prompt; the scheduler recovers a crash before this call.
// Inbound mail classified automatic (out-of-office, bounce, list, no-reply) stays in
// the transcript but earns no AI reply and no notification, on first delivery and
// on every replay, so a machine's mail can never start a reply loop. A visitor's chat
// message to an away team earns the away reply once per conversation (away-reply.ts).
export async function applyMessageEffects(env:Env,message:Record<string,unknown>,actor:Actor,defer?:DeferEmailDelivery) {
 env=await workflowEnvironment(env)
 if(!await isProjectActive(env,actor.projectId))return
 if(await isAutomaticInboundEmail(env,actor.projectId,message))return
 await processWorkflowEvents(env,String(message.conversation_id))
 const results = await Promise.allSettled([onCustomerMessage(env,message,actor),notifyMessage(env,message,actor,defer),postAwayReply(env,message,actor)])
 const failed = results.filter(result => result.status === 'rejected')
 if (failed.length) throw new Error('Message saved; a follow-up service failed. Check generation and email delivery status.')
}
