import type {Env} from '../../platform/env'
import {thread} from '../support-channels/model'
import {blocker} from '../support-channels/outbound'

export const problemMessagingChannel=(channel:string)=>channel==='sms'||channel==='whatsapp'

/** Freeze only routing/consent evidence, never provider credentials. An inbound
 * support reply uses the sender's existing consent rules, without a template. */
export async function problemChannelDestination(env:Env,projectId:string,ticket:any){
 const t=await thread(env,projectId,ticket.id)
 if(!t||t.contact_id!==ticket.contact_id||t.provider!==ticket.channel)return {reason:'Original requester channel is unavailable; no cross-channel reply will be sent'}
 const reason=blocker(t)
 if(reason)return {reason}
 return {recipient:t.recipient,thread_id:t.id,connection_id:t.connection_id,identity_hash:t.identity_hash,channel_id:t.channel_id,thread_key:t.thread_key,sender:t.sender,account:t.account,reply_consent_at:t.reply_consent_at,last_inbound_at:t.last_inbound_at}
}

/** Composed into message admission and the delivery claim, against their live c.
 * STOP, erasure, disconnection, registration and the reply window cannot be
 * authorized by a stored preview. */
export function problemChannelGuard(destination:any){
 if(!problemMessagingChannel(destination.channel))return {sql:'1',args:[]}
 return {sql:`EXISTS(WITH reviewed_channel AS MATERIALIZED (SELECT t.project_id,t.contact_id,sc.provider FROM support_channel_threads t JOIN support_channel_connections sc ON sc.id=t.connection_id AND sc.project_id=t.project_id WHERE t.id=? AND t.connection_id=? AND t.identity_hash=? AND t.recipient=? AND t.channel_id=? AND t.thread_key=? AND sc.sender=? AND sc.account=? AND t.reply_consent_at=? AND t.last_inbound_at=? AND t.opted_out=0 AND sc.revoked_at IS NULL AND sc.token_cipher IS NOT NULL AND (sc.provider!='sms' OR sc.registered=1) AND (sc.provider!='whatsapp' OR t.last_inbound_at>=?) AND NOT EXISTS(SELECT 1 FROM support_channel_fences f WHERE f.connection_id=t.connection_id AND f.identity_hash=t.identity_hash)) SELECT 1 FROM reviewed_channel WHERE project_id=c.project_id AND contact_id=c.contact_id AND provider=c.channel)`,args:[destination.thread_id,destination.connection_id,destination.identity_hash,destination.recipient,destination.channel_id,destination.thread_key,destination.sender,destination.account,destination.reply_consent_at,destination.last_inbound_at,Date.now()-86400000]}
}

/** Provider acknowledgment is neither confirmed delivery nor customer recovery.
 * Readback observes later callbacks; it never sends or changes ticket status. */
export function problemChannelOutcome(receipt:{state:string;error_code:string|null}|null){
 const state=receipt&&['accepted','delivered','failed','blocked','uncertain'].includes(receipt.state)?receipt.state:'uncertain'
 const reason=state==='accepted'?'Provider accepted the reply; delivery is unconfirmed and the incident remains open.'
  :state==='delivered'?'The channel reports delivery. Customer recovery is unconfirmed; the incident status is unchanged.'
  :state==='failed'?'Channel provider rejected or failed delivery; the incident remains open.'
  :state==='blocked'?'Channel delivery was refused; the incident remains open.'
  :'Channel delivery is uncertain; the incident remains open and this send will not be replayed.'
 return {state,reason:reason+(receipt?.error_code?` (${receipt.error_code})`:'')}
}
