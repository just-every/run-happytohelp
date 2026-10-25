import {abandonedNotificationMs,abandonedNotificationReason} from './email-send-window'
import {rerMailHeld} from './rer-mail-hold'
import {cronConsumer,inCron} from '../../platform/cron-budget'
import type {Env} from '../../platform/env'
import {expireSuspendedEmails} from './suspended-store'
import {syncConnectedMailboxes} from './mailboxes'
import {receiveMailboxMessage} from './mailbox-ingress'

/** The integrations module's existing scheduled recovery entry point calls this;
 * the runtime/queue remains owned by R5. Each sync is one durable bounded page. */
export async function maintainEmail(env:Env){
 // One statement for all expired message claims, never a per-row replay. Open
 // managed holds have their own refusal/expiry lifecycle and remain untouched.
 const now=Date.now()
 await env.DB.prepare("UPDATE email_deliveries SET state='uncertain',error=?,updated_at=? WHERE state='sending' AND (id GLOB 'message:*:notification' OR id GLOB 'message:*:notification:*') AND updated_at<? AND error IS NOT ?").bind(abandonedNotificationReason,now,now-abandonedNotificationMs,rerMailHeld).run()
 await expireSuspendedEmails(inCron(env)?cronConsumer(env,6):env)
 await syncConnectedMailboxes(env,message=>receiveMailboxMessage(env,message))
}
