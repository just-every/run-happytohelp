import type {Env} from '../../platform/env'

/** A scheduled reply's mail outcome. Mail held for a MAIL_API_KEY rotation leaves the
 * schedule sending with `scheduledMailHeld`; the hold's resend or expiry settles it
 * from the message's deliveries, exactly as an unheld first attempt is settled. Each
 * resend restarts the worker-stopped window, after which a schedule whose message has
 * no open hold settles from its deliveries, an unconfirmed one reading uncertain. */
export const scheduledMailHeld='Mail delivery is waiting for sending authority to be restored'
export const scheduledMailFailed='The reply was saved but its mail delivery failed'
export const scheduledMailUncertain='Mail delivery is uncertain; this reply will not be replayed'
const any=(states:string)=>`EXISTS(SELECT 1 FROM email_deliveries d WHERE d.id>='message:'||workflow_schedules.message_id||':notification' AND d.id<'message:'||workflow_schedules.message_id||':notification;' AND d.state IN (${states}))`
/** Main's order over the message's deliveries: uncertain or still sending, then failed, else sent. */
export const scheduledMailOutcome=`state=CASE WHEN ${any("'uncertain','sending'")} THEN 'uncertain' WHEN ${any("'failed'")} THEN 'failed' ELSE 'sent' END,reason=CASE WHEN ${any("'uncertain','sending'")} THEN '${scheduledMailUncertain}' WHEN ${any("'failed'")} THEN '${scheduledMailFailed}' END`
export function settleHeldSchedule(env:Env,messageId:string,now=Date.now()){
 return env.DB.prepare(`UPDATE workflow_schedules SET ${scheduledMailOutcome},updated_at=?,version=version+1 WHERE message_id=? AND state='sending' AND reason=? AND NOT ${any("'sending'")}`).bind(now,messageId,scheduledMailHeld)
}
export function resendHeldSchedule(env:Env,messageId:string,now=Date.now()){
 return env.DB.prepare("UPDATE workflow_schedules SET attempted_at=? WHERE message_id=? AND state='sending' AND reason=?").bind(now,messageId,scheduledMailHeld)
}
