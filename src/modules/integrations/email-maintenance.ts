import type {Env} from '../../platform/env'
import {expireSuspendedEmails} from './suspended-store'
import {syncConnectedMailboxes} from './mailboxes'
import {receiveMailboxMessage} from './mailbox-ingress'

/** The integrations module's existing scheduled recovery entry point calls this;
 * the runtime/queue remains owned by R5. Each sync is one durable bounded page. */
export async function maintainEmail(env:Env){
 await expireSuspendedEmails(env)
 await syncConnectedMailboxes(env,message=>receiveMailboxMessage(env,message))
}
