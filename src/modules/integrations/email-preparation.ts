import {rerMail} from './rer-mail-contract'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import type {EmailInput} from './email'
import {emailThreadingStatements,nativeThreadSubject} from './email-threading'
import {recipientReplyAddress} from './email-reply-address'

// Internal preparation metadata stays outside the serialized delivery identity.
export const operatorTicketMessage=Symbol('operator ticket first message')

/** R4 owns notification triggers. R6 enriches their existing immutable mail
 * command at the delivery boundary, shared by every notification caller. */
export async function prepareConversationEmail(env:Env,input:EmailInput):Promise<EmailInput>{
 const match=/^message:([^:]+):notification(?::|$)/.exec(input.idempotencyKey)
 if(!match||!input.projectId)return input
 const row=await env.DB.prepare(`SELECT c.id conversation_id,c.subject,c.mailbox_id conversation_mailbox,m.actor_id,m.actor_role,o.mailbox_id,o.from_address,o.to_address,o.agent_id,o.cc_json,o.bcc_json,
  EXISTS(SELECT 1 FROM operator_ticket_commands cmd WHERE cmd.project_id=m.project_id AND cmd.conversation_id=m.conversation_id AND cmd.local_id=m.local_id) operator_ticket_message
  FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id
  LEFT JOIN email_message_options o ON o.project_id=m.project_id AND o.conversation_id=m.conversation_id AND o.local_id=m.local_id
  WHERE m.id=? AND m.project_id=? AND m.erased_at IS NULL`).bind(match[1],input.projectId).first<any>()
 if(!row)return input
 const messageId=`<h2h.${await hashToken(input.idempotencyKey)}@happytohelp.invalid>`
 const prior=await env.DB.prepare("SELECT key_value FROM email_threading_keys WHERE project_id=? AND conversation_id=? AND key_kind='message_id' AND source_ref<>? ORDER BY created_at DESC LIMIT 1").bind(input.projectId,row.conversation_id,match[1]).first<{key_value:string}>()
 const primary=input.idempotencyKey===`message:${match[1]}:notification`
 const selectedMailbox=row.mailbox_id||row.conversation_mailbox||undefined,to=primary&&row.to_address?row.to_address:input.to
 const mailbox=selectedMailbox?await env.DB.prepare("SELECT address FROM mailbox_connections WHERE id=? AND project_id=? AND status='connected'").bind(selectedMailbox,input.projectId).first<{address:string}>():null
 const managed=rerMail(env)&&!selectedMailbox
 const receiving=managed?await env.DB.prepare('SELECT inbound_address FROM email_settings WHERE project_id=? AND is_enabled=1').bind(input.projectId).first<{inbound_address:string}>():null
 const replyTo=mailbox?await recipientReplyAddress(env,mailbox.address,input.projectId,row.conversation_id,to):managed?await recipientReplyAddress(env,receiving?.inbound_address,input.projectId,row.conversation_id,to):input.replyTo
 const headers={...input.headers,...(!managed?{'Message-ID':messageId}:{}),...(prior?{'In-Reply-To':prior.key_value,References:prior.key_value}:{})}
 await env.DB.batch(emailThreadingStatements(env,{projectId:input.projectId,conversationId:row.conversation_id,keys:[...(!managed?[{kind:'message_id' as const,value:messageId,source:'native',sourceRef:match[1]}]:[]),{kind:'subject_token',value:`h2h:${row.conversation_id}`,source:'native',sourceRef:match[1]}],createdAt:Date.now()}))
 // Customer-authored fan-out keeps its generic subject: an arbitrary incoming
 // subject must not be propagated to unproven CC participants (R4's notices).
 return {...input,[operatorTicketMessage]:Boolean(row.operator_ticket_message),to,replyTo,subject:row.actor_role==='contact'?input.subject:nativeThreadSubject(row.subject||input.subject,row.conversation_id),headers,
  mailboxId:row.mailbox_id||row.conversation_mailbox||undefined,agentId:row.agent_id||(row.actor_role!=='contact'&&row.actor_role!=='ai'?row.actor_id:undefined),fromAddress:row.from_address||undefined,
  ...(primary?{cc:row.cc_json?JSON.parse(row.cc_json):[],bcc:row.bcc_json?JSON.parse(row.bcc_json):[]}:{})}
}
