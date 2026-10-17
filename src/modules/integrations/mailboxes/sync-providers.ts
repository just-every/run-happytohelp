import type {Env} from '../../../platform/env'
import {bearer,providerBytes,providerJson,graphPageUrl,unbase64,MIME_LIMIT,MailboxProviderError} from './http'
import {accessToken} from './oauth-provider'
import {openImap} from './socket'
import {readCredential} from './store'
import type {MailboxRow,ImapCredential} from './types'
export type Cursor=
 | {kind:'gmail-backfill';baseline:string;page?:string}
 | {kind:'gmail-history';historyId:string;page?:string}
 | {kind:'graph';url:string}
 | {kind:'imap';uidValidity:string;lastUid:number}
export interface SyncPage {cursor:Cursor;more:boolean}
type Admit=(id:string,load:()=>Promise<Uint8Array>)=>Promise<void>
export class BackfillRequired extends Error {}

export async function gmailPage(env:Env,row:MailboxRow,cursor:Cursor|null,admit:Admit):Promise<SyncPage>{
 const token=await accessToken(env,row),headers=bearer(token),base='https://gmail.googleapis.com/gmail/v1/users/me'
 if(cursor&&cursor.kind!=='gmail-backfill'&&cursor.kind!=='gmail-history')throw new Error('Invalid Gmail cursor')
 if(!cursor){const profile=await providerJson(`${base}/profile`,{headers});if(typeof profile.historyId!=='string')throw new Error('Gmail omitted history cursor');cursor={kind:'gmail-backfill',baseline:profile.historyId}}
 let ids:string[]=[],page:string|undefined,next:Cursor
 if(cursor.kind==='gmail-backfill'){
  const params=new URLSearchParams({maxResults:'20',labelIds:'INBOX',...(cursor.page?{pageToken:cursor.page}:{})})
  const result=await providerJson(`${base}/messages?${params}`,{headers})
  ids=(result.messages||[]).map((m:any)=>m.id);page=result.nextPageToken
  next=page?{...cursor,page}:{kind:'gmail-history',historyId:cursor.baseline}
 }else{
  const params=new URLSearchParams({startHistoryId:cursor.historyId,historyTypes:'messageAdded',maxResults:'20',labelId:'INBOX',...(cursor.page?{pageToken:cursor.page}:{})})
  const result=await providerJson(`${base}/history?${params}`,{headers}).catch(error=>{if(error instanceof MailboxProviderError&&error.status===404)throw new BackfillRequired('Gmail history expired');throw error})
  ids=[...new Set<string>((result.history||[]).flatMap((h:any)=>(h.messagesAdded||[]).map((a:any)=>a.message?.id)).filter(Boolean))]
  page=result.nextPageToken
  if(typeof result.historyId!=='string')throw new Error('Gmail omitted history cursor')
  next=page?{...cursor,page}:{kind:'gmail-history',historyId:result.historyId}
 }
 if(ids.length>200)throw new Error('Mailbox page exceeds message limit')
 for(const id of ids){if(typeof id!=='string'||id.length>512)throw new Error('Invalid Gmail message identity');await admit(id,async()=>{
  const message=await providerJson(`${base}/messages/${encodeURIComponent(id)}?format=raw`,{headers},Math.ceil(MIME_LIMIT*1.4))
  if(typeof message.raw!=='string')throw new Error('Gmail omitted raw message')
  const raw=unbase64(message.raw);if(raw.length>MIME_LIMIT)throw new Error('Mailbox message exceeds size limit');return raw
 })}
 return {cursor:next,more:Boolean(page)||next.kind==='gmail-backfill'}
}
export async function graphPage(env:Env,row:MailboxRow,cursor:Cursor|null,admit:Admit):Promise<SyncPage>{
 const token=await accessToken(env,row),headers={...bearer(token),Prefer:'IdType="ImmutableId", odata.maxpagesize=20'}
 if(cursor&&cursor.kind!=='graph')throw new Error('Invalid Microsoft cursor')
 const url=cursor?graphPageUrl(cursor.url):'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$select=id&$top=20'
 const result=await providerJson(url,{headers})
 if(!Array.isArray(result.value)||result.value.length>200)throw new Error('Invalid Microsoft page')
 for(const message of result.value){
  if(message['@removed'])continue
  if(typeof message.id!=='string'||message.id.length>2048)throw new Error('Invalid Microsoft message identity')
  await admit(message.id,async()=>(await providerBytes(`https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(message.id)}/$value`,{headers})).bytes)
 }
 const next=result['@odata.nextLink']||result['@odata.deltaLink']
 if(typeof next!=='string')throw new Error('Microsoft omitted delta cursor')
 return {cursor:{kind:'graph',url:graphPageUrl(next)},more:Boolean(result['@odata.nextLink'])}
}
export async function imapPage(env:Env,row:MailboxRow,cursor:Cursor|null,admit:Admit):Promise<SyncPage>{
 if(cursor&&cursor.kind!=='imap')throw new Error('Invalid IMAP cursor')
 const {session,uidValidity,uidNext}=await openImap(env,await readCredential<ImapCredential>(env,row))
 try{
  if(cursor&&cursor.uidValidity!==uidValidity)throw new BackfillRequired('IMAP UID validity changed')
  const start=(cursor?.lastUid||0)+1
  if(start>=uidNext)return {cursor:{kind:'imap',uidValidity,lastUid:start-1},more:false}
  // Search a finite UID range; avoid unbounded SEARCH ALL on large mailboxes.
  const end=Math.min(uidNext-1,start+999),result=await session.command(`UID SEARCH UID ${start}:${end}`)
  const uids=result.lines.filter(l=>l.startsWith('* SEARCH')).flatMap(l=>l.slice(8).trim().split(/\s+/).filter(Boolean).map(Number)).sort((a,b)=>a-b)
  if(uids.some(n=>!Number.isSafeInteger(n)||n<start||n>end))throw new Error('Invalid IMAP UID response')
  const selected=uids.slice(0,20)
  for(const uid of selected)await admit(`${uidValidity}:${uid}`,async()=>{
   const result=await session.command(`UID FETCH ${uid} (UID BODY.PEEK[])`)
   if(result.literals.length!==1)throw new Error('IMAP omitted message content')
   return result.literals[0]
  })
  const lastUid=uids.length>selected.length?selected[selected.length-1]:end
  return {cursor:{kind:'imap',uidValidity,lastUid},more:lastUid<uidNext-1}
 }finally{await session.wire.close()}
}
