import {hashToken} from '../../platform/auth'
import type {Env} from '../../platform/env'
import type {EmailInput} from './email'
import {mailJson,mailService,rerSelected} from './rer-mail-contract'

/** The platform's owner-only relay (MAIL_PROVIDER=rer with MAIL_RECIPIENTS=owner): MAIL_RELAY_URL is
 * `<platform>/api/managed-mail/send` and MAIL_API_KEY its private installation credential; the relay chooses
 * the sender. Only a Business sender key limits recipients at the relay, so the binding guard is the local
 * owner check in src/modules/identity/owner-signin-mail.ts, which runs before every request. */
export const ownerRelayMail=(env:Env)=>env.MAIL_RECIPIENTS==='owner'&&rerSelected(env)
export function relayConfigured(env:Env){
 if(typeof env.MAIL_API_KEY!=='string'||!env.MAIL_API_KEY.trim())return false
 try{mailService(env.MAIL_RELAY_URL);return true}catch{return false}
}

/** Claim the attempt before sending. The receipt uses the existing error column for the HTTP status and
 * machine-readable error code; the recipient, subject and message are excluded from the stored fields. */
export async function sendRelayMail(env:Env,input:Pick<EmailInput,'to'|'subject'|'text'|'idempotencyKey'>){
 const relay=mailService(env.MAIL_RELAY_URL)
 const {idempotencyKey,to,subject,text}=input
 const body=JSON.stringify({to,subject,text}),intentHash=await hashToken(body),now=Date.now()
 const claim=await env.DB.prepare(`INSERT INTO email_deliveries
  (id,project_id,recipient,subject,intent_hash,state,provider_id,error,created_at,updated_at)
  VALUES(?,NULL,'','',?,'sending',NULL,NULL,?,?) ON CONFLICT(id) DO NOTHING`).bind(idempotencyKey,intentHash,now,now).run()
 if(!claim.meta.changes)throw new Error('relay_uncertain')

 let response:Response|undefined
 try{
  response=await fetch(relay,{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(20000)})
 }catch{
  console.error('Managed mail relay did not answer; delivery outcome unknown')
 }
 const status=response?.status
 const receipt=response?await mailJson(response).catch(()=>null) as {messageId?:unknown;error?:unknown}|null:null
 const state=status===202?'sent':status===undefined||status>=500?'uncertain':'failed'
 const key=env.MAIL_API_KEY?.trim()
 const safeReceiptField=(value:unknown,format:RegExp):value is string=>
  typeof value==='string'&&format.test(value)&&(!key||!value.includes(key))&&!value.toLowerCase().includes(to)&&!text.includes(value)
 const providerId=state==='sent'&&safeReceiptField(receipt?.messageId,/^[a-zA-Z0-9._:@<>=+-]{1,256}$/)?receipt.messageId:null
 const code=safeReceiptField(receipt?.error,/^[a-z][a-z0-9_]{0,95}$/)?receipt.error:null
 const outcome=status===undefined?'Relay did not answer':`Relay HTTP ${status}${code?' '+code:''}`
 try{
  await env.DB.prepare('UPDATE email_deliveries SET state=?,provider_id=?,error=?,updated_at=? WHERE id=?')
   .bind(state,providerId,outcome,Date.now(),idempotencyKey).run()
 }catch{
  console.error('Could not record the managed mail relay outcome')
  // Keep the link valid if the provider accepted the message or could still deliver it.
  throw new Error(state==='failed'?'relay_refused':'relay_uncertain')
 }
 if(state==='uncertain')throw new Error('relay_uncertain')
 if(state==='failed')throw new Error('relay_refused')
 return providerId
}
