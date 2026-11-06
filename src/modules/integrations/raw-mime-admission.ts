import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {redactedMime} from './rer-mail-raw'
import {parseInboundMime,holdRawEmail} from './unreadable-email'
import {headerFromAddress,type SenderVerdict} from './inbound-sender'
import {emailAddress} from './inbound-routing'
import {plainEmail} from './email-reply'
import {emailEvidence,type HeaderEntry} from './email-classification'
import {receiveEmail} from './inbound-service'
import {ClosedTicketRefusal,noticeMember} from './closed-ticket-mail'

const addresses=(list:any[]|undefined):string[]=>(list||[]).flatMap(value=>value.group?addresses(value.group):value.address?[value.address]:[])
type HoldContext=Parameters<typeof holdRawEmail>[2]
export interface RawMimeAdmission {
 raw:Uint8Array
 /** The recipients that route the mail, in order: the first configured mailbox selects the workspace. */
 to:readonly string[]
 /** The ingress's verdict on the header From, or a function of it once the MIME is parsed (the header From is read
  * from the same parse that admits the mail, so the verdict and the author can never be about different Froms). */
 verdict:SenderVerdict|((parsed:{from:string|null;headers:HeaderEntry[]})=>SenderVerdict)
 /** The SMTP sender as the ingress recorded it; the author only when the header names none. */
 envelopeFrom:string
 /** Identity of a message that carries no Message-ID. */
 fallbackMessageId:string
 /** A thread the routing named, kept as the candidate when the mail is held. */
 conversationId?:string
 /** Where an unreadable or empty message is held. `reviewRaw` is always the redacted copy. */
 hold:Omit<NonNullable<HoldContext>,'reviewRaw'>
 /** Called with the author before admission, so custody names them even if admission is interrupted. */
 onSender?:(from:string)=>Promise<void>
}
/** The one admission of raw MIME mail: parse it, hold it when it is unreadable or empty, take the author, the text
 * and the Message-ID, and admit it through `receiveEmail`. A Closed ticket's refusal notices the member, and a 409 is
 * mail already held under another identity. Returns what `receiveEmail` returned, or the held outcome. */
export async function admitRawMime(env:Env,input:RawMimeAdmission):Promise<any>{
 const {raw}=input,review=redactedMime(raw)
 const parsed=await parseInboundMime(env,raw,{...input.hold,reviewRaw:review})
 if(!parsed)return {state:'held',reason:'message_unreadable'}
 const fromHeader=headerFromAddress(parsed.headers),from=fromHeader||emailAddress(input.envelopeFrom)
 const text=plainEmail(parsed.text||'',parsed.html||'').trim()||(parsed.attachments.length?'':String(parsed.subject||'').trim())
 if(!from||!text&&!parsed.attachments.length){
  await holdRawEmail(env,review,input.hold)
  return {state:'held',reason:'message_unreadable'}
 }
 await input.onSender?.(from)
 const rawId=parsed.messageId||input.fallbackMessageId,messageId=rawId.length>200?await hashToken(rawId):rawId
 const verdict=typeof input.verdict==='function'?input.verdict({from:fromHeader,headers:parsed.headers}):input.verdict
 return receiveEmail(env,{messageId,to:[...input.to],from,text,...(input.conversationId?{conversationId:input.conversationId}:{}),cc:addresses(parsed.cc),replyTo:addresses(parsed.replyTo)[0],senderAuthenticated:verdict.verified,senderFailed:verdict.failed,fromUnusable:!fromHeader,evidence:emailEvidence({envelopeFrom:input.envelopeFrom,headerFrom:parsed.from?.address,subject:parsed.subject,headers:parsed.headers}),attachments:parsed.attachments.map(file=>({filename:file.filename||'attachment',contentType:file.mimeType,content:file.content as ArrayBuffer}))}).catch(async error=>{
  if(error instanceof ClosedTicketRefusal){await noticeMember(env,error);return {state:'refused',reason:'closed_ticket'}}
  if(error instanceof HTTPException&&error.status===409)return {state:'held',reason:'message_identity_conflict'}
  throw error
 })
}
