import {mailClaimSql} from '../knowledge/mail-door'
import type {Env} from '../../platform/env'
import type {EmailInput} from './email'
import {auditStatement} from '../audit/record'
import {settleHeldSchedule} from '../workflows/schedule-mail'

/** A MAIL_API_KEY rotation stops the old key at once and rebuilds the app with the
 * new one. A send refused at authenticate (`mail_credential_revoked` or
 * `mail_credential_required`) claimed no relay send row, so a conversation
 * notification (a scheduled reply's included) or a problem reply stays pending
 * with this reason and its message stays on the conversation outbox, whose
 * replay resends the same command with the key the running release holds.
 * `updated_at` keeps the first refusal instant; about an hour later the delivery
 * fails as an unavailable authority. */
export const rerMailHeld='Sending authority is being restored; this email will be sent again automatically'
export const authorityUnavailable='Sending authority is unavailable; Run Edit Run needs to restore it'
export const rerMailCredentialRefused=['mail_credential_revoked','mail_credential_required']
const holdMs=60*60*1000

/** A notification of the message named by the SQL expression `message` is held. */
export const rerMailHoldOpen=(message:string)=>`EXISTS(SELECT 1 FROM email_deliveries held WHERE held.id>='message:'||${message}||':notification' AND held.id<'message:'||${message}||':notification;' AND held.state='sending' AND held.error='${rerMailHeld}')`
/** A notification of this outbox row's message is held: completion waits for replay. */
export const openRerMailHold=rerMailHoldOpen('conversation_outbox.message_id')

/** Records the hold at its first refusal instant and returns the message to the
 * outbox, which a deferred send may have completed before this refusal arrived. */
export async function holdRerMail(env:Env,input:Pick<EmailInput,'idempotencyKey'|'projectId'>,since:number){
 const message=/^message:([^:]+):notification(?::|$)/.exec(input.idempotencyKey)
 await env.DB.batch([
  env.DB.prepare("UPDATE email_deliveries SET error=?,updated_at=? WHERE id=? AND state='sending' AND error IS NULL").bind(rerMailHeld,since,input.idempotencyKey),
  ...(message?[env.DB.prepare('UPDATE conversation_outbox SET delivered_at=NULL WHERE message_id=? AND project_id=?').bind(message[1],input.projectId??null)]:[]),
 ])
}

/** Claims one held command for a single resend to its recorded recipient. The hold
 * is cleared before the request, so a lost process leaves an unknown outcome that
 * is never sent again; a refused resend restores the same first refusal instant. */
export async function claimRerMailHold(env:Env,input:EmailInput){
 const row=await env.DB.prepare("SELECT updated_at FROM email_deliveries WHERE id=? AND recipient=? AND state='sending' AND error=? AND updated_at>?").bind(input.idempotencyKey,input.to,rerMailHeld,Date.now()-holdMs).first<{updated_at:number}>()
 if(!row)return null
 const guard=await mailClaimSql(env,input),claimed=await env.DB.prepare(`${guard.prefix}UPDATE email_deliveries SET error=NULL,updated_at=? WHERE id=? AND state='sending' AND error=? AND updated_at=? AND ${guard.sql}`).bind(...guard.params,Date.now(),input.idempotencyKey,rerMailHeld,row.updated_at).run()
 if(!claimed.meta.changes)await env.DB.prepare("UPDATE email_deliveries SET state='failed',error='Knowledge access changed; edit and resend for the current recipients',updated_at=? WHERE id=? AND state='sending' AND error=? AND updated_at=?").bind(Date.now(),input.idempotencyKey,rerMailHeld,row.updated_at).run()
 return claimed.meta.changes?row.updated_at:null
}

/** Fails the holds of one notification's fan-out that outlived the bound, settling a
 * scheduled reply of that message with them, then reports whether a hold is still
 * open for replay to resend. */
export async function openRerMailHolds(env:Env,deliveryId:string){
 const now=Date.now(),message=/^message:([^:]+):notification$/.exec(deliveryId),held=(await env.DB.prepare("SELECT d.id,d.updated_at,c.project_id FROM email_deliveries d JOIN rer_mail_commands c ON c.command_id=d.id WHERE d.id>=? AND d.id<? AND d.state='sending' AND d.error=?").bind(deliveryId,deliveryId+';',rerMailHeld).all<{id:string;updated_at:number;project_id:string}>()).results
 for(const row of held.filter(row=>now-row.updated_at>=holdMs)){
  const guard={sql:"EXISTS(SELECT 1 FROM email_deliveries WHERE id=? AND state='sending' AND error=? AND updated_at=?)",params:[row.id,rerMailHeld,row.updated_at]}
  await env.DB.batch([
   auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'managed_mail.send_rejected',outcome:'failed',actor:{type:'system'},source:'system',target:{type:'email_delivery',id:row.id}},now,guard),
   env.DB.prepare("UPDATE email_deliveries SET state='failed',error=?,updated_at=? WHERE id=? AND state='sending' AND error=? AND updated_at=?").bind(authorityUnavailable,now,row.id,rerMailHeld,row.updated_at),
   ...(message?[settleHeldSchedule(env,message[1],now)]:[]),
  ])
 }
 return held.some(row=>now-row.updated_at<holdMs)
}
