import {Hono} from 'hono'
import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import {addressParser} from 'postal-mime'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {receiveEmail} from './inbound-service'
import {ClosedTicketRefusal,noticeMember} from './closed-ticket-mail'
import {scheduleInboundEffects} from './inbound-effects'
import {emailEvidence,type HeaderEntry} from './email-classification'
import {emailAddress} from './inbound-routing'
import {plainEmail} from './email-reply'
import {routingCandidates,mailgunVerdict,headerFromAddress,type SenderVerdict} from './inbound-sender'
import {mailgunSigningKey,verifyMailgunSignature} from './mailgun-signature'

/**
 * Mailgun route `forward()`: form-urlencoded, or multipart/form-data with attachments.
 * The forward is signed (mailgun-signature.ts), so the URL carries no secret. Mailgun
 * accepts only 200 and retries any other answer for 8 hours, so every mail that is
 * received, already received, held in Suspended or refused for good is answered 200;
 * everything else (an unconfigured address, a refusal that a later configuration could
 * change, a failure) frees the signature's token and answers its error.
 */
const maxBody=30*1024*1024,maxAttachments=1000
export interface MailgunMail {recipients:string[];from:string|null;sender:string;verdict:SenderVerdict;messageId:string;content:string;attachments:{filename:string;contentType:string;content:ArrayBuffer}[]}
/** Lets another module (partner replies) answer a mail before ordinary admission. It
 * returns the JSON answer, or nothing to leave the mail to ordinary admission. */
export type MailgunHook=(c:Context<AppEnv>,mail:MailgunMail)=>Promise<unknown>
const text=(form:FormData,name:string)=>{const value=form.get(name);return typeof value==='string'?value:''}
async function readForm(c:Context<AppEnv>){
 if(!/^(?:multipart\/form-data|application\/x-www-form-urlencoded)(?:;|$)/i.test(c.req.header('Content-Type')||''))throw new HTTPException(400,{message:'Mailgun inbound requires a form-encoded body'})
 if(Number(c.req.header('content-length')||0)>maxBody)throw new HTTPException(413,{message:'Inbound email exceeds 30 MB'})
 const reader=c.req.raw.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 if(reader)for(;;){
  const {value,done}=await reader.read();if(done)break
  size+=value.byteLength;if(size>maxBody){void reader.cancel().catch(()=>{});throw new HTTPException(413,{message:'Inbound email exceeds 30 MB'})}
  chunks.push(value)
 }
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{return await new Request(c.req.url,{method:'POST',headers:c.req.raw.headers,body:bytes}).formData()}catch{throw new HTTPException(400,{message:'Mailgun inbound body is not a valid form'})}
}
/** `message-headers`: a JSON list of [name, value] pairs in receipt order. */
function messageHeaders(value:string):HeaderEntry[]{
 if(!value)return []
 let parsed:unknown;try{parsed=JSON.parse(value.slice(0,262144))}catch{throw new HTTPException(400,{message:'Mailgun message-headers is not valid JSON'})}
 if(!Array.isArray(parsed))throw new HTTPException(400,{message:'Mailgun message-headers is not a list'})
 return parsed.flatMap(entry=>Array.isArray(entry)&&typeof entry[0]==='string'&&typeof entry[1]==='string'?[{key:entry[0],value:entry[1]}]:[])
}
const headerValues=(headers:HeaderEntry[],name:string)=>headers.filter(header=>typeof header.key==='string'&&header.key.trim().toLowerCase()===name).map(header=>String(header.value??''))
const mailboxes=(values:string[])=>values.flatMap(value=>{try{return addressParser(value)}catch{return []}}).flatMap(entry=>entry.group?entry.group.map(member=>member.address):[entry.address]).filter((value):value is string=>Boolean(value))
async function contentHash(content:ArrayBuffer){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content))).map(value=>value.toString(16).padStart(2,'0')).join('')
}

export function createMailgunInbound(partner?:MailgunHook){
 const router=new Hono<AppEnv>()
 router.post('/email/mailgun/inbound',async c=>{
  mailgunSigningKey(c.env)
  const form=await readForm(c)
  const release=await verifyMailgunSignature(c.env,{timestamp:text(form,'timestamp'),token:text(form,'token'),signature:text(form,'signature')})
  try{return await admit(c,form,partner)}
  catch(error){await release().catch(failure=>console.error('Mailgun token claim not released',failure));throw error}
 })
 return router
}

async function admit(c:Context<AppEnv>,form:FormData,partner?:MailgunHook){
 const headers=messageHeaders(text(form,'message-headers')),sender=text(form,'sender').trim(),subject=text(form,'subject')
 const attachments:MailgunMail['attachments']=[],count=Math.min(Math.max(Number.parseInt(text(form,'attachment-count'),10)||0,0),maxAttachments)
 for(let index=1;index<=count;index++){
  const file=form.get(`attachment-${index}`);if(!(file instanceof File))continue
  attachments.push({filename:(file.name||'attachment').slice(0,200),contentType:(file.type||'application/octet-stream').slice(0,200),content:await file.arrayBuffer()})
 }
 // The header From is who wrote the message, judged by Mailgun's SPF and DKIM verdicts; the envelope
 // sender is delivery metadata. Mail with no usable From is kept under its envelope sender, unverified.
 const headerFrom=headerFromAddress(headers,text(form,'from')),from=headerFrom||emailAddress(sender)
 if(!from)throw new HTTPException(400,{message:'Mailgun inbound payload has no sender'})
 const html=text(form,'body-html'),body=plainEmail(text(form,'body-plain'),html),content=body.trim()||(attachments.length?'':subject.trim())
 if(!content&&!attachments.length)throw new HTTPException(400,{message:'Mailgun inbound payload is missing a body'})
 const to=mailboxes(headerValues(headers,'to')),cc=mailboxes(headerValues(headers,'cc')),replyTo=mailboxes(headerValues(headers,'reply-to'))[0]
 const recipients=text(form,'recipient').split(',').map(value=>value.trim()).filter(Boolean)
 const verdict=mailgunVerdict({headers,envelopeFrom:sender,from:headerFrom})
 const evidence=emailEvidence({envelopeFrom:sender,headerFrom:text(form,'from'),subject,headers})
 const fallback=await hashToken(JSON.stringify({to:recipients,from,subject,content,cc,attachments:await Promise.all(attachments.map(async file=>({filename:file.filename,type:file.contentType,size:file.content.byteLength,hash:await contentHash(file.content)})))}))
 const rawId=headerValues(headers,'message-id')[0]?.trim()||fallback,messageId=rawId.length<=200?rawId:rawId.slice(0,200)
 const intercepted=await partner?.(c,{recipients:[...recipients,...to,...cc],from:headerFrom,sender,verdict,messageId,content:body||subject,attachments})
 if(intercepted!==undefined&&intercepted!==null)return c.json(intercepted,200)
 // One message may name several configured mailboxes; each project receives its copy.
 const targets=recipients.length?recipients:['']
 const results=[]
 let alreadyReceived=false,refused:ClosedTicketRefusal|null=null
 for(const recipient of targets){
  try{results.push(await receiveEmail(c.env,{messageId,to:routingCandidates({envelope:recipient?[recipient]:[],headers,to}),from,text:content,cc,replyTo,senderAuthenticated:verdict.verified,senderFailed:verdict.failed,fromUnusable:!headerFrom,evidence,attachments}))}
  catch(error){
   // 409: this Message-ID already holds this mailbox's copy. It is mail already received, so Mailgun gets its 200 and stops retrying.
   if(error instanceof HTTPException&&error.status===409){console.error('Inbound email already received',error.message);alreadyReceived=true;continue}
   // Mailgun cannot bounce: a member's reply to a Closed ticket is answered with a notice to them. The refusal is final, so it is a 200.
   if(error instanceof ClosedTicketRefusal){await noticeMember(c.env,error);refused=error;continue}
   if(!(error instanceof HTTPException&&error.status===404&&targets.length>1))throw error
  }
 }
 for(const result of results)scheduleInboundEffects(c.env,c.executionCtx,result)
 if(results.length)return c.json(results[0],200)
 if(refused)return c.json({state:'refused',reason:'ticket_closed'},200)
 if(alreadyReceived)return c.json({duplicate:true},200)
 throw new HTTPException(404,{message:'Inbound mailbox is not configured'})
}
