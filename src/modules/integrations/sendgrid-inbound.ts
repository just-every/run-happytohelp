import {parseSendgridHeaders} from './sendgrid-unreadable'
import {plainEmail} from './email-reply'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {receiveEmail} from './inbound-service'
import {ClosedTicketRefusal,noticeMember} from './closed-ticket-mail'
import {scheduleInboundEffects} from './inbound-effects'
import {emailEvidence,headerBlockEntries} from './email-classification'
import {emailAddress} from './inbound-routing'
import {routingCandidates,sendGridVerdict,headerFromAddress} from './inbound-sender'

export const sendgridInbound=new Hono<AppEnv>()
const maxBody=30*1024*1024
function field(body:Record<string,unknown>,name:string):string{
 const value=body[name]
 return typeof value==='string'?value:Array.isArray(value)&&typeof value[0]==='string'?value[0]:''
}
function json(value:string){try{return JSON.parse(value) as any}catch{return null}}
function address(value:string){
 const parsed=json(value)
 if(parsed&&typeof parsed.email==='string')return parsed.email
 return value
}
function messageId(headers:string,fallback:string){
 const value=headers.match(/^Message-ID:\s*(.+)$/im)?.[1]?.trim()||fallback
 return value.length<=200?value:value.slice(0,200)
}
async function contentHash(content:ArrayBuffer){
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',content))).map(value=>value.toString(16).padStart(2,'0')).join('')
}
function authorizationToken(value:string|undefined){
 if(!value)return ''
 const bearer=value.match(/^Bearer\s+(.+)$/i)
 if(bearer)return bearer[1]
 const basic=value.match(/^Basic\s+(.+)$/i)
 if(!basic)return ''
 try{
  const decoded=atob(basic[1])
  const separator=decoded.indexOf(':')
  return separator<0?'':decoded.slice(separator+1)
 }catch{return ''}
}
async function authorized(c:any){
 const expected=typeof c.env.INBOUND_EMAIL_TOKEN==='string'?c.env.INBOUND_EMAIL_TOKEN:''
 if(!expected)return false
 const supplied=authorizationToken(c.req.header('Authorization'))||new URL(c.req.url).searchParams.get('token')||''
 const left=await hashToken(expected),right=await hashToken(supplied);let difference=0
 for(let index=0;index<left.length;index++)difference|=left.charCodeAt(index)^(right[index]||'').charCodeAt(0)
 return difference===0&&Boolean(supplied)
}
sendgridInbound.post('/email/sendgrid/inbound',async c=>{
 if(!await authorized(c))throw new HTTPException(403)
 const size=Number(c.req.header('content-length')||0);if(size>maxBody)throw new HTTPException(413,{message:'Inbound email exceeds 30 MB'})
 const source=c.req.raw.clone()
 const raw=await c.req.parseBody(),body=raw as Record<string,unknown>,envelope=json(field(body,'envelope'))||{},envelopeRecipients=(Array.isArray(envelope.to)?envelope.to:[]).map((value:unknown)=>address(String(value||''))),envelopeFrom=typeof envelope.from==='string'?envelope.from.trim():'',html=field(body,'html'),text=plainEmail(field(body,'text'),html)
 const info=json(field(body,'attachment-info'))||{},attachments=[]
 for(const [key,metadata] of Object.entries(info)){
  const file=body[key];if(!(file instanceof File))continue
  const record=metadata as any;attachments.push({filename:typeof record?.filename==='string'?record.filename.slice(0,200):file.name||'attachment',contentType:typeof record?.type==='string'?record.type.slice(0,200):file.type||'application/octet-stream',content:await file.arrayBuffer()})
 }
 // The header From is who wrote the message, verified by SendGrid's DKIM and SPF
 // verdicts; the envelope sender (VERP, forwarding SRS, or empty for bounces and
 // auto-replies) is delivery metadata. Reply-To is a reply target only. Mail with no
 // usable From is kept under its envelope sender, as an unverified sender.
 const headerBlock=field(body,'headers'),parsedHeaders=await parseSendgridHeaders(c.env,`${headerBlock.replace(/[\r\n]+$/,'')}\r\nTo: ${field(body,'to').replace(/[\r\n]/g,' ')}\r\nCc: ${field(body,'cc').replace(/[\r\n]/g,' ')}\r\n\r\n`,body,()=>source.arrayBuffer())
 if(!parsedHeaders)return c.json({state:'suspended',reason:'message_unreadable'},200)
 const headers=headerBlockEntries(headerBlock)
 const list=(entries:any[]|undefined)=>(entries||[]).flatMap((entry:any)=>entry.group?entry.group.map((member:any)=>member.address):[entry.address]).filter(Boolean) as string[]
 const headerFrom=headerFromAddress(parsedHeaders.headers,field(body,'from')),from=headerFrom||emailAddress(envelopeFrom)
 if(!from)throw new HTTPException(400,{message:'SendGrid inbound payload has no sender'})
 // A subject-only email is its subject; only a message with nothing at all is refused.
 const content=text.trim()||(attachments.length?'':field(body,'subject').trim())
 if(!content&&!attachments.length)throw new HTTPException(400,{message:'SendGrid inbound payload is missing a body'})
 const cc=list(parsedHeaders.cc),verdict=sendGridVerdict({dkim:field(body,'dkim'),spf:field(body,'SPF'),envelopeFrom,from:headerFrom})
 const evidence=emailEvidence({envelopeFrom,headerFrom:field(body,'from'),subject:field(body,'subject'),headers})
 const fallback=await hashToken(JSON.stringify({to:envelopeRecipients,from,subject:field(body,'subject'),content,cc,attachments:await Promise.all(attachments.map(async file=>({filename:file.filename,type:file.contentType,size:file.content.byteLength,hash:await contentHash(file.content)})))}))
 // One message may name several configured mailboxes; each project receives its copy.
 const targets=envelopeRecipients.filter(Boolean).length?envelopeRecipients.filter(Boolean):['']
 const results=[]
 let alreadyReceived=false
 for(const recipient of targets){
  try{results.push(await receiveEmail(c.env,{messageId:messageId(headerBlock,fallback),to:routingCandidates({envelope:recipient?[recipient]:[],headers,to:list(parsedHeaders.to)}),from,text:content,cc,replyTo:list(parsedHeaders.replyTo)[0],senderAuthenticated:verdict.verified,senderFailed:verdict.failed,fromUnusable:!headerFrom,evidence,attachments}))}
  catch(error){
   // 409: this Message-ID already holds this mailbox's copy, as when a reply-all names a reply address and the
   // bare mailbox. It is mail already received, as on the Worker path (email-worker.ts): no second write, and a
   // success so SendGrid stops retrying while the admitted copy keeps its live update and AI reply.
   if(error instanceof HTTPException&&error.status===409){console.error('Inbound email already received',error.message);alreadyReceived=true;continue}
   // SendGrid cannot bounce: a member's refused reply to a Closed ticket is answered with a notice to them.
   if(error instanceof ClosedTicketRefusal)await noticeMember(c.env,error)
   if(!(error instanceof HTTPException&&error.status===404&&targets.length>1))throw error
  }
 }
 for(const result of results)scheduleInboundEffects(c.env,c.executionCtx,result)
 if(!results.length){
  if(alreadyReceived)return c.json({duplicate:true},200)
  throw new HTTPException(404,{message:'Inbound mailbox is not configured'})
 }
 const result=results[0]
 return c.json(result,results.every(entry=>entry.duplicate)?200:201)
})
