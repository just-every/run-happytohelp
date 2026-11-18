import PostalMime from 'postal-mime'
import {Buffer} from 'node:buffer'
import {HTTPException} from 'hono/http-exception'
import {canonicalJson,sha256} from '../../import-kit/src/provenance/identity'
import type {MailboxRow} from './types'
import type {HistoryMessage} from './history-provider'
import {address} from './store'
import {htmlToMarkdown} from '../../knowledge/importers'

/** Normalize the selected complete MIME messages, without preserving provider
 * credentials, transport headers or signed attachment URLs in import custody. */
export async function historySource(row:MailboxRow,input:HistoryMessage[]):Promise<Uint8Array>{
 const account=sha256(canonicalJson([row.provider,row.address])),people=new Map<string,any>(),messages:any[]=[],seen=new Set<string>(),parents=new Map<string,string>()
 const key=(value:string)=>sha256(canonicalJson([account,value]))
 const root=(value:string):string=>{let next=value;const visited=new Set<string>();while(parents.has(next)&&parents.get(next)!==next&&!visited.has(next)){visited.add(next);next=parents.get(next)!}return next}
 for(const entry of input){
  const mail=await PostalMime.parse(entry.raw),sender=address(mail.from?.address),messageId=mail.messageId||`${row.provider}:${entry.id}`
  if(seen.has(messageId))continue;seen.add(messageId)
  const when=Date.parse(mail.date||'');if(!Number.isSafeInteger(when)||when<0)throw new HTTPException(422,{message:'History message has no valid original date; nothing was imported.'})
  const senderId=sha256(canonicalJson(['mailbox-sender',sender]))
  if(!people.has(senderId))people.set(senderId,{type:'contact',id:senderId,name:mail.from?.name||sender,email:sender,created_at:'1970-01-01T00:00:00.000Z'})
  const references=(mail.headers.find(h=>h.key==='references')?.value||mail.inReplyTo||'').match(/<[^<>\s]+>/g)||[]
  if(!entry.thread&&references.length)parents.set(messageId,references[0]!)
  const content=mail.text?.trim()|| (mail.html?await htmlToMarkdown(mail.html):'')||'(Message contains attachments only)'
  const attachments=mail.attachments.map((a,i)=>{const bytes=new Uint8Array(a.content as ArrayBuffer);return {id:String(i),name:a.filename||`attachment-${i+1}`,content_type:a.mimeType,size:bytes.length,sha256:sha256(bytes),base64:Buffer.from(bytes).toString('base64')}})
  messages.push({id:key(messageId),wireId:messageId,thread:entry.thread,sender_id:senderId,content,created_at:new Date(when).toISOString(),attachments,subject:mail.subject||'(No subject)'})
 }
 const threads=new Map<string,any[]>()
 for(const m of messages){const id=key(m.thread||root(m.wireId));threads.set(id,[...(threads.get(id)||[]),m])}
 const records:any[]=[...people.values()].sort((a,b)=>a.id.localeCompare(b.id))
 for(const [id,parts] of [...threads].sort(([a],[b])=>a.localeCompare(b))){parts.sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));records.push({type:'conversation',id,requester_id:parts[0].sender_id,subject:parts[0].subject,provider:row.provider,mailbox:row.address,tags:[`Mailbox history: ${row.provider}`],messages:parts.map(({id,sender_id,content,created_at,attachments})=>({id,sender_id,content,created_at,attachments}))})}
 const bytes=new TextEncoder().encode(records.map(record=>JSON.stringify(record)).join('\n'))
 if(bytes.length>2*1024*1024)throw new HTTPException(413,{message:'Selected history exceeds the Move in limit; nothing was imported.'})
 return bytes
}
