import {notificationSendSignal} from '../email-send-window'
import type {connect} from 'cloudflare:sockets'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {base64,MIME_LIMIT,MailboxResponseTooLarge} from './http'
import type {ImapCredential} from './types'
type Socket=ReturnType<typeof connect>

export function socketHosts(env:Env){return String(env.MAILBOX_SOCKET_HOSTS||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean)}
export function socketPorts(env:Env){return String(env.MAILBOX_SOCKET_PORTS||'993,465').split(',').map(Number).filter(n=>Number.isSafeInteger(n)&&n>0&&n<=65535)}
export function validateSocketPort(env:Env,value:unknown,standard:number){
 const port=value===undefined?standard:value
 if(typeof port!=='number'||!socketPorts(env).includes(port))throw new HTTPException(400,{message:'Mailbox TLS port must be in the installation socket port allowlist'})
 return port
}
export function validateSocketHost(env:Env,value:unknown){
 if(typeof value!=='string'||value.length>253||!/(?=^.{1,253}$)^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value)||/^(?:\d+\.){3}\d+$/.test(value)||!socketHosts(env).includes(value.toLowerCase()))throw new HTTPException(400,{message:'Mailbox host must be in the installation socket host allowlist'})
 return value.toLowerCase()
}
/** One TLS connection, fixed port, bounded bytes and a wall-clock deadline. */
export class MailSocket {
 socket:Socket;reader:ReadableStreamDefaultReader<Uint8Array>;writer:WritableStreamDefaultWriter<Uint8Array>
 private signal?:AbortSignal;private abort=()=>{void this.socket.close().catch(()=>{})}
 private buffer=new Uint8Array(0);private total=0;private timer:ReturnType<typeof setTimeout>
 static async open(host:string,port:number){
  const {connect}=await import('cloudflare:sockets')
  notificationSendSignal()
  return new MailSocket(connect({hostname:host,port},{secureTransport:'on',allowHalfOpen:false}))
 }
 constructor(socket:Socket){
  this.socket=socket
  this.signal=notificationSendSignal();this.signal?.addEventListener('abort',this.abort,{once:true})
  this.reader=this.socket.readable.getReader();this.writer=this.socket.writable.getWriter()
  this.socket.closed.catch(()=>{})
  this.timer=setTimeout(()=>{void this.socket.close().catch(()=>{})},25000)
 }
 async write(value:string|Uint8Array){await this.writer.write(typeof value==='string'?new TextEncoder().encode(value):value)}
 private async fill(){
  const part=await this.reader.read();if(part.done)throw new Error('Mailbox connection ended unexpectedly')
  this.total+=part.value.length;if(this.total>MIME_LIMIT+1024*1024)throw new Error('Mailbox socket response exceeds size limit')
  const next=new Uint8Array(this.buffer.length+part.value.length);next.set(this.buffer);next.set(part.value,this.buffer.length);this.buffer=next
 }
 async line(){
  for(;;){const end=this.buffer.findIndex((b,i)=>b===13&&this.buffer[i+1]===10)
   if(end>=0){if(end>65536)throw new Error('Mailbox line exceeds size limit');const value=new TextDecoder().decode(this.buffer.subarray(0,end));this.buffer=this.buffer.slice(end+2);return value}
   if(this.buffer.length>65536)throw new Error('Mailbox line exceeds size limit');await this.fill()
  }
 }
 async literal(length:number){
  if(!Number.isSafeInteger(length)||length<0)throw new Error('Invalid mailbox literal length')
  if(length>MIME_LIMIT)throw new MailboxResponseTooLarge('Mailbox message exceeds size limit')
  while(this.buffer.length<length)await this.fill()
  const value=this.buffer.slice(0,length);this.buffer=this.buffer.slice(length);return value
 }
 async close(){clearTimeout(this.timer);this.signal?.removeEventListener('abort',this.abort);await this.socket.close().catch(()=>{})}
}
const quote=(value:string)=>{if(/[\r\n\0]/.test(value)||value.length>2048)throw new HTTPException(400,{message:'Invalid mailbox credential'});return '"'+value.replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"'}
export class ImapSession {
 private counter=0
 wire:MailSocket
 constructor(wire:MailSocket){this.wire=wire}
 async command(value:string){
  const tag=`A${++this.counter}`;await this.wire.write(`${tag} ${value}\r\n`)
  const lines:string[]=[],literals:Uint8Array[]=[]
  for(let i=0;i<10000;i++){
   const line=await this.wire.line();lines.push(line)
   if(line.startsWith(`${tag} `)){if(!line.startsWith(`${tag} OK`))throw new Error('IMAP command rejected');return {lines,literals}}
   if(line.startsWith('* BYE'))throw new Error('IMAP session ended')
   const literal=line.match(/\{(\d+)\}$/);if(literal)literals.push(await this.wire.literal(Number(literal[1])))
  }
  throw new Error('IMAP response exceeds line limit')
 }
}
export async function openImap(env:Env,credential:ImapCredential){
 const wire=await MailSocket.open(validateSocketHost(env,credential.imapHost),validateSocketPort(env,credential.imapPort,993)),session=new ImapSession(wire)
 try{
  const greeting=await wire.line();if(!greeting.startsWith('* OK'))throw new Error('IMAP greeting rejected')
  await session.command(`LOGIN ${quote(credential.username)} ${quote(credential.password)}`)
  const selected=await session.command('EXAMINE INBOX'),combined=selected.lines.join('\n'),validity=combined.match(/\[UIDVALIDITY (\d+)\]/i),next=combined.match(/\[UIDNEXT (\d+)\]/i)
  if(!validity||!next)throw new Error('IMAP mailbox omitted UID state')
  return {session,uidValidity:validity[1],uidNext:Number(next[1])}
 }catch(error){await wire.close();throw error}
}
async function smtpReply(wire:MailSocket,expected:number[]){
 let code=0;for(let i=0;i<100;i++){
  const line=await wire.line();if(!/^\d{3}[- ]/.test(line))throw new Error('Invalid SMTP response')
  code=Number(line.slice(0,3));if(line[3]===' '){if(!expected.includes(code))throw new Error(`SMTP rejected command (${code})`);return code}
 }throw new Error('SMTP response exceeds line limit')
}
export async function openSmtp(env:Env,credential:ImapCredential){
 const wire=await MailSocket.open(validateSocketHost(env,credential.smtpHost),validateSocketPort(env,credential.smtpPort,465))
 try{
  await smtpReply(wire,[220]);await wire.write('EHLO happytohelp.invalid\r\n');await smtpReply(wire,[250])
  const user=credential.smtpUsername||credential.username,password=credential.smtpPassword||credential.password
  if(/[\r\n\0]/.test(user+password))throw new HTTPException(400,{message:'Invalid SMTP credentials'})
  await wire.write(`AUTH PLAIN ${base64(new TextEncoder().encode(`\0${user}\0${password}`))}\r\n`);await smtpReply(wire,[235])
  return wire
 }catch(error){await wire.close();throw error}
}
export async function verifyImap(env:Env,credential:ImapCredential){
 const imap=await openImap(env,credential);await imap.session.wire.close()
 const smtp=await openSmtp(env,credential);await smtp.close()
}
export async function smtpSend(env:Env,credential:ImapCredential,from:string,recipients:readonly string[],raw:Uint8Array){
 const wire=await openSmtp(env,credential)
 try{
  await wire.write(`MAIL FROM:<${from}>\r\n`);await smtpReply(wire,[250])
  for(const recipient of recipients){await wire.write(`RCPT TO:<${recipient}>\r\n`);await smtpReply(wire,[250,251])}
  await wire.write('DATA\r\n');await smtpReply(wire,[354])
  const data=new TextDecoder().decode(raw).replace(/(^|\r\n)\./g,'$1..')
  await wire.write(data.endsWith('\r\n')?data:data+'\r\n');await wire.write('.\r\n');await smtpReply(wire,[250])
  return null
 }finally{await wire.close()}
}
