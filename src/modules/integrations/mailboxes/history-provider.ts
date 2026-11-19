import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import type {MailboxRow,ImapCredential} from './types'
import {accessToken} from './oauth-provider'
import {bearer,providerJson,providerBytes,unbase64,providerUrl} from './http'
import {openImap,quote} from './socket'
import {readCredential} from './store'

const gmail='https://gmail.googleapis.com/gmail/v1/users/me',graph='https://graph.microsoft.com/v1.0/me'
export interface HistoryMessage {id:string;thread?:string;raw:Uint8Array}
export interface HistoryFolder {id:string;name:string}
function historyGraphUrl(value:string){const url=providerUrl(value);if(url.hostname!=='graph.microsoft.com'||!/^\/v1\.0\/me\/mailfolders(?:(?:\/[^/]+|\('[^']+'\))(?:\/(?:childfolders|messages))?)?$/i.test(url.pathname))throw new HTTPException(502,{message:'Invalid mailbox history page'});return url.href}
const invalid=()=>new HTTPException(502,{message:'Mailbox provider returned an invalid history page'})
export async function historyFolders(env:Env,row:MailboxRow):Promise<HistoryFolder[]>{
 if(row.provider==='imap'){
  const {session}=await openImap(env,await readCredential<ImapCredential>(env,row))
  try{return (await session.command('LIST "" "*"')).lines.filter(l=>/^\* LIST /i.test(l)&&!l.includes('\\Noselect')).map(l=>{
   const match=l.match(/ ("(?:[^"\\]|\\.)*"|[^\s]+)$/);if(!match)throw invalid()
   const id=match[1].startsWith('"')?match[1].slice(1,-1).replace(/\\(.)/g,'$1'):match[1]
   return {id,name:id}
  })}finally{await session.wire.close()}
 }
 const headers=bearer(await accessToken(env,row))
 if(row.provider==='gmail'){
  const result=await providerJson(`${gmail}/labels`,{headers});if(!Array.isArray(result.labels)||result.labels.length>1000)throw invalid()
  return result.labels.map((v:any)=>({id:v.id,name:v.name}))
 }
 const folders:HistoryFolder[]=[],queue=[`${graph}/mailFolders?includeHiddenFolders=true&$top=100&$select=id,displayName,childFolderCount`],seen=new Set<string>()
 while(queue.length){const url=historyGraphUrl(queue.shift()!);if(seen.has(url)||seen.size>=100)throw invalid();seen.add(url)
  const page=await providerJson(url,{headers});if(!Array.isArray(page.value))throw invalid()
  for(const folder of page.value){if(typeof folder.id!=='string'||typeof folder.displayName!=='string')throw invalid();folders.push({id:folder.id,name:folder.displayName});if(folder.childFolderCount>0)queue.push(`${graph}/mailFolders/${encodeURIComponent(folder.id)}/childFolders?includeHiddenFolders=true&$top=100&$select=id,displayName,childFolderCount`)}
  if(page['@odata.nextLink'])queue.push(page['@odata.nextLink'])
  if(folders.length>1000)throw invalid()
 }
 return folders
}
/** Explicit finite read, never delta, watch, modify, STORE, SELECT or SMTP. A
 * selection beyond the ordinary Move in bounds is refused before admission. */
export async function readHistory(env:Env,row:MailboxRow,folders:string[]):Promise<HistoryMessage[]>{
 const messages:HistoryMessage[]=[],seen=new Set<string>();let bytes=0,calls=0
 const admit=(id:string,thread:string|undefined,raw:Uint8Array)=>{
  bytes+=raw.length;if(bytes>1024*1024||messages.length>=1000)throw new HTTPException(413,{message:'Selected history exceeds the current Move in limit. Select smaller folders; nothing was imported.'})
  messages.push({id,thread,raw})
 }
 const budget=()=>{if(++calls>150)throw new HTTPException(413,{message:'Selected history needs too many provider reads. Select smaller folders; nothing was imported.'})}
 if(row.provider==='imap'){
  const credential=await readCredential<ImapCredential>(env,row)
  for(const folder of folders){budget();const {session,uidValidity}=await openImap(env,credential,folder)
   try{
    budget()
    const search=await session.command('UID SEARCH ALL')
    const uids=search.lines.filter(l=>/^\* SEARCH(?:\s|$)/i.test(l)).flatMap(l=>l.slice(8).trim().split(/\s+/).filter(Boolean).map(Number))
    if(uids.some(uid=>!Number.isSafeInteger(uid)||uid<1||uid>0xffffffff)||new Set(uids).size!==uids.length)throw invalid()
    if(uids.length>1000-messages.length)throw new HTTPException(413,{message:'Selected history exceeds the current Move in limit. Select smaller folders; nothing was imported.'})
    for(const uid of uids){budget();const result=await session.command(`UID FETCH ${uid} (UID BODY.PEEK[])`);if(result.literals.length!==1)throw invalid();admit(`${folder}:${uidValidity}:${uid}`,undefined,result.literals[0])}
   }finally{await session.wire.close()}
  }
 }else{
  const headers={...bearer(await accessToken(env,row)),...(row.provider==='microsoft'?{Prefer:'IdType="ImmutableId"'}:{})}
  for(const folder of folders){
   let url:string|undefined=row.provider==='gmail'?`${gmail}/messages?${new URLSearchParams({labelIds:folder,maxResults:'100',includeSpamTrash:'true'})}`:`${graph}/mailFolders/${encodeURIComponent(folder)}/messages?$select=id,conversationId&$top=100`
   const pages=new Set<string>()
   while(url){budget();if(pages.has(url))throw invalid();pages.add(url)
    const result:Record<string,any>=await providerJson(url,{headers}),items=row.provider==='gmail'?result.messages||[]:result.value
    if(!Array.isArray(items)||items.length>100)throw invalid()
    for(const item of items){if(typeof item.id!=='string'||!item.id||item.id.length>2048)throw invalid();if(seen.has(item.id))continue;seen.add(item.id);budget()
     const raw=row.provider==='gmail'?unbase64((await providerJson(`${gmail}/messages/${encodeURIComponent(item.id)}?format=raw`,{headers},2*1024*1024)).raw):(await providerBytes(`${graph}/messages/${encodeURIComponent(item.id)}/$value`,{headers},1024*1024)).bytes
     admit(item.id,typeof (item.threadId||item.conversationId)==='string'?item.threadId||item.conversationId:undefined,raw)
    }
    url=row.provider==='gmail'?(result.nextPageToken?`${gmail}/messages?${new URLSearchParams({labelIds:folder,maxResults:'100',includeSpamTrash:'true',pageToken:result.nextPageToken})}`:undefined):(result['@odata.nextLink']?historyGraphUrl(result['@odata.nextLink']):undefined)
   }
  }
 }
 return messages
}
