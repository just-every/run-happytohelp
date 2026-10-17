import {HTTPException} from 'hono/http-exception'
import {base64,MIME_LIMIT} from './http'
import {address} from './store'
import type {MailboxSendInput} from './types'
const utf8=(value:string)=>base64(new TextEncoder().encode(value))
const encoded=(value:string)=>`=?UTF-8?B?${utf8(value)}?=`
const lines=(value:string)=>value.match(/.{1,76}/g)?.join('\r\n')||''
function header(value:string){if(/[\r\n\0]/.test(value)||value.length>8192)throw new HTTPException(400,{message:'Invalid email header'});return value}
export function recipients(input:MailboxSendInput){
 const to=address(input.to),cc=(input.cc||[]).map(address),bcc=(input.bcc||[]).map(address)
 if(cc.length+bcc.length>50)throw new HTTPException(400,{message:'Too many email recipients'})
 return {to,cc,bcc,all:[...new Set([to,...cc,...bcc])]}
}
export function buildMime(input:MailboxSendInput,from:string,displayName:string,includeBcc=false){
 const r=recipients(input),boundary=`h2h_${crypto.randomUUID().replace(/-/g,'')}`,alternative=`alt_${crypto.randomUUID().replace(/-/g,'')}`
 const headers=[`From: ${displayName?encoded(header(displayName))+' ':''}<${address(from)}>`,`To: <${r.to}>`,`Subject: ${encoded(header(input.subject))}`,
  `Message-ID: ${messageId(input,from)}`,`Date: ${new Date().toUTCString()}`,'MIME-Version: 1.0',`Content-Type: multipart/mixed; boundary="${boundary}"`]
 if(r.cc.length)headers.push(`Cc: ${r.cc.map(a=>`<${a}>`).join(', ')}`)
 if(includeBcc&&r.bcc.length)headers.push(`Bcc: ${r.bcc.map(a=>`<${a}>`).join(', ')}`)
 if(input.replyTo)headers.push(`Reply-To: <${address(input.replyTo)}>`)
 for(const [name,value] of Object.entries(input.headers||{})){
  if(name.toLowerCase()==='message-id')continue
  if(!/^(?:In-Reply-To|References|Auto-Submitted|X-Auto-Response-Suppress|Precedence|List-Unsubscribe|List-Unsubscribe-Post)$/i.test(name))throw new HTTPException(400,{message:'Unsupported mailbox message header'})
  headers.push(`${name}: ${header(value)}`)
 }
 const part=(type:string,value:string)=>`Content-Type: ${type}; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${lines(utf8(value))}\r\n`
 let body=`--${boundary}\r\nContent-Type: multipart/alternative; boundary="${alternative}"\r\n\r\n--${alternative}\r\n${part('text/plain',input.text)}`
 if(input.html)body+=`--${alternative}\r\n${part('text/html',input.html)}`
 body+=`--${alternative}--\r\n`
 if((input.attachments?.length||0)>20)throw new HTTPException(400,{message:'Too many attachments'})
 for(const attachment of input.attachments||[]){
  header(attachment.filename);header(attachment.contentType)
  if(!/^[\w.+-]+\/[\w.+-]+$/.test(attachment.contentType)||!/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content))throw new HTTPException(400,{message:'Invalid mailbox attachment'})
  const filename=encodeURIComponent(attachment.filename)
  body+=`--${boundary}\r\nContent-Type: ${attachment.contentType}\r\nContent-Disposition: ${attachment.contentId?'inline':'attachment'}; filename*=UTF-8''${filename}\r\nContent-Transfer-Encoding: base64\r\n`
  if(attachment.contentId){if(/[<>]/.test(attachment.contentId))throw new HTTPException(400);body+=`Content-ID: <${header(attachment.contentId)}>\r\n`}
  body+=`\r\n${lines(attachment.content)}\r\n`
 }
 body+=`--${boundary}--\r\n`
 const raw=new TextEncoder().encode(headers.join('\r\n')+'\r\n\r\n'+body)
 if(raw.length>MIME_LIMIT)throw new HTTPException(413,{message:'Mailbox message exceeds size limit'})
 return raw
}
function messageId(input:MailboxSendInput,from:string){
 const offered=Object.entries(input.headers||{}).filter(([name])=>name.toLowerCase()==='message-id')
 if(offered.length>1)throw new HTTPException(400,{message:'Duplicate Message-ID'})
 if(offered.length){const value=header(offered[0][1]);if(!/^<[^\s<>@]+@[^\s<>@]+>$/.test(value))throw new HTTPException(400,{message:'Invalid Message-ID'});return value}
 const key=base64(new TextEncoder().encode(input.idempotencyKey)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
 return `<h2h.${key}@${address(from).split('@')[1]}>`
}
