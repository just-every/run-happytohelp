import {channelMessage} from './modules/support-channels/outbound'
import {dispatchTriage} from './modules/triage/worker'
import {inCron,cronRequire} from './platform/cron-budget'
import {workflowEnvironment} from './modules/workflows/clock'
import {processWorkflowEvents} from './modules/workflows/events'
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
export async function applyMessageEffects(env:Env,message:Record<string,unknown>,actor:Actor,defer?:DeferEmailDelivery,options:{workflow?:boolean}={}) {
 env=await workflowEnvironment(env)
 // Select the channel in the existing active-project read. Ordinary messages
 // must not spend the scheduler's bounded effect allocation probing channel stores.
 const project=await env.DB.prepare("SELECT (SELECT channel FROM conversations c WHERE c.id=? AND c.project_id=p.id) channel FROM projects p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)").bind(message.conversation_id,actor.projectId).first<{channel:string|null}>()
 if(!project)return
 if(['sms','whatsapp','instagram','messenger','slack','teams'].includes(project.channel??'')&&await channelMessage(env,message,actor))return
 if(await isAutomaticInboundEmail(env,actor.projectId,message))return
 await dispatchTriage(env,String(message.conversation_id)).catch(()=>console.error('Triage dispatch deferred to recovery'))
 if(options.workflow!==false)await processWorkflowEvents(env,String(message.conversation_id),20)
 // Cron leaves each unfinished effect on the durable outbox. Sequential calls
 // keep admission accurate when the services share the same statement budget.
 if(inCron(env)){
  cronRequire(env,25);await onCustomerMessage(env,message,actor)
  cronRequire(env,20);await notifyMessage(env,message,actor,defer)
  cronRequire(env,8);await postAwayReply(env,message,actor)
  return
 }
 const results = await Promise.allSettled([onCustomerMessage(env,message,actor),notifyMessage(env,message,actor,defer),postAwayReply(env,message,actor)])
 const failed = results.filter(result => result.status === 'rejected')
 const limited=failed.find(result=>result.status==='rejected'&&result.reason instanceof Error&&result.reason.message==='WORKER_D1_STATEMENT_LIMIT')
 if(limited?.status==='rejected')throw limited.reason
 if (failed.length) throw new Error('Message saved; a follow-up service failed. Check generation and email delivery status.')
}
