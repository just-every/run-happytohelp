import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {getMailbox,mailboxForDelivery} from './store'
import {MailboxProviderError} from './http'
import {gmailPage,graphPage,imapPage,BackfillRequired,type Cursor} from './sync-providers'
import type {MailboxReceiver,MailboxSyncOptions} from './types'
import {auditStatement} from '../../audit/record'

const FAILURE_BACKOFF_MS=5*60000
const permanentMessageError=(error:unknown):error is HTTPException=>error instanceof HTTPException&&[400,409,413,422].includes(error.status)

/** One durable cursor page per invocation. Only definitive message refusals are
 * recorded and skipped; transient or unknown outcomes retain the cursor. */
export async function syncMailbox(env:Env,projectId:string,mailboxId:string,receive:MailboxReceiver,options:MailboxSyncOptions={}){
 const row=await getMailbox(env,projectId,mailboxId)
 if(row.provider==='forwarding')throw new HTTPException(409,{message:'Forwarding mailbox receives through the email gateway'})
 if(row.status!=='connected'&&!(options.backfill&&row.status==='needs_backfill'))throw new HTTPException(409,{message:'Mailbox must be reconnected before syncing'})
 const lease=crypto.randomUUID(),now=Date.now()
 const auditActor=options.actorId?{type:'user' as const,id:options.actorId}:{type:'system' as const},auditSource=options.actorId?'dashboard' as const:'system' as const
 const claim=await env.DB.prepare(`UPDATE mailbox_connections SET sync_lock=?,sync_lock_until=?,status='connected' WHERE id=? AND project_id=? AND credential_version=? AND (sync_lock_until IS NULL OR sync_lock_until<?) AND status IN ('connected','needs_backfill')
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=? AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`)
 .bind(lease,now+15*60000,mailboxId,projectId,row.credential_version,now,projectId).run()
 if(!claim.meta.changes)throw new HTTPException(409,{message:'Mailbox sync is already running or connection changed'})
 let received=0,failed=0
 const refuse=async(id:string,error:HTTPException)=>{
  // Persist the failure and replay fence together. Never turn a rejected message
  // into a ticket or expose its contents, sender, or exception text in the audit.
  await env.DB.batch([auditStatement(env.DB,{projectId,category:'integration',action:'mailbox.message_failed',outcome:'failed',actor:auditActor,source:auditSource,target:{type:'mailbox',id:mailboxId},detail:{providerMessageId:id,status:error.status}}),env.DB.prepare('INSERT OR IGNORE INTO mailbox_sync_receipts VALUES(?,?,?)').bind(mailboxId,id,Date.now())])
  failed++
 }
 const admit=async(id:string,load:()=>Promise<Uint8Array>)=>{
  if(await env.DB.prepare('SELECT 1 FROM mailbox_sync_receipts WHERE mailbox_id=? AND provider_message_id=?').bind(mailboxId,id).first())return
  let raw:Uint8Array
  try{raw=await load()}catch(error){
   // The provider can delete a message after listing it. There is no content to
   // admit and the provider's stable id can be safely recorded as observed.
   if(error instanceof MailboxProviderError&&error.status===404){await env.DB.prepare('INSERT OR IGNORE INTO mailbox_sync_receipts VALUES(?,?,?)').bind(mailboxId,id,Date.now()).run();return}
   throw error
  }
  const live=await mailboxForDelivery(env,projectId,mailboxId)
  const held=await env.DB.prepare('SELECT 1 FROM mailbox_connections WHERE id=? AND sync_lock=? AND sync_lock_until>?').bind(mailboxId,lease,Date.now()).first()
  if(!live||!held||live.credential_version!==row.credential_version)throw new HTTPException(409,{message:'Mailbox disconnected or sync lease expired'})
  try{await receive({projectId,mailboxId,address:row.address,provider:row.provider,providerMessageId:id,raw})}catch(error){
   // This catch excludes connection/lease checks and provider requests: a changed
   // mailbox or rejected credential is never mistaken for a bad message.
   if(permanentMessageError(error)){await refuse(id,error);return}
   throw error
  }
  await env.DB.prepare('INSERT OR IGNORE INTO mailbox_sync_receipts VALUES(?,?,?)').bind(mailboxId,id,Date.now()).run();received++
 }
 try{
  const cursor:Cursor|null=options.backfill?null:row.cursor_json?JSON.parse(row.cursor_json):null
  const page=await (row.provider==='gmail'?gmailPage:row.provider==='microsoft'?graphPage:imapPage)(env,row,cursor,admit)
  const results=await env.DB.batch([env.DB.prepare(`UPDATE mailbox_connections SET cursor_json=?,last_sync_at=?,error_code=NULL,updated_at=? WHERE id=? AND sync_lock=? AND status='connected' AND credential_version=?`)
  .bind(JSON.stringify(page.cursor),Date.now(),Date.now(),mailboxId,lease,row.credential_version),auditStatement(env.DB,{projectId,category:'integration',action:options.backfill?'mailbox.backfilled':'mailbox.polled',actor:auditActor,source:auditSource,target:{type:'mailbox',id:mailboxId},detail:{received,failed,more:page.more}})])
  const result=results[0]
  if(!result.meta.changes)throw new HTTPException(409,{message:'Mailbox connection changed during sync'})
  return {received,failed,cursor:page.cursor,more:page.more}
 }catch(error){
  const expired=error instanceof BackfillRequired||error instanceof MailboxProviderError&&error.status===410
  const auth=error instanceof MailboxProviderError&&[401,403].includes(error.status)
  await env.DB.batch([env.DB.prepare(`UPDATE mailbox_connections SET error_code=?,status=CASE WHEN status IN ('disconnected','reconnect_required') THEN status ELSE ? END,updated_at=? WHERE id=? AND sync_lock=?`)
  .bind(expired?'cursor_expired':auth?'provider_authorization_rejected':'sync_failed',expired?'needs_backfill':auth?'reconnect_required':'connected',Date.now(),mailboxId,lease),auditStatement(env.DB,{projectId,category:'integration',action:options.backfill?'mailbox.backfill_failed':'mailbox.poll_failed',outcome:'failed',actor:auditActor,source:auditSource,target:{type:'mailbox',id:mailboxId},detail:{reason:expired?'cursor_expired':auth?'authorization_rejected':'sync_failed'}})])
  if(error instanceof HTTPException)throw error
  throw new HTTPException(502,{message:expired?'Mailbox cursor expired; start backfill':auth?'Mailbox authorization rejected; reconnect':'Mailbox synchronization failed; cursor retained'})
 }finally{await env.DB.prepare('UPDATE mailbox_connections SET sync_lock=NULL,sync_lock_until=NULL WHERE id=? AND sync_lock=?').bind(mailboxId,lease).run()}
}
export async function syncConnectedMailboxes(env:Env,receive:MailboxReceiver,options:{limit?:number}={}){
 const limit=Math.max(1,Math.min(20,Math.floor(options.limit||4)))
 const rows=await env.DB.prepare(`SELECT m.project_id,m.id FROM mailbox_connections m WHERE m.status='connected' AND m.provider<>'forwarding' AND (m.sync_lock_until IS NULL OR m.sync_lock_until<?)
 AND (m.error_code IS NULL OR m.updated_at<=?)
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=m.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)
 ORDER BY CASE WHEN m.error_code IS NULL THEN 0 ELSE 1 END,CASE WHEN m.error_code IS NULL THEN coalesce(m.last_sync_at,0) ELSE m.updated_at END,m.id LIMIT ?`).bind(Date.now(),Date.now()-FAILURE_BACKOFF_MS,limit).all<{project_id:string;id:string}>()
 const results=[]
 for(const row of rows.results)try{results.push({mailboxId:row.id,...await syncMailbox(env,row.project_id,row.id,receive)})}catch{results.push({mailboxId:row.id,error:'sync_failed'})}
 return results
}
