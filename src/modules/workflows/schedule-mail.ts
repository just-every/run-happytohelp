import type {Env} from '../../platform/env'

/** A scheduled reply's mail outcome. Mail held for a MAIL_API_KEY rotation leaves the
 * schedule sending with `scheduledMailHeld`; the hold's resend or expiry settles it
 * from the message's deliveries, exactly as an unheld first attempt is settled. */
export const scheduledMailHeld='Mail delivery is waiting for sending authority to be restored'
export const scheduledMailFailed='The reply was saved but its mail delivery failed'
export const scheduledMailUncertain='Mail delivery is uncertain; this reply will not be replayed'
export function settleHeldSchedule(env:Env,messageId:string,now=Date.now()){
 const any=(state:string)=>`EXISTS(SELECT 1 FROM email_deliveries d WHERE d.id>='message:'||?1||':notification' AND d.id<'message:'||?1||':notification;' AND d.state='${state}')`
 return env.DB.prepare(`UPDATE workflow_schedules SET state=CASE WHEN ${any('uncertain')} THEN 'uncertain' WHEN ${any('failed')} THEN 'failed' ELSE 'sent' END,reason=CASE WHEN ${any('uncertain')} THEN ?3 WHEN ${any('failed')} THEN ?4 END,updated_at=?2,version=version+1 WHERE message_id=?1 AND state='sending' AND reason=?5 AND NOT ${any('sending')}`).bind(messageId,now,scheduledMailUncertain,scheduledMailFailed,scheduledMailHeld)
}
