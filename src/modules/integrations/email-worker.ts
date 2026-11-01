import {MAX_INBOUND_RAW_BYTES} from './email-limits'
import {knowledgeWriteEnvironment} from '../knowledge/write-boundary'
import {plainEmail} from './email-reply'
import {HTTPException} from 'hono/http-exception'
import {parseInboundMime,holdRawEmail} from './unreadable-email'
import type {Env} from '../../platform/env'
import {receiveEmail} from './inbound-service'
import {hashToken} from '../../platform/auth'
import {scheduleInboundEffects} from './inbound-effects'
import {emailEvidence} from './email-classification'
import {routingCandidates,authenticationVerdict,headerFromAddress} from './inbound-sender'
import {emailAddress} from './inbound-routing'
const addressList=(entries:any[]|undefined)=>(entries||[]).flatMap((entry:any)=>entry.group?entry.group.map((member:any)=>member.address):[entry.address]).filter(Boolean)
export async function handleEmail(message:ForwardableEmailMessage,env:Env,execution:ExecutionContext){
 env=knowledgeWriteEnvironment(env,()=>({}))

 const raw=await new Response(message.raw).arrayBuffer()
 // Size refusals keep their bytes in the same review/retention custody as
 // unreadable MIME. The envelope selects the workspace, never sender authority.
 if(message.rawSize>MAX_INBOUND_RAW_BYTES||raw.byteLength>MAX_INBOUND_RAW_BYTES){
  await holdRawEmail(env,raw,{recipients:[message.to],reason:'message_too_large',description:'This email exceeds the 25 MB receiving limit. Its original bytes are retained as original.eml.'})
  return
 }
 let parsed
 try{parsed=await parseInboundMime(env,raw,{recipients:[message.to]})}catch(error){
  if(error instanceof HTTPException&&error.status>=400&&error.status<500){message.setReject(error.message);return}throw error
 }
 if(!parsed)return
 // The header From is who wrote the message, verified by Cloudflare's own
 // Authentication-Results; the envelope sender (VERP, forwarding SRS, or empty for
 // bounces and auto-replies) is delivery metadata. Mail with no usable From is kept
 // under its envelope sender, as an unverified sender (inbound-service.ts).
 const envelopeFrom=String(message.from||'').trim(),headerFrom=headerFromAddress(parsed.headers),from=headerFrom||emailAddress(envelopeFrom)
 if(!from){message.setReject('Sender address required');return}
 // A subject-only email is its subject; only a message with nothing at all is refused.
 const body=plainEmail(parsed.text||'',parsed.html||'').trim()||(parsed.attachments.length?'':String(parsed.subject||'').trim());if(!body&&!parsed.attachments.length){message.setReject('A message body is required');return}
 const rawId=parsed.messageId||await hashToken(new TextDecoder().decode(raw)),messageId=rawId.length>200?await hashToken(rawId):rawId
 const verdict=authenticationVerdict(parsed.headers,headerFrom,envelopeFrom)
 const evidence=emailEvidence({envelopeFrom,headerFrom:parsed.from?.address,subject:parsed.subject,headers:parsed.headers})
 try{
 const result=await receiveEmail(env,{messageId,from,to:routingCandidates({envelope:[message.to],headers:parsed.headers,to:addressList(parsed.to)}),text:body,senderAuthenticated:verdict.verified,senderFailed:verdict.failed,fromUnusable:!headerFrom,replyTo:addressList(parsed.replyTo)[0],cc:addressList(parsed.cc),evidence,attachments:parsed.attachments.map(file=>({filename:file.filename||'attachment',contentType:file.mimeType,content:file.content as ArrayBuffer}))})
 scheduleInboundEffects(env,execution,result)
 }catch(error){
  // 409: this Message-ID already holds different content (another copy of mail
  // already received); a bounce would only tell the customer it failed. A 503 (an
  // earlier attempt may still be admitting it) and every other error is thrown, so
  // Email Routing answers with a temporary failure and the sender retries.
  if(error instanceof HTTPException&&error.status===409){console.error('Inbound email already received',error.message);return}
  if(error instanceof HTTPException&&error.status>=400&&error.status<500){message.setReject(error.message);return}
  throw error
 }
}
