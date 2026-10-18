import type {Env} from '../../platform/env'
import {emailConfigured} from './email-provider'
import {localMailOrigin} from '../../edition/local-mail/configuration'
import {messageNotificationRecipients,type NotificationContact} from './notification-recipients'
import {notificationContactsSql} from './notification-contacts'

/** Durable attempts win; otherwise explain current recipient eligibility.
 * Provider acceptance is never called delivery, and reads never send mail. */
export async function messageMailStatus(env:Env,message:{id:string;project_id:string;actor_role:string;erased_at?:number}) {
 if(message.actor_role==='contact'||message.erased_at)return null
 const deliveryId=`message:${message.id}:notification`,prefix=deliveryId+':'
 const attempts=(await env.DB.prepare('SELECT state,updated_at FROM email_deliveries WHERE project_id=? AND (id=? OR substr(id,1,?)=?)').bind(message.project_id,deliveryId,prefix.length,prefix).all<{state:string;updated_at:number}>()).results
 if(localMailOrigin(env))return {state:'suppressed'}
 if(attempts.length)return {state:['uncertain','sending','failed'].find(state=>attempts.some(attempt=>attempt.state===state))||attempts[0].state,updatedAt:Math.max(...attempts.map(attempt=>attempt.updated_at))}
 if(!emailConfigured(env))return {state:'not_configured'}
 const settings=await env.DB.prepare('SELECT is_enabled FROM email_settings WHERE project_id=?').bind(message.project_id).first<{is_enabled:number}>()
 if(settings?.is_enabled===0)return {state:'disabled'}
 const [contacts,sender]=await env.DB.batch<NotificationContact>([
  env.DB.prepare(`SELECT ct.* FROM messages m JOIN (${notificationContactsSql}) ct ON ct.conversation_id=m.conversation_id AND ct.notification_project_id=m.project_id WHERE m.id=? AND m.project_id=?`).bind(message.id,message.project_id),
  env.DB.prepare('SELECT u.id,u.email FROM users u JOIN messages m ON m.actor_id=u.id WHERE m.id=? AND m.project_id=?').bind(message.id,message.project_id)
 ])
 return {state:messageNotificationRecipients(contacts.results,sender.results[0],message.actor_role).state}
}
