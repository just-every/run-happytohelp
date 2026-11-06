import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import {hashToken} from '../../../platform/auth'
import {MAX_INBOUND_RAW_BYTES} from '../email-limits'
import {rawDigest} from '../rer-mail-contract'
import {privateMime,redactedMime,mimeHeaderFrom} from '../rer-mail-raw'
import {holdRawEmail} from '../unreadable-email'
import {receivingMailbox} from '../inbound-receiving'
import {admitRawMime} from '../raw-mime-admission'
import {scheduleInboundEffects} from '../inbound-effects'
import {legacyMailS3Config,sourceOf,type LegacyMailS3Config} from './config'
import {boundRecipient,headerLines,returnPath} from './envelope'
import {sesVerdict} from './verdict'
import {getObject,S3Error} from './s3'

/** A message SES stored can be at most this large; anything beyond it is not fetched at all. */
const FETCH_LIMIT=41_943_040
/** An object that keeps failing is `failed` after this many attempts; backoff starts at seconds and caps at an hour. */
const MAX_ATTEMPTS=12
const RETRY_CAP_MS=3_600_000
const REVIEW_NOTE='This review copy has private reply recipients redacted. Its original bytes are retained as original.eml.'
interface Receipt {object_key:string;ses_message_id:string;source:'ses'|'replay';size:number;attempts:number;claimed_at:number;body_sha256:string|null}
type Final={state:'complete'|'held';reason:string|null;conversationId?:string|null;delivered?:any;sender?:string|null}
type Outcome=(Final&{projectId:string})|{state:'pending_mailbox'}
const waiting=(error:unknown)=>error instanceof HTTPException&&error.status===404&&/mailbox is not configured/i.test(error.message)

/** The queued job: claim one receipt, read its object, and admit or hold it. The deployed queue never retries, so a
 * failure is written to the receipt with its next attempt, and the cron decides when it is due again. */
export async function processLegacyMailS3(env:Env,objectKey:string){
 const config=legacyMailS3Config(env)
 if(!config)return
 const now=Date.now()
 const claimed=await env.DB.prepare("UPDATE legacy_mail_s3_receipts SET state='processing',claimed_at=?1,attempts=attempts+1,updated_at=?1 WHERE object_key=?2 AND (state IN ('pending','retry') OR (state='processing' AND claimed_at<?3)) RETURNING object_key,ses_message_id,source,size,attempts,claimed_at,body_sha256").bind(now,objectKey,now-120_000).first<Receipt>()
 if(!claimed)return
 let outcome:Outcome
 try{outcome=await admit(env,config,claimed)}catch(error){await fail(env,claimed,error);return}
 await settle(env,claimed,outcome)
 if(outcome.state==='complete'&&outcome.delivered)await runEffects(env,outcome.delivered)
}
async function admit(env:Env,config:LegacyMailS3Config,receipt:Receipt):Promise<Outcome>{
 // Trust follows the prefix a key is under now; a key whose prefix changed role is never read as the other kind.
 if(sourceOf(config,receipt.object_key)!==receipt.source)throw new S3Error(0,'prefix_changed')
 const workspace=await receivingMailbox(env,[config.mailbox])
 if(!workspace)return {state:'pending_mailbox'}
 const key=receipt.object_key,projectId=workspace.project.project_id,identity=await hashToken('legacy-mail-s3:'+key)
 // More than SES ever stores, and more than this Worker can hold in memory: shown in Suspended all the same, never
 // dropped, and the object itself stays in the bucket.
 if(receipt.size>FETCH_LIMIT){
  await holdRawEmail(env,null,{recipients:[config.mailbox],reason:'message_too_large',description:`This email is ${receipt.size} bytes, more than can be read here. It was not read, and stays in the bucket as ${key}.`,identity,custody:{deliveryId:key,headerFrom:null,envelopeFrom:null}})
  return {state:'held',reason:'message_too_large',projectId}
 }
 const raw=await getObject(config,key,FETCH_LIMIT)
 const lines=headerLines(raw),headerFrom=mimeHeaderFrom(raw),envelopeFrom=returnPath(lines)
 const custody={deliveryId:key,headerFrom,envelopeFrom}
 const hold=async(reason:string,copy:Uint8Array,description=REVIEW_NOTE):Promise<Outcome>=>{
  // The mailbox's own workspace holds it: the hold finds that workspace from the mailbox, or answers 404.
  await holdRawEmail(env,copy,{recipients:[config.mailbox],reason,description,identity,custody,senderAddress:headerFrom||envelopeFrom||undefined})
  return {state:'held',reason,sender:headerFrom||envelopeFrom,projectId}
 }
 // Over the receiving limit: kept whole in Suspended, never admitted, with no private copy to keep.
 if(raw.byteLength>MAX_INBOUND_RAW_BYTES)return hold('message_too_large',redactedMime(raw),'This email exceeds the 25 MB receiving limit. Its original bytes are retained as original.eml.')
 const sha=await rawDigest(raw)
 // Bytes that changed under a key this reader already read are held, never admitted over the first read.
 if(receipt.body_sha256&&receipt.body_sha256!==sha)return hold('message_identity_conflict',redactedMime(raw))
 // The private transport copy is written before admission, encrypted with the installation's data key: raw MIME can
 // carry a live reply grant. Its key is recorded first, so no crash leaves an object nothing refers to.
 const rawKey=`legacy-mail-s3/${await hashToken(key)}/${sha}.eml`
 await env.DB.prepare("UPDATE legacy_mail_s3_receipts SET raw_key=?,body_sha256=? WHERE object_key=? AND state='processing'").bind(rawKey,sha,key).run()
 await env.FILES.put(rawKey,await privateMime(env,raw,[key,receipt.ses_message_id,sha]),{httpMetadata:{contentType:'application/octet-stream'}})
 // The envelope recipient is SES's own record of who it received the message for, and the only routing there is.
 const bound=boundRecipient(lines,config),routed=bound?await receivingMailbox(env,[bound.address]):null
 if(!bound||routed?.project.project_id!==workspace.project.project_id)return hold('envelope_recipient_unproven',redactedMime(raw),'Amazon SES did not record this message as received for this workspace\'s address, so it was not routed. Its original bytes are retained as original.eml.')
 const replay=receipt.source==='replay'
 // Replay objects are written by an operator, so none of their headers is trusted: they route to the plain mailbox,
 // which no grant can admit, and are never authenticated. SES objects carry SES's own verdict.
 const result=await admitRawMime(env,{raw,to:[replay?config.mailbox:bound.address],envelopeFrom:envelopeFrom||'',fallbackMessageId:sha,
  verdict:replay?{verified:false,failed:false}:({from})=>sesVerdict(lines,from),
  ...(replay&&bound.conversationId?{conversationId:bound.conversationId}:{}),
  hold:{description:REVIEW_NOTE,recipients:[config.mailbox],identity,custody,senderAddress:headerFrom||envelopeFrom||undefined},
  onSender:async from=>{await env.DB.prepare('UPDATE legacy_mail_s3_receipts SET sender_address=? WHERE object_key=?').bind(from,key).run()}})
 if(result.duplicate||result.state==='delivered')return {state:'complete',reason:result.duplicate?'duplicate':null,conversationId:result.conversationId||null,delivered:result.duplicate?undefined:result,projectId}
 if(result.state==='refused')return {state:'complete',reason:'closed_ticket',projectId}
 if(result.state==='suspended'&&result.suspendedId){
  const row=await env.DB.prepare('SELECT reason FROM suspended_emails WHERE id=?').bind(result.suspendedId).first<{reason:string}>()
  return {state:'held',reason:row?.reason||'suspended',projectId}
 }
 return {state:'held',reason:String(result.reason||result.state||'held'),projectId}
}
/** Record the outcome, fenced by this attempt's claim so a slower earlier attempt cannot overwrite a later one, then
 * delete the private copy: it is a transport buffer, kept only until the receipt is final. */
async function settle(env:Env,receipt:Receipt,outcome:Outcome){
 const now=Date.now(),key=receipt.object_key
 if(outcome.state==='pending_mailbox'){
  // No workspace receives on the mailbox yet. Nothing was admitted or held, and the wait is not a failed attempt.
  await env.DB.prepare("UPDATE legacy_mail_s3_receipts SET state='pending_mailbox',attempts=MAX(attempts-1,0),next_at=0,error=NULL,updated_at=? WHERE object_key=? AND state='processing' AND claimed_at=?").bind(now,key,receipt.claimed_at).run()
  return
 }
 const settled=await env.DB.prepare("UPDATE legacy_mail_s3_receipts SET state=?,reason=?,project_id=?,error=NULL,conversation_id=?,sender_address=coalesce(?,sender_address),updated_at=? WHERE object_key=? AND state='processing' AND claimed_at=? RETURNING raw_key").bind(outcome.state,outcome.reason,outcome.projectId,outcome.conversationId??null,outcome.sender??null,now,key,receipt.claimed_at).first<{raw_key:string|null}>()
 if(settled?.raw_key){await env.FILES.delete(settled.raw_key);await env.DB.prepare('UPDATE legacy_mail_s3_receipts SET raw_key=NULL WHERE object_key=? AND raw_key=?').bind(key,settled.raw_key).run()}
}
async function fail(env:Env,receipt:Receipt,error:unknown){
 if(waiting(error))return settle(env,receipt,{state:'pending_mailbox'})
 const now=Date.now(),code=error instanceof S3Error?error.code:error instanceof HTTPException?`http_${error.status}`:'processing_failed'
 console.error('Amazon SES reader attempt failed',code,receipt.attempts)
 // Unsafe keys and objects too large to fetch can never succeed, so they are not tried again.
 const terminal=error instanceof S3Error&&['unsafe_key','unsafe_prefix','prefix_changed','object_too_large'].includes(error.code)||receipt.attempts>=MAX_ATTEMPTS
 await env.DB.prepare("UPDATE legacy_mail_s3_receipts SET state=?,error=?,next_at=?,updated_at=? WHERE object_key=? AND state='processing' AND claimed_at=?").bind(terminal?'failed':'retry',code,now+Math.min(RETRY_CAP_MS,1000*2**receipt.attempts),now,receipt.object_key,receipt.claimed_at).run()
}
/** A message that arrived runs the effects of every door: the live broadcast, and the assistant's reply unless the mail is
 * automatic. They run after the receipt is final, and one failing never undoes an admitted message. */
async function runEffects(env:Env,result:any){
 const pending:Promise<unknown>[]=[]
 scheduleInboundEffects(env,{waitUntil:promise=>{pending.push(promise)}},result)
 for(const outcome of await Promise.allSettled(pending))if(outcome.status==='rejected')console.error('Amazon SES reader effect failed',outcome.reason instanceof Error?outcome.reason.name:'error')
}
