import PostalMime from 'postal-mime'
import type {Env} from '../../platform/env'
import type {MailboxIncoming} from './mailboxes'
import {receiveEmail} from './inbound-service'
import {emailEvidence} from './email-classification'
import {headerFromAddress} from './inbound-sender'
import {mailboxAuthentication} from './mailboxes/authentication'
import {plainEmail} from './email-reply'
import {emailAddress} from './inbound-routing'
import {hashToken} from '../../platform/auth'
import {onCustomerMessage} from '../ai-support/service'

/** Provider delivery authenticates access to this inbox, not the header From.
 * Only its receiving server's alignment result can authenticate that author. */
export async function receiveMailboxMessage(env:Env,message:MailboxIncoming){
 const parsed=await PostalMime.parse(message.raw,{attachmentEncoding:'arraybuffer'}),from=headerFromAddress(parsed.headers),envelope=emailAddress(parsed.returnPath)||from
 const author=from||envelope||'unknown@invalid.example'
 const verdict=mailboxAuthentication(env,message.provider,parsed.headers,from,envelope||'')
 const evidence=emailEvidence({envelopeFrom:envelope||'',headerFrom:from,subject:parsed.subject,headers:parsed.headers})
 const addresses=(entries:any[]|undefined):string[]=>(entries||[]).flatMap(entry=>entry.group?addresses(entry.group):entry.address?[entry.address]:[])
 const rawId=parsed.messageId||`<mailbox.${await hashToken(message.mailboxId+':'+message.providerMessageId)}@happytohelp.invalid>`
 const result=await receiveEmail(env,{messageId:rawId.length>200?await hashToken(rawId):rawId,from:author,to:[message.address,...addresses(parsed.to)],cc:addresses(parsed.cc),replyTo:addresses(parsed.replyTo)[0],text:plainEmail(parsed.text||'',parsed.html||'').trim()||parsed.subject||'(Empty email)',senderAuthenticated:verdict.verified,senderFailed:verdict.failed,fromUnusable:!from,evidence,attachments:parsed.attachments.map(file=>({filename:file.filename||'attachment',contentType:file.mimeType,content:file.content as ArrayBuffer}))})
 if(!result.duplicate&&'message' in result&&result.message&&'actor' in result&&result.actor&&!result.automatic)await onCustomerMessage(env,result.message,result.actor)
}
