import type {Env} from '../../platform/env'
import {mailService,rerSelected} from './rer-mail-contract'

/** The platform's owner-only relay (MAIL_PROVIDER=rer with MAIL_RECIPIENTS=owner): MAIL_RELAY_URL is
 * `<platform>/api/managed-mail/send` and MAIL_API_KEY its private installation credential; the relay chooses
 * the sender. Only a Business sender key limits recipients at the relay, so the binding guard is the local
 * owner check in src/modules/identity/owner-signin-mail.ts, which runs before every request. */
export const ownerRelayMail=(env:Env)=>env.MAIL_RECIPIENTS==='owner'&&rerSelected(env)
export function relayConfigured(env:Env){
 if(typeof env.MAIL_API_KEY!=='string'||!env.MAIL_API_KEY.trim())return false
 try{mailService(env.MAIL_RELAY_URL);return true}catch{return false}
}

/** One request, never redirected: the credential goes only to the configured HTTPS relay. HTTP 202 is sent.
 * A fetch error, timeout or 5xx leaves the outcome unknown (the relay may still deliver): `relay_uncertain`.
 * Any other answer is a refusal and nothing was sent: `relay_refused`. Logged by status alone (never the key,
 * the address or the message). */
export async function sendRelayMail(env:Env,input:{to:string;subject:string;text:string}){
 const relay=mailService(env.MAIL_RELAY_URL)
 let response:Response
 try{
  response=await fetch(relay,{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({to:input.to,subject:input.subject,text:input.text}),signal:AbortSignal.timeout(20000)})
 }catch(error){
  console.error(`Managed mail relay did not answer (${error instanceof Error?error.name:'error'}); delivery outcome unknown`)
  throw new Error('relay_uncertain')
 }
 if(response.status!==202){
  await response.body?.cancel()
  if(response.status>=500){
   console.error(`Managed mail relay could not confirm the message (${response.status}); delivery outcome unknown`)
   throw new Error('relay_uncertain')
  }
  console.error(`Managed mail relay refused the message (${response.status}); nothing was sent`)
  throw new Error('relay_refused')
 }
 const receipt=await response.json().catch(()=>null) as {messageId?:unknown}|null
 return typeof receipt?.messageId==='string'?receipt.messageId:null
}
