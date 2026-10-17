import type {Env,Actor} from '../../platform/env'
import type {DeferEmailDelivery} from './email'
import {notifyMessage as deliverMessage} from './notifications'

/** R4's trigger receives the same message and actor. Mail readiness is scoped to
 * this message's selected connected mailbox, rather than inventing a global
 * installation provider or falling back after a provider failure. */
export async function notifyMailboxMessage(env:Env,message:any,actor:Actor,defer?:DeferEmailDelivery){
 const selected=await env.DB.prepare(`SELECT mailbox.id FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id
  LEFT JOIN email_message_options options ON options.project_id=m.project_id AND options.conversation_id=m.conversation_id AND options.local_id=m.local_id
  JOIN mailbox_connections mailbox ON mailbox.id=coalesce(options.mailbox_id,c.mailbox_id) AND mailbox.project_id=c.project_id
  WHERE m.id=? AND m.project_id=? AND mailbox.status='connected' AND mailbox.provider<>'forwarding'`).bind(message.id,actor.projectId).first<{id:string}>()
 return deliverMessage(selected?{...env,H2H_CONNECTED_MESSAGE_MAILBOX:selected.id}:env,message,actor,defer)
}
