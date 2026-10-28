import {canonicaliseMail,mailClaimSql,renderMail} from '../knowledge/mail-door'
import {notificationFetch,notificationSendSignal,withNotificationSendWindow} from './email-send-window'
import {enforceRateLimit,RateLimitExceeded} from '../../platform/rate-limits'
import {rerMail,managedMailbox} from './rer-mail-contract'
import {sendRerMail,RerMailFailure} from './rer-mail'
import {holdRerMail,claimRerMailHold} from './rer-mail-hold'
import {hashToken} from '../../platform/auth'
import {localMailOrigin} from '../../edition/local-mail/configuration'
import {sendDevelopment} from '../../edition/local-mail/sender.mjs'
import {emailMode} from './email-provider'
import type {Env} from '../../platform/env'
import {emailConfigured, providerRequest, providerReceipt, selectedEmailProvider, sendGridDelivery, providerMessage, validateEmailInput} from './email-provider'
import {SendGridSendError} from '../../vendor/base/modules/sendgrid-email/src/sender'
export {emailConfigured} from './email-provider'
import {HTTPException} from 'hono/http-exception'
import {demoEffect} from '../../vendor/base/modules/demo/index.mjs'
import {prepareConversationEmail,operatorTicketMessage} from './email-preparation'
import {sendViaMailbox,mailboxSender} from './mailboxes/send'
import {mailboxForDelivery} from './mailboxes/store'

/** `headers` are extra message headers (loop suppression on notifications); like every
 * other field they are part of the delivery identity. */
export interface EmailAttachment {filename:string;content:string;contentType:string;contentId?:string}
export interface EmailInput {[operatorTicketMessage]?:boolean;to:string;cc?:readonly string[];bcc?:readonly string[];mailboxId?:string;agentId?:string;fromAddress?:string;subject:string;text:string;html?:string;attachments?:readonly EmailAttachment[];projectId?:string;idempotencyKey:string;replyTo?:string;headers?:Readonly<Record<string,string>>}
/** The host retains provider execution only after every sending claim is durable. */
export type DeferEmailDelivery=(delivery:Promise<unknown>)=>void
type DeliveryRow={state:string;provider_id:string|null;intent_hash:string}

export type EmailOutcome={id:string|null;state:string;recipient?:string;mode?:'local'}
async function senderFor(env:Env,input:EmailInput){
 if(input.mailboxId&&input.projectId){
  const selected=await mailboxForDelivery(env,input.projectId,input.mailboxId)
  if(!selected)throw new HTTPException(409,{message:'Mailbox is no longer connected'})
  const address=input.fromAddress||selected.sender_address||selected.address,name=selected.display_name.replace(/[\r\n"<>]/g,'')
  return name?`${name} <${address}>`:address
 }
 // A workspace sender is used only while its email is enabled. Account mail for a
 // workspace with email off (such as one moved in from legacy with its sender
 // unverified) comes from the installation's sender.
 const sender=input.projectId?await env.DB.prepare('SELECT from_name,from_address FROM email_settings WHERE project_id=? AND is_enabled=1').bind(input.projectId).first<{from_name:string;from_address:string}>():null
 const senderAddress=rerMail(env)?(await managedMailbox(env,input.projectId))?.address||String(env.MAIL_FROM||''):sender?.from_address||String(env.EMAIL_FROM||'')
 return sender?.from_name?`${sender.from_name.replace(/[\r\n"<>]/g,'')} <${String(senderAddress).match(/<([^>]+)>/)?.[1]||senderAddress}>`:senderAddress
}
async function updateDelivery(env:Env,id:string,state:'sent'|'failed'|'uncertain',error:string|null,providerId:string|null=null){
 await env.DB.prepare('UPDATE email_deliveries SET state=?,provider_id=coalesce(?,provider_id),error=?,updated_at=? WHERE id=?').bind(state,providerId,error,Date.now(),id).run()
}
async function sendThroughSelectedProvider(env:Env,input:EmailInput,from:string,holdable:boolean):Promise<string|null>{
 if(input.mailboxId&&input.projectId){
  const selected=await mailboxForDelivery(env,input.projectId,input.mailboxId)
  if(!selected)throw new HTTPException(409,{message:'Mailbox is no longer connected'})
  const mailboxInput={...input,projectId:input.projectId,mailboxId:input.mailboxId}
  if(selected.provider!=='forwarding')return (await sendViaMailbox(env,mailboxInput)).id
  const sender=await mailboxSender(env,mailboxInput)
  input={...input,text:sender.text,html:sender.html}
 }
 if(rerMail(env))return sendRerMail(env,input,holdable)
 if(selectedEmailProvider(env)==='sendgrid'){
  const receipt=await sendGridDelivery(env,input,from)
  return receipt.providerMessageId
 }
 const response=await notificationFetch(...providerRequest(env,input,from))
 if(!response.ok){await updateDelivery(env,input.idempotencyKey,response.status>=500?'uncertain':'failed',`Provider HTTP ${response.status}`);throw new HTTPException(502,{message:'Email provider rejected delivery'})}
 const receipt=providerReceipt(env,await response.json(),input.to)
 if(!receipt.accepted){await updateDelivery(env,input.idempotencyKey,'failed','Recipient permanently rejected');throw new HTTPException(502,{message:'Email recipient permanently rejected'})}
 return receipt.id
}
function sendGridFailure(error:unknown){
 if(!(error instanceof SendGridSendError))return null
 const failed=error.outcome==='rejected'||error.outcome==='rate_limited'
 return {state:failed?'failed' as const:'uncertain' as const,message:error.outcome==='rate_limited'?'Email provider rate limited delivery':failed?'Email provider rejected delivery':'Email delivery outcome unknown; reconcile before retrying'}
}
/** `hold` marks a command that outbox replay resends; `since` is the first
 * refusal instant of a held command being sent again. */
async function submitClaimed(env:Env,input:EmailInput,from:string,hold?:{since?:number}):Promise<EmailOutcome>{
 try{
  const guard=await mailClaimSql(env,input),claimed=guard.prefix||guard.sql!=='1=1'?await env.DB.prepare(`${guard.prefix}UPDATE email_deliveries SET updated_at=? WHERE id=? AND state='sending' AND ${guard.sql} RETURNING id`).bind(...guard.params,Date.now(),input.idempotencyKey).all():undefined;if(claimed&&!claimed.results.length){await updateDelivery(env,input.idempotencyKey,'failed','Knowledge access changed; edit and resend for the current recipients');return {id:null,state:'failed'}}
  input=await renderMail(env,input)
  // Only the durable delivery claimant takes rate capacity. Queue replay and
  // concurrent retries cannot charge or send the same first notice again.
  const first=/^message:([^:]+):notification$/.exec(input.idempotencyKey)
  // Preparation already identifies ordinary replies in its existing message read.
  // Only operator-created first messages need the live consent/rate lookup;
  // unrelated problem batches must retain their D1 request budget.
  if(first&&input.projectId&&input[operatorTicketMessage]!==false){
   const command=await env.DB.prepare(`SELECT ct.metadata_json FROM messages m
    JOIN operator_ticket_commands cmd ON cmd.project_id=m.project_id AND cmd.conversation_id=m.conversation_id AND cmd.local_id=m.local_id
    JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id
    JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id
    WHERE m.id=? AND m.project_id=?`).bind(first[1],input.projectId).first<{metadata_json:string}>()
   if(command){
    const flags=JSON.parse(command.metadata_json)
    if(['is_erasing','is_erased','is_deleted','is_blocked'].some(key=>flags[key])||flags.portal_notification_emails===0){
     await updateDelivery(env,input.idempotencyKey,'failed','Requester unavailable or email notices disabled')
     return {id:null,state:'failed'}
    }
    try{await enforceRateLimit(env,'outboundNoticesPerProjectMinute',input.projectId)}
    catch(error){
     if(!(error instanceof RateLimitExceeded))throw error
     await updateDelivery(env,input.idempotencyKey,'failed','Outbound notice rate limit reached; this notice was not sent. No automatic retry.')
     return {id:null,state:'failed'}
    }
   }
  }
  // In a demo copy the send is mocked: it completes with a provider id and nothing leaves.
  const providerId=await demoEffect(()=>sendThroughSelectedProvider(env,input,from,Boolean(hold)),()=>`demo_${crypto.randomUUID()}`)
  await updateDelivery(env,input.idempotencyKey,'sent',null,providerId)
  return {id:providerId,state:'sent',...(emailMode(env)==='local'?{mode:'local' as const}:{})}
 }catch(error){
  if(input.mailboxId){
   const mailbox=await env.DB.prepare('SELECT state FROM mailbox_sends WHERE id=? AND project_id=? AND mailbox_id=?').bind(input.idempotencyKey,input.projectId??null,input.mailboxId).first<{state:string}>()
   if(mailbox?.state==='failed'){await updateDelivery(env,input.idempotencyKey,'failed','Connected mailbox rejected delivery');throw error}
  }
  if(error instanceof RerMailFailure&&error.state==='held'){
   notificationSendSignal()
   await holdRerMail(env,input,hold?.since??Date.now())
   throw new HTTPException(503,{message:error.message})
  }
  const classified=error instanceof RerMailFailure&&error.state!=='held'?{state:error.state,message:error.message}:sendGridFailure(error)
  if(classified){
   await updateDelivery(env,input.idempotencyKey,classified.state,classified.message)
   throw new HTTPException(classified.state==='failed'?502:503,{message:classified.message})
  }
  await env.DB.prepare("UPDATE email_deliveries SET state='uncertain',error='Delivery outcome unknown',updated_at=? WHERE id=? AND state='sending'").bind(Date.now(),input.idempotencyKey).run()
  throw error
 }
}
async function suppressDevelopment(env:Env,input:EmailInput,from:string):Promise<EmailOutcome>{
 await sendDevelopment({provider:'development',mode:'development'},providerMessage(input,from))
 return {id:null,state:'suppressed',mode:'local'}
}
export async function sendEmail(env:Env,input:EmailInput,defer?:DeferEmailDelivery,holdable=false):Promise<EmailOutcome>{
 input=await canonicaliseMail(env,await prepareConversationEmail(env,input))
 if(!input.mailboxId&&!emailConfigured(env))throw new HTTPException(503,{message:'Email provider is not configured'})
 const from=await senderFor(env,input)
 validateEmailInput(input,from)
 if(localMailOrigin(env))return suppressDevelopment(env,await renderMail(env,input),from)
 const intentHash=await hashToken(JSON.stringify({...input,from})),existing=await env.DB.prepare('SELECT state,provider_id,intent_hash FROM email_deliveries WHERE id=?').bind(input.idempotencyKey).first<DeliveryRow>()
 if(existing){
  if(existing.intent_hash!==intentHash)throw new HTTPException(409,{message:'Email command identity conflict'})
  if(existing.state==='sent')return {id:existing.provider_id,state:'sent',...(emailMode(env)==='local'?{mode:'local' as const}:{})}
  throw new HTTPException(409,{message:`Email delivery ${existing.state}; reconcile before retrying`})
 }
 const now=Date.now(),guard=await mailClaimSql(env,input),claimed=await env.DB.prepare(`${guard.prefix}INSERT OR IGNORE INTO email_deliveries SELECT ?,?,?,?,?,'sending',NULL,NULL,?,? WHERE ${guard.sql}`).bind(...guard.params,input.idempotencyKey,input.projectId||null,input.to,input.subject,intentHash,now,now).run()
 if(!claimed.meta.changes){await env.DB.prepare("INSERT OR IGNORE INTO email_deliveries VALUES(?,?,?,?,?,'failed',NULL,'Knowledge access changed; edit and resend',?,?)").bind(input.idempotencyKey,input.projectId||null,input.to,input.subject,intentHash,now,now).run();throw new HTTPException(409,{message:'Knowledge access changed; edit and resend'})}
 const delivery=withNotificationSendWindow([input.idempotencyKey],now,()=>submitClaimed(env,input,from,holdable?{}:undefined))
 if(defer){defer(delivery);return {id:null,state:'sending'}}
 return delivery
}
/** Freeze the complete notification recipient set before any network effect. A
 * process lost after this transaction leaves sending outcomes for reconciliation,
 * never a partially reconstructed recipient list on automatic outbox replay. */
export async function sendEmails(env:Env,inputs:readonly EmailInput[],defer?:DeferEmailDelivery,holdable=false):Promise<EmailOutcome[]>{
 if(!inputs.length)return []
 inputs=await Promise.all(inputs.map(async input=>canonicaliseMail(env,await prepareConversationEmail(env,input))))
 if(inputs.some(input=>!input.mailboxId)&&!emailConfigured(env))throw new HTTPException(503,{message:'Email provider is not configured'})
 const prepared=await Promise.all(inputs.map(async input=>{const from=await senderFor(env,input);validateEmailInput(input,from);return {input,from,intentHash:await hashToken(JSON.stringify({...input,from}))}}))
 if(localMailOrigin(env))return Promise.all(prepared.map(async({input,from})=>suppressDevelopment(env,await renderMail(env,input),from)))
 const now=Date.now()
 // D1 batch is one transaction. A duplicate primary claim rolls back every
 // participant claim; only the process that owns the whole set may submit it.
 const guards=await Promise.all(prepared.map(({input})=>mailClaimSql(env,input)))
 await env.DB.batch(prepared.map(({input,intentHash},index)=>env.DB.prepare(`${guards[index].prefix}INSERT INTO email_deliveries SELECT ?,?,?,?,?,'sending',NULL,NULL,?,? WHERE ${guards[index].sql}`).bind(...guards[index].params,input.idempotencyKey,input.projectId||null,input.to,input.subject,intentHash,now,now)))
 const delivery=withNotificationSendWindow(prepared.map(({input})=>input.idempotencyKey),now,()=>Promise.all(prepared.map(async({input,from})=>{
  try{return {...await submitClaimed(env,input,from,holdable?{}:undefined),recipient:input.to}}
  catch(error){
   const row=await env.DB.prepare('SELECT state,provider_id,recipient FROM email_deliveries WHERE id=?').bind(input.idempotencyKey).first<{state:string;provider_id:string|null;recipient:string}>()
   if(!row)throw error
   return {state:row.state,id:row.provider_id,recipient:row.recipient}
  }
 })))
 // A deferred acknowledgement represents the entire immutable recipient set.
 // No provider request starts until the all-or-nothing claim above commits.
 if(defer){defer(delivery);return prepared.map(({input})=>({id:null,state:'sending',recipient:input.to}))}
 return delivery
}
/** Replay resends each held command among `inputs` once: the same identity, and so
 * the same messageKey, to its recorded recipient. Nothing else is ever sent again. */
export async function resendHeldEmails(env:Env,inputs:readonly EmailInput[]){
 await Promise.all(inputs.map(async input=>{
  try{
   input=await canonicaliseMail(env,await prepareConversationEmail(env,input))
   const from=await senderFor(env,input)
   validateEmailInput(input,from)
   const started=Date.now(),since=await claimRerMailHold(env,input)
   if(since!==null)await withNotificationSendWindow([input.idempotencyKey],started,()=>submitClaimed(env,input,from,{since}))
  }catch{console.error('Held managed mail remains pending')}
 }))
}
