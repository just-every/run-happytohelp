import type {Env} from '../../platform/env'
import {mailService,rerSelected} from './rer-mail-contract'

/** The platform's owner-only relay (MAIL_PROVIDER=rer with MAIL_RECIPIENTS=owner): MAIL_RELAY_URL is
 * `<platform>/api/managed-mail/send` and MAIL_API_KEY its private installation credential. The relay itself
 * refuses any `to` but the Business owner's verified address and chooses the sender. */
export const ownerRelayMail=(env:Env)=>env.MAIL_RECIPIENTS==='owner'&&rerSelected(env)
export function relayConfigured(env:Env){
 if(typeof env.MAIL_API_KEY!=='string'||!env.MAIL_API_KEY.trim())return false
 try{mailService(env.MAIL_RELAY_URL);return true}catch{return false}
}

/** One request, never redirected: the credential goes only to the configured HTTPS relay. HTTP 202 is sent;
 * anything else is a failure, logged by status alone (never the key, the address or the message). */
export async function sendRelayMail(env:Env,input:{to:string;subject:string;text:string}){
 let response:Response
 try{
  response=await fetch(mailService(env.MAIL_RELAY_URL),{method:'POST',redirect:'manual',headers:{Authorization:`Bearer ${env.MAIL_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({to:input.to,subject:input.subject,text:input.text}),signal:AbortSignal.timeout(20000)})
 }catch(error){
  console.error(`Managed mail relay unreachable (${error instanceof Error?error.name:'error'}); nothing was sent`)
  throw new Error('relay_unreachable')
 }
 if(response.status!==202){
  await response.body?.cancel()
  console.error(`Managed mail relay refused the message (${response.status}); nothing was sent`)
  throw new Error('relay_refused')
 }
 const receipt=await response.json().catch(()=>null) as {messageId?:unknown}|null
 return typeof receipt?.messageId==='string'?receipt.messageId:null
}
