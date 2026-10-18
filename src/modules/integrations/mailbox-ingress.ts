import PostalMime from 'postal-mime'
import type {Env} from '../../platform/env'
import type {MailboxIncoming} from './mailboxes'
import {receiveEmail,type IncomingEmail} from './inbound-service'
import {emailEvidence} from './email-classification'
import {headerFromAddress} from './inbound-sender'
import {mailboxAuthentication} from './mailboxes/authentication'
import {plainEmail} from './email-reply'
import {emailAddress} from './inbound-routing'
import {hashToken} from '../../platform/auth'
import {onCustomerMessage} from '../ai-support/service'
import {HTTPException} from 'hono/http-exception'
import {ClosedTicketRefusal,noticeMember} from './closed-ticket-mail'
import {suspendRefusedEmail} from './refused-email'

/** Provider delivery authenticates access to this inbox, not the header From.
 * Only its receiving server's alignment result can authenticate that author. */
export async function receiveMailboxMessage(env:Env,message:MailboxIncoming){
 const identity=await hashToken(message.mailboxId+':'+message.providerMessageId)
 if(message.unavailableReason){
  await suspendRefusedEmail(env,{messageId:identity,from:'unknown@invalid.example',to:message.address,text:`This ${message.provider} message exceeds the email size limit. Its content and attachments remain in the connected mailbox ${message.address}. Open provider message ${message.providerMessageId} there to read it.`,senderAuthenticated:false},
   {projectId:message.projectId,identity,reason:message.unavailableReason})
  return
 }
 const parsed=await PostalMime.parse(message.raw,{attachmentEncoding:'arraybuffer'}),from=headerFromAddress(parsed.headers),envelope=emailAddress(parsed.returnPath)||from
 const author=from||envelope||'unknown@invalid.example'
 const verdict=mailboxAuthentication(env,message.provider,parsed.headers,from,envelope||'')
 const evidence=emailEvidence({envelopeFrom:envelope||'',headerFrom:from,subject:parsed.subject,headers:parsed.headers})
 const addresses=(entries:any[]|undefined):string[]=>(entries||[]).flatMap(entry=>entry.group?addresses(entry.group):entry.address?[entry.address]:[])
 const rawId=parsed.messageId||`<mailbox.${await hashToken(message.mailboxId+':'+message.providerMessageId)}@happytohelp.invalid>`
 const input:IncomingEmail={messageId:rawId.length>200?await hashToken(rawId):rawId,from:author,to:[message.address,...addresses(parsed.to)],cc:addresses(parsed.cc),replyTo:addresses(parsed.replyTo)[0],text:plainEmail(parsed.text||'',parsed.html||'').trim()||parsed.subject||'(Empty email)',senderAuthenticated:verdict.verified,senderFailed:verdict.failed,fromUnusable:!from,evidence,attachments:parsed.attachments.map(file=>({filename:file.filename||'attachment',contentType:file.mimeType,content:file.content as ArrayBuffer}))}
 const result=await receiveEmail(env,input).catch(async error=>{
  if(error instanceof ClosedTicketRefusal&&error.notice){
   // A provider inbox cannot bounce. Do not consume its copy until the same
   // receipt-keyed notice used by the gateway and SendGrid has succeeded.
   try{await noticeMember(env,error,message.mailboxId)}catch{throw new HTTPException(503,{message:'Closed-ticket notice needs delivery reconciliation'})}
  }else if(error instanceof HTTPException&&[400,413,422].includes(error.status)){
   await suspendRefusedEmail(env,input,{projectId:message.projectId,identity,reason:error instanceof ClosedTicketRefusal?'closed_ticket_unverified':'message_refused'})
  }
  throw error
 })
 if(!result.duplicate&&'message' in result&&result.message&&'actor' in result&&result.actor&&!result.automatic)await onCustomerMessage(env,result.message,result.actor)
}
