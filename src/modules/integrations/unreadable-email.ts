import PostalMime from 'postal-mime'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {receivingMailbox} from './inbound-receiving'
import type {HeldEmailCustody} from './suspended-store'
import {suspendRefusedEmail} from './refused-email'
import type {IncomingEmail} from './inbound-service'

type RawEmail=ArrayBuffer|Uint8Array
interface HoldContext {
 reviewRaw?:RawEmail;recipients:string[];projectId?:string;identity?:string;description?:string
 reason?:string;attachments?:IncomingEmail['attachments'];senderAddress?:string;candidateId?:string|null;custody?:HeldEmailCustody
}
/** Unreadable bytes establish neither an author nor a thread. Only the receiving
 * envelope or an already authenticated mailbox may select their workspace.
 * Original receipt identity can link a refused copy for erasure, never admission. */
export async function holdRawEmail(env:Env,raw:RawEmail|null,context:HoldContext){
 const received=context.projectId?null:await receivingMailbox(env,context.recipients)
 const projectId=context.projectId||received?.project.project_id
 if(!projectId)throw new HTTPException(404,{message:'Inbound mailbox is not configured'})
 const content=raw?Uint8Array.from(raw instanceof Uint8Array?raw:new Uint8Array(raw)).buffer:null
 const identity=context.identity||Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content!))).map(value=>value.toString(16).padStart(2,'0')).join('')
 await suspendRefusedEmail(env,{messageId:identity,from:context.senderAddress||'unknown@invalid.example',to:context.recipients,
  text:context.description||'This email could not be read. Its original bytes are retained as original.eml.',senderAuthenticated:false,
  attachments:[...(content?[{filename:'original.eml',contentType:'message/rfc822',content}]:[]),...(context.attachments||[])]},
  {projectId,identity,reason:context.reason||'message_unreadable',candidateId:context.candidateId,custody:context.custody})
}
/** Catch only the MIME parser. A failed durable hold must still fail delivery. */
export async function parseInboundMime(env:Env,raw:RawEmail,context:HoldContext){
 let parsed
 try{parsed=await PostalMime.parse(raw,{attachmentEncoding:'arraybuffer'})}catch{
  await holdRawEmail(env,context.reviewRaw||raw,context)
  return null
 }
 return parsed
}
