import {emailAuthority,type EmailAuthority} from './email-authority'
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
import {prepareConversationEmail} from './email-preparation'
import {sendViaMailbox,mailboxSender} from './mailboxes/send'
import {mailboxForDelivery} from './mailboxes/store'

/** `headers` are extra message headers (loop suppression on notifications); like every
 * other field they are part of the delivery identity. */
export interface EmailAttachment {filename:string;content:string;contentType:string;contentId?:string}
export interface EmailInput {[emailAuthority]?:EmailAuthority;to:string;cc?:readonly string[];bcc?:readonly string[];mailboxId?:string;agentId?:string;fromAddress?:string;subject:string;text:string;html?:string;attachments?:readonly EmailAttachment[];projectId?:string;idempotencyKey:string;replyTo?:string;headers?:Readonly<Record<string,string>>}
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
 const senderAddress=sender?.from_address||String(env.EMAIL_FROM||'')
 return sender?.from_name?`${sender.from_name.replace(/[\r\n"<>]/g,'')} <${String(senderAddress).match(/<([^>]+)>/)?.[1]||senderAddress}>`:senderAddress
}
async function updateDelivery(env:Env,id:string,state:'sent'|'failed'|'uncertain',error:string|null,providerId:string|null=null){
 await env.DB.prepare('UPDATE email_deliveries SET state=?,provider_id=coalesce(?,provider_id),error=?,updated_at=? WHERE id=?').bind(state,providerId,error,Date.now(),id).run()
}
async function sendThroughSelectedProvider(env:Env,input:EmailInput,from:string):Promise<string|null>{
 if(input.mailboxId&&input.projectId){
  const selected=await mailboxForDelivery(env,input.projectId,input.mailboxId)
  if(!selected)throw new HTTPException(409,{message:'Mailbox is no longer connected'})
  const mailboxInput={...input,projectId:input.projectId,mailboxId:input.mailboxId}
  if(selected.provider!=='forwarding')return (await sendViaMailbox(env,mailboxInput)).id
  const sender=await mailboxSender(env,mailboxInput)
  input={...input,text:sender.text,html:sender.html}
 }
 if(selectedEmailProvider(env)==='sendgrid'){
  const receipt=await sendGridDelivery(env,input,from)
  return receipt.providerMessageId
 }
 const response=await fetch(...providerRequest(env,input,from))
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
async function submitClaimed(env:Env,input:EmailInput,from:string):Promise<EmailOutcome>{
 try{
  // In a demo copy the send is mocked: it completes with a provider id and nothing leaves.
  const providerId=await demoEffect(()=>sendThroughSelectedProvider(env,input,from),()=>`demo_${crypto.randomUUID()}`)
  await updateDelivery(env,input.idempotencyKey,'sent',null,providerId)
  return {id:providerId,state:'sent',...(emailMode(env)==='local'?{mode:'local' as const}:{})}
 }catch(error){
  if(input.mailboxId){
   const mailbox=await env.DB.prepare('SELECT state FROM mailbox_sends WHERE id=? AND project_id=? AND mailbox_id=?').bind(input.idempotencyKey,input.projectId??null,input.mailboxId).first<{state:string}>()
   if(mailbox?.state==='failed'){await updateDelivery(env,input.idempotencyKey,'failed','Connected mailbox rejected delivery');throw error}
  }
  const classified=sendGridFailure(error)
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
export async function sendEmail(env:Env,input:EmailInput,defer?:DeferEmailDelivery):Promise<EmailOutcome>{
 input=await prepareConversationEmail(env,input)
 if(!input.mailboxId&&!emailConfigured(env))throw new HTTPException(503,{message:'Email provider is not configured'})
 const from=await senderFor(env,input)
 validateEmailInput(input,from)
 if(localMailOrigin(env))return suppressDevelopment(env,input,from)
 const intentHash=await hashToken(JSON.stringify({...input,from})),existing=await env.DB.prepare('SELECT state,provider_id,intent_hash FROM email_deliveries WHERE id=?').bind(input.idempotencyKey).first<DeliveryRow>()
 if(existing){
  if(existing.intent_hash!==intentHash)throw new HTTPException(409,{message:'Email command identity conflict'})
  if(existing.state==='sent')return {id:existing.provider_id,state:'sent',...(emailMode(env)==='local'?{mode:'local' as const}:{})}
  throw new HTTPException(409,{message:`Email delivery ${existing.state}; reconcile before retrying`})
 }
 const now=Date.now(),claimed=await env.DB.prepare(`INSERT OR IGNORE INTO email_deliveries SELECT ?,?,?,?,?,'sending',NULL,NULL,?,? WHERE ${input[emailAuthority]?.sql??'1'}`).bind(input.idempotencyKey,input.projectId||null,input.to,input.subject,intentHash,now,now,...(input[emailAuthority]?.params??[])).run()
 if(!claimed.meta.changes)throw new HTTPException(409)
 const delivery=submitClaimed(env,input,from)
 if(defer){defer(delivery);return {id:null,state:'sending'}}
 return delivery
}
/** Freeze the complete notification recipient set before any network effect. A
 * process lost after this transaction leaves sending outcomes for reconciliation,
 * never a partially reconstructed recipient list on automatic outbox replay. */
export async function sendEmails(env:Env,inputs:readonly EmailInput[],defer?:DeferEmailDelivery):Promise<EmailOutcome[]>{
 if(!inputs.length)return []
 inputs=await Promise.all(inputs.map(input=>prepareConversationEmail(env,input)))
 if(inputs.some(input=>!input.mailboxId)&&!emailConfigured(env))throw new HTTPException(503,{message:'Email provider is not configured'})
 const prepared=await Promise.all(inputs.map(async input=>{const from=await senderFor(env,input);validateEmailInput(input,from);return {input,from,intentHash:await hashToken(JSON.stringify({...input,from}))}}))
 if(localMailOrigin(env))return Promise.all(prepared.map(({input,from})=>suppressDevelopment(env,input,from)))
 const now=Date.now()
 // D1 batch is one transaction. A duplicate primary claim rolls back every
 // participant claim; only the process that owns the whole set may submit it.
 const guards=prepared.map(({input})=>input[emailAuthority]).filter((guard):guard is EmailAuthority=>!!guard),authority=guards.length?guards.map(guard=>`(${guard.sql})`).join(' AND '):'1',args=guards.flatMap(guard=>guard.params)
 const claims=await env.DB.batch(prepared.map(({input,intentHash})=>env.DB.prepare(`INSERT INTO email_deliveries SELECT ?,?,?,?,?,'sending',NULL,NULL,?,? WHERE ${authority}`).bind(input.idempotencyKey,input.projectId||null,input.to,input.subject,intentHash,now,now,...args)))
 if(claims.some(claim=>!claim.meta.changes))throw new HTTPException(409,{message:'Notification consent or sending authority changed'})
 const delivery=Promise.all(prepared.map(async({input,from})=>{
  try{return {...await submitClaimed(env,input,from),recipient:input.to}}
  catch(error){
   const row=await env.DB.prepare('SELECT state,provider_id,recipient FROM email_deliveries WHERE id=?').bind(input.idempotencyKey).first<{state:string;provider_id:string|null;recipient:string}>()
   if(!row)throw error
   return {state:row.state,id:row.provider_id,recipient:row.recipient}
  }
 }))
 // A deferred acknowledgement represents the entire immutable recipient set.
 // No provider request starts until the all-or-nothing claim above commits.
 if(defer){defer(delivery);return prepared.map(({input})=>({id:null,state:'sending',recipient:input.to}))}
 return delivery
}
