import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import PostalMime,{addressParser} from 'postal-mime'
import type {AppEnv,Env} from '../../platform/env'
import {inboundEmail as ordinaryInbound} from '../integrations/inbound'
import {handleEmail as ordinaryHandleEmail} from '../integrations/email-worker'
import {inboundTarget} from '../integrations/inbound-routing'
import {plainEmail} from '../integrations/email-reply'
import {headerFromAddress,sendGridVerdict,authenticationVerdict} from '../integrations/inbound-sender'
import {hashToken} from '../../platform/auth'
import {partnerGrant,receivePartnerReply} from './partner-reply'

const addresses=(value:string)=>addressParser(value).flatMap(entry=>entry.group?entry.group.map(member=>member.address):[entry.address]).filter((v):v is string=>Boolean(v))
async function selectedGrant(env:Env,recipients:unknown[]){
 const found=new Map<string,{grant:any;token:string;mailbox:string}>()
 for(const value of recipients.slice(0,50)){
  const candidate=inboundTarget(value)
  if(!candidate?.replyToken)continue
  const grant=await partnerGrant(env,candidate.replyToken)
  if(!grant)continue
  const mailbox=await env.DB.prepare('SELECT 1 FROM email_settings WHERE project_id=? AND lower(inbound_address)=? AND is_enabled=1').bind(grant.project_id,candidate.mailbox).first()
  if(!mailbox)throw new HTTPException(403,{message:'Partner reply mailbox is no longer active'})
  found.set(grant.id,{grant,token:candidate.replyToken,mailbox:candidate.mailbox})
 }
 if(found.size>1)throw new HTTPException(400,{message:'Reply to one partner thread at a time'})
 return [...found.values()][0]
}
async function deliver(env:Env,selected:NonNullable<Awaited<ReturnType<typeof selectedGrant>>>,input:{messageId:string;sender:string;content:string;senderFailed?:boolean;attachments?:{filename:string;contentType:string;content:ArrayBuffer}[]}){
 return receivePartnerReply(env,{projectId:selected.grant.project_id,conversationId:selected.grant.conversation_id,replyToken:selected.token,sender:input.sender,localId:input.messageId,content:input.content,senderFailed:input.senderFailed,attachments:input.attachments})
}
async function authorized(c:any,sendgrid=false){
 const expected=c.env.INBOUND_EMAIL_TOKEN
 if(typeof expected!=='string'||!expected)throw new HTTPException(403)
 let supplied=c.req.header('Authorization')?.replace(/^Bearer /i,'')||''
 if(sendgrid){
  if(/^Basic /i.test(supplied)){try{supplied=atob(supplied.slice(6)).split(':').slice(1).join(':')}catch{supplied=''}}
  supplied=supplied||new URL(c.req.url).searchParams.get('token')||''
 }
 if(!supplied||await hashToken(supplied)!==await hashToken(expected))throw new HTTPException(403)
}
async function boundedClone(request:Request){
 const reader=request.clone().body?.getReader();if(!reader)return new Uint8Array()
 const chunks:Uint8Array[]= [];let size=0
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>30*1024*1024){void reader.cancel().catch(()=>{});throw new HTTPException(413,{message:'Inbound email exceeds 30 MB'})}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes
}
/** Exact issued partner grants are intercepted; ordinary ingestion is unchanged. */
export const inboundEmail=new Hono<AppEnv>()
inboundEmail.use('/email/inbound',async(c,next)=>{
 if(c.req.method!=='POST')return next()
 await authorized(c)
 const body=JSON.parse(new TextDecoder().decode(await boundedClone(c.req.raw)))
 const selected=await selectedGrant(c.env,[...([].concat(body.to||[]) as unknown[]),...([].concat(body.cc||[]) as unknown[])])
 if(!selected)return next()
 const result=await deliver(c.env,selected,{messageId:body.messageId,sender:body.from,content:body.text,senderFailed:body.senderFailed})
 return c.json(result,result?.duplicate?200:201)
})
inboundEmail.use('/email/sendgrid/inbound',async(c,next)=>{
 if(c.req.method!=='POST')return next()
 await authorized(c,true)
 if(!/^(?:multipart\/form-data|application\/x-www-form-urlencoded)(?:;|$)/i.test(c.req.header('Content-Type')||''))throw new HTTPException(400,{message:'SendGrid inbound requires a form-encoded body'})
 const bytes=await boundedClone(c.req.raw),form=await new Request(c.req.url,{method:'POST',headers:c.req.raw.headers,body:bytes}).formData()
 const field=(key:string)=>typeof form.get(key)==='string'?String(form.get(key)):''
 let envelope:any={};try{envelope=JSON.parse(field('envelope')||'{}')}catch{}
 const headers=field('headers'),parsed=await PostalMime.parse(`${headers}\r\n\r\n`)
 const recipients=[...(Array.isArray(envelope.to)?envelope.to:[]),...addresses(field('to')),...addresses(field('cc'))]
 const selected=await selectedGrant(c.env,recipients);if(!selected)return next()
 const from=headerFromAddress(parsed.headers,field('from'));if(!from)throw new HTTPException(403,{message:'One header From address is required for a partner reply'})
 const verdict=sendGridVerdict({dkim:field('dkim'),spf:field('SPF'),envelopeFrom:envelope.from||'',from}),files=[]
 for(const [,value] of form)if(value instanceof File)files.push({filename:value.name,contentType:value.type||'application/octet-stream',content:await value.arrayBuffer()})
 const content=plainEmail(field('text'),field('html'))||field('subject'),rawId=parsed.messageId||await hashToken(JSON.stringify({recipients,from,content}))
 const result=await deliver(c.env,selected,{messageId:rawId.length>200?await hashToken(rawId):rawId,sender:from,content,senderFailed:verdict.failed,attachments:files})
 return c.json(result,result?.duplicate?200:201)
})
inboundEmail.route('/',ordinaryInbound)

export async function handleEmail(message:ForwardableEmailMessage,env:Env,execution:ExecutionContext){
 const candidates=[message.to,...addresses(message.headers.get('to')||''),...addresses(message.headers.get('cc')||'')]
 const selected=await selectedGrant(env,candidates)
 if(!selected)return ordinaryHandleEmail(message,env,execution)
 if(message.rawSize>25000000){message.setReject('Message exceeds 25 MB');return}
 try{
  const raw=await new Response(message.raw).arrayBuffer(),parsed=await PostalMime.parse(raw,{attachmentEncoding:'arraybuffer'}),from=headerFromAddress(parsed.headers)
  if(!from)throw new HTTPException(403,{message:'One header From address is required for a partner reply'})
  const verdict=authenticationVerdict(parsed.headers,from,message.from),rawId=parsed.messageId||await hashToken(new TextDecoder().decode(raw))
  await deliver(env,selected,{messageId:rawId.length>200?await hashToken(rawId):rawId,sender:from,content:plainEmail(parsed.text||'',parsed.html||'')||String(parsed.subject||''),senderFailed:verdict.failed,attachments:parsed.attachments.map(file=>({filename:file.filename||'attachment',contentType:file.mimeType,content:file.content as ArrayBuffer}))})
 }catch(error){if(error instanceof HTTPException&&error.status>=400&&error.status<500){message.setReject(error.message);return}throw error}
}
