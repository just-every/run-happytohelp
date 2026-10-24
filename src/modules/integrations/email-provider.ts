import {rerMail} from './rer-mail-contract'
import {rerConfigured} from './rer-mail'
import type {Env} from '../../platform/env'
import {demoMode} from '../../demo/mode'
import {localMailOrigin} from '../../edition/local-mail/configuration'
import type {EmailInput} from './email'
// @ts-expect-error The maintained Base adapter is JavaScript without declarations.
import {sendSendGrid} from '../../vendor/base/modules/mail/src/adapters/sendgrid/index.mjs'
import {SendGridSendError} from '../../vendor/base/modules/sendgrid-email/src/sender'
// @ts-expect-error The shared Base validator is JavaScript without declarations.
import {validateMessage} from '../../vendor/base/modules/mail/src/core/validation.mjs'

export type EmailProvider = 'resend'|'cloudflare'|'sendgrid'|'rer'
const providers:readonly EmailProvider[]=['resend','cloudflare','sendgrid']

/** The selected provider is explicit when supplied; the legacy default remains Resend. */
export function selectedEmailProvider(env:Env):EmailProvider|null{
 if(rerMail(env))return 'rer'
 const value=String(env.EMAIL_PROVIDER||'resend') as EmailProvider
 return providers.includes(value)?value:null
}
export function emailConfigured(env:Env){
 if(rerMail(env))return rerConfigured(env)
 if(typeof env.H2H_CONNECTED_MESSAGE_MAILBOX==='string')return true
 if(localMailOrigin(env)||demoMode(env))return typeof env.EMAIL_FROM==='string'&&Boolean(env.EMAIL_FROM.trim())
 const provider=selectedEmailProvider(env)
 return Boolean(provider&&typeof env.EMAIL_API_KEY==='string'&&env.EMAIL_API_KEY.trim()&&typeof env.EMAIL_FROM==='string'&&env.EMAIL_FROM.trim()&&(provider!=='cloudflare'||/^[a-f0-9]{32}$/i.test(String(env.EMAIL_ACCOUNT_ID||''))))
}
export function emailMode(env:Env):'local'|'remote'|'unavailable'{return emailConfigured(env)?localMailOrigin(env)?'local':'remote':'unavailable'}
function namedAddress(from:string){
 const named=from.match(/^(.*?)\s*<([^>]+)>$/)
 return named?{name:named[1].trim(),address:named[2]}:from
}
export function providerMessage(input:EmailInput,from:string){
 return {from,to:[input.to],...(input.cc?.length?{cc:[...input.cc]}:{}),...(input.bcc?.length?{bcc:[...input.bcc]}:{}),subject:input.subject,text:input.text,...(input.html?{html:input.html}:{}),...(input.replyTo?{replyTo:input.replyTo}:{}),...(input.headers?{headers:input.headers}:{}),...(input.attachments?.length?{attachments:input.attachments.map(file=>({filename:file.filename,contentType:file.contentType,content:Uint8Array.from(atob(file.content),char=>char.charCodeAt(0)),...(file.contentId?{contentId:file.contentId,disposition:'inline' as const}:{})}))}:{}),deliveryId:input.idempotencyKey}
}
export function validateEmailInput(input:EmailInput,from:string){
 if(new TextEncoder().encode(JSON.stringify(input)).byteLength>24*1024*1024)throw new Error('Email content exceeds the total size limit')
 validateMessage(providerMessage(input,from))
}
export function providerRequest(env:Env,input:EmailInput,from:string):[string,RequestInit]{
 const provider=selectedEmailProvider(env)
 if(!provider||provider==='sendgrid'||provider==='rer')throw new Error('The selected provider has no Resend or Cloudflare request adapter')
 const cloudflare=provider==='cloudflare'
 return [cloudflare?`https://api.cloudflare.com/client/v4/accounts/${env.EMAIL_ACCOUNT_ID}/email/sending/send`:'https://api.resend.com/emails',{
  method:'POST',headers:{Authorization:`Bearer ${env.EMAIL_API_KEY}`,'Content-Type':'application/json',...(!cloudflare?{'Idempotency-Key':input.idempotencyKey}:{})},
  // Cloudflare Email Sending restricts custom headers to an allow-list that has not been
  // verified for Auto-Submitted, so extra headers are sent through Resend and SendGrid only.
  body:JSON.stringify({from:cloudflare?namedAddress(from):from,to:[input.to],...(input.cc?.length?{cc:[...input.cc]}:{}),...(input.bcc?.length?{bcc:[...input.bcc]}:{}),subject:input.subject,text:input.text,...(input.html?{html:input.html}:{}),...(input.attachments?.length?{attachments:input.attachments.map(file=>cloudflare?{filename:file.filename,content:file.content,type:file.contentType,disposition:file.contentId?'inline':'attachment',...(file.contentId?{content_id:file.contentId}:{})}:{filename:file.filename,content:file.content,content_type:file.contentType,...(file.contentId?{content_id:file.contentId}:{})})}:{}),...(input.replyTo?{reply_to:input.replyTo}:{}),...(!cloudflare&&input.headers&&Object.keys(input.headers).length?{headers:input.headers}:{})}),signal:AbortSignal.timeout(20000),
 }]
}
export async function sendGridDelivery(env:Env,input:EmailInput,from:string){
 const result=await sendSendGrid({provider:'sendgrid',mode:'production',apiKey:String(env.EMAIL_API_KEY)},providerMessage(input,from),{timeoutMilliseconds:20000})
 if(result.status==='accepted')return {providerMessageId:result.providerMessageId as string|null}
 throw new SendGridSendError(result.status==='rejected'?'rejected':result.status==='rate_limited'?'rate_limited':'ambiguous','Email provider did not accept delivery')
}
export function providerReceipt(env:Env,body:unknown,recipient:string):{accepted:boolean;id:string|null}{
 const data=body as {id?:string;success?:boolean;result?:{delivered?:string[];queued?:string[];permanent_bounces?:string[]}}
 if(selectedEmailProvider(env)!=='cloudflare'){
  if(typeof data?.id!=='string'||!data.id)throw new Error('Provider omitted delivery identity')
  return {accepted:true,id:data.id}
 }
 // Cloudflare REST returns recipient outcomes, not a provider message ID.
 // The durable local command remains the replay fence, including lost responses.
 if(data?.success!==true||!data.result)throw new Error('Email provider outcome unknown')
 if(data.result.permanent_bounces?.includes(recipient))return {accepted:false,id:null}
 if(data.result.delivered?.includes(recipient)||data.result.queued?.includes(recipient))return {accepted:true,id:null}
 throw new Error('Email provider omitted recipient outcome')
}
