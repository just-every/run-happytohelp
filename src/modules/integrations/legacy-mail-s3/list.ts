import type {Env} from '../../../platform/env'
import {cronRoom} from '../../../platform/cron-budget'
import {receivingMailbox} from '../inbound-receiving'
import {legacyMailS3Config,type LegacyMailS3Config} from './config'
import {listObjects,S3Error} from './s3'

export const LEGACY_MAIL_S3_JOB='legacy-mail.s3'
/** SES writes this object once, when the receipt rule is created. It is not mail. */
export const SETUP_NOTICE='AMAZON_SES_SETUP_NOTIFICATION'
/** At most this many keys per prefix become receipts in one tick, and this many jobs are queued: the step stays well
 * inside the cron's statement room, and a bucket's whole history is taken in over a few ticks. */
const NEW_PER_PREFIX=20,JOBS_PER_TICK=10,MAX_PAGES=500
/** A receipt handed to the queue is not handed over again for this long. */
const LEASE_MS=120_000
const STALE_CLAIM_MS=120_000
const sesMessageId=(key:string)=>key.slice(key.lastIndexOf('/')+1)

/** The cron step. With any required input missing it does nothing at all: no request, no row, no statement. The private
 * copies' expiry is not part of it: the Integration step sweeps them every tick, reader on or off
 * (rer-mail-retention.ts). Every failure is recorded or logged here, never thrown, so another consumer's turn is never
 * taken away. */
export async function recoverLegacyMailS3(env:Env){
 const config=legacyMailS3Config(env)
 if(!config||!cronRoom(env,6))return
 const introduced=new Set<string>()
 try{await wakePendingMailbox(env,config)}catch(error){console.error('Amazon SES reader wake failed',error instanceof Error?error.name:'error')}
 try{await recordWorkspace(env,config)}catch(error){console.error('Amazon SES reader workspace record failed',error instanceof Error?error.name:'error')}
 try{
  // SES's prefix first, and the replay prefix only in a tick that took in SES's whole listing: when one message sits under
  // both, the copy SES wrote is always the one that holds its id. A tick that leaves the replay prefix for later, because
  // SES still has new keys, has still listed completely.
  const ses=await listPrefix(env,config,config.sesPrefix,'ses',introduced)
  const replay=ses==='end'&&config.replayPrefix?await listPrefix(env,config,config.replayPrefix,'replay',introduced):'end'
  await recordList(env,ses!=='stopped'&&replay!=='stopped'?{ok:true}:{ok:false,error:'list_incomplete'})
 }catch(error){
  const phrase=error instanceof S3Error?error.code:'list_failed'
  try{await recordList(env,{ok:false,error:phrase})}catch(inner){console.error('Amazon SES reader list state failed',inner instanceof Error?inner.name:'error')}
 }
 try{await enqueueDue(env)}catch(error){console.error('Amazon SES reader enqueue failed',error instanceof Error?error.name:'error')}
}
/** Receipts waiting for a workspace to receive on the mailbox are made due again the tick one does. */
async function wakePendingMailbox(env:Env,config:LegacyMailS3Config){
 if(!cronRoom(env,3)||!await env.DB.prepare("SELECT 1 FROM legacy_mail_s3_receipts WHERE state='pending_mailbox' LIMIT 1").first())return
 if(!await receivingMailbox(env,[config.mailbox]))return
 await env.DB.prepare("UPDATE legacy_mail_s3_receipts SET state='pending',next_at=0,updated_at=? WHERE state='pending_mailbox'").bind(Date.now()).run()
}
/** A receipt the reader read before it recorded the workspace with the private copy (admit.ts) holds a copy or a sender
 * and no workspace while it is in flight, in retry or failed. It is the workspace's that receives on the mailbox, as
 * erasure has decided it while the reader is on (email-erasure.ts); recording that here keeps it erasable in that
 * workspace once the reader is turned off. */
const unrecorded="state IN ('processing','retry','failed') AND project_id IS NULL AND (raw_key IS NOT NULL OR sender_address IS NOT NULL)"
async function recordWorkspace(env:Env,config:LegacyMailS3Config){
 if(!cronRoom(env,3)||!await env.DB.prepare(`SELECT 1 FROM legacy_mail_s3_receipts WHERE ${unrecorded} LIMIT 1`).first())return
 const workspace=await receivingMailbox(env,[config.mailbox])
 if(workspace)await env.DB.prepare(`UPDATE legacy_mail_s3_receipts SET project_id=? WHERE ${unrecorded}`).bind(workspace.project.project_id).run()
}
/** How one prefix's list ended: `end`, its last page was read; `capped`, it gave this tick's share of new keys a receipt;
 * `stopped`, it ran out of statement room or pages first. */
type ListEnd='end'|'capped'|'stopped'
/** List every page of one prefix (keys are SES message ids, which sort randomly, so new mail can land on any page and the
 * bucket keeps every object), and give each unknown key one receipt. */
async function listPrefix(env:Env,config:LegacyMailS3Config,prefix:string,source:'ses'|'replay',introduced:Set<string>):Promise<ListEnd>{
 let token:string|undefined,fresh=0
 for(let pages=0;pages<MAX_PAGES;pages++){
  if(!cronRoom(env,3))return 'stopped'
  const page=await listObjects(config,prefix,token)
  // A directory marker is not an object SES wrote.
  const objects=page.objects.filter(object=>object.key.startsWith(prefix)&&!object.key.endsWith('/'))
  if(objects.length){
   const known=new Set((await env.DB.prepare('SELECT object_key FROM legacy_mail_s3_receipts WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(objects.map(object=>object.key))).all<{object_key:string}>()).results.map(row=>row.object_key))
   const added=objects.filter(object=>!known.has(object.key)).slice(0,NEW_PER_PREFIX-fresh).map(object=>{
    const id=sesMessageId(object.key),repeated=introduced.has(id)
    if(id!==SETUP_NOTICE)introduced.add(id)
    return {key:object.key,id,size:object.size,dup:repeated?1:0}
   })
   if(added.length){
    const now=Date.now()
    // One statement for the page. A key whose SES message id another receipt holds, or an earlier key of this tick,
    // is recorded as a duplicate, so it is never listed as new again and a message is never admitted twice.
    await env.DB.prepare(`INSERT OR IGNORE INTO legacy_mail_s3_receipts(object_key,ses_message_id,source,size,state,created_at,updated_at)
     SELECT json_extract(j.value,'$.key'),json_extract(j.value,'$.id'),?2,json_extract(j.value,'$.size'),
      CASE WHEN json_extract(j.value,'$.id')=?3 THEN 'setup_notice'
       WHEN json_extract(j.value,'$.dup')=1 OR EXISTS(SELECT 1 FROM legacy_mail_s3_receipts r WHERE r.ses_message_id=json_extract(j.value,'$.id')) THEN 'duplicate' ELSE 'pending' END,?4,?4
     FROM json_each(?1) j`).bind(JSON.stringify(added),source,SETUP_NOTICE,now).run()
    fresh+=added.length
   }
  }
  if(fresh>=NEW_PER_PREFIX)return 'capped'
  if(!page.truncated)return 'end'
  token=page.next!
 }
 return 'stopped'
}
async function recordList(env:Env,outcome:{ok:true}|{ok:false;error:string}){
 const now=Date.now()
 if(outcome.ok)await env.DB.prepare('INSERT INTO legacy_mail_s3_state(id,last_listed_at,last_list_error) VALUES(1,?,NULL) ON CONFLICT(id) DO UPDATE SET last_listed_at=excluded.last_listed_at,last_list_error=NULL').bind(now).run()
 else await env.DB.prepare('INSERT INTO legacy_mail_s3_state(id,last_listed_at,last_list_error) VALUES(1,NULL,?) ON CONFLICT(id) DO UPDATE SET last_list_error=excluded.last_list_error').bind(outcome.error).run()
}
/** Due receipts are leased and queued, oldest first: new ones, retries whose time has come, and stale claims. The job only
 * claims; this decides when a receipt is due, because the deployed queue never retries. */
async function enqueueDue(env:Env){
 if(!cronRoom(env,2))return
 const now=Date.now()
 const due=(await env.DB.prepare(`UPDATE legacy_mail_s3_receipts SET next_at=?1 WHERE object_key IN (SELECT object_key FROM legacy_mail_s3_receipts WHERE (state IN ('pending','retry') AND next_at<=?2) OR (state='processing' AND claimed_at<?3) ORDER BY next_at,created_at LIMIT ?4) RETURNING object_key`).bind(now+LEASE_MS,now,now-STALE_CLAIM_MS,JOBS_PER_TICK).all<{object_key:string}>()).results
 if(due.length)await env.JOBS.sendBatch(due.map(row=>({body:{type:LEGACY_MAIL_S3_JOB,id:row.object_key,projectId:''}})))
}
