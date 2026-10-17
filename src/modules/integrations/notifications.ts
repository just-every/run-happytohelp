import {notifyTicketEvent} from './triggers'
import type {Actor,Env} from '../../platform/env'
import {sendEmails,emailConfigured,type EmailInput,type EmailOutcome,type DeferEmailDelivery} from './email'
import {renderConversationEmail} from './email-content'
import {recipientReplyAddress} from './email-reply-address'
import {withChatReplyNotice} from './reply-notice'
import {loopSuppressionHeaders} from './notification-delivery'
import {queueOperatorActivity} from './operator-activity'
import {notificationRecipients,type NotificationContact} from './notification-recipients'
export {notificationAddress} from './notification-recipients'
export {loopSuppressionHeaders} from './notification-delivery'
export {assignmentNotificationStatement,dispatchOperatorNotifications} from './operator-notifications'

type Recorded={state:string;provider_id:string|null;recipient:string}
function outcome(deliveries:EmailOutcome[]){
 const first=deliveries[0]
 const state=['uncertain','sending','failed'].find(state=>deliveries.some(delivery=>delivery.state===state))||first.state
 return {...first,state,recipients:deliveries}
}
async function recorded(env:Env,id:string,observed?:Recorded){
 const first=observed||await env.DB.prepare('SELECT state,provider_id,recipient FROM email_deliveries WHERE id=?').bind(id).first<Recorded>()
 if(!first)return null
 const prefix=id+':',others=await env.DB.prepare('SELECT state,provider_id,recipient FROM email_deliveries WHERE substr(id,1,?)=? ORDER BY id').bind(prefix.length,prefix).all<Recorded>()
 return outcome([first,...others.results].map(row=>({state:row.state,id:row.provider_id,recipient:row.recipient})))
}
/** Called after commit. The historical primary ID fences the entire fan-out;
 * edited addresses or newly added participants cannot turn replay into new mail. */
export async function notifyMessage(env:Env,message:any,actor:Actor,defer?:DeferEmailDelivery){
 const deliveryId=`message:${message.id}:notification`,configured=emailConfigured(env)
 const senderId=message.actor_id||(message.actor_role==='contact'?actor.contactId||actor.id:message.actor_role==='ai'?null:actor.id)
 // Observe current authority, destinations and preparation together. The primary
 // claim still fences the complete fan-out before any recipient is reconstructed
 // on replay, and sendEmails claims every destination in one transaction.
 const data=await env.DB.batch<any>([
  env.DB.prepare('SELECT state,provider_id,recipient FROM email_deliveries WHERE id=?').bind(deliveryId),
  env.DB.prepare("SELECT p.id FROM projects p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)").bind(actor.projectId),
  ...(configured?[
   env.DB.prepare('SELECT c.*,ct.email,ct.metadata_json FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=?').bind(message.conversation_id,actor.projectId),
   env.DB.prepare('SELECT * FROM email_settings WHERE project_id=?').bind(actor.projectId),
   env.DB.prepare('SELECT ct.id,ct.email,ct.metadata_json FROM contacts ct JOIN conversations c ON c.project_id=ct.project_id WHERE c.id=? AND c.project_id=? AND (ct.id=c.contact_id OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.contact_id=ct.id)) ORDER BY CASE WHEN ct.id=c.contact_id THEN 0 ELSE 1 END,ct.id').bind(message.conversation_id,actor.projectId),
   ...(senderId?[message.actor_role==='contact'
    ?env.DB.prepare('SELECT id,email,metadata_json FROM contacts WHERE id=? AND project_id=?').bind(senderId,actor.projectId)
    :env.DB.prepare('SELECT u.id,u.email FROM users u JOIN messages m ON m.actor_id=u.id WHERE u.id=? AND m.id=? AND m.project_id=? AND m.conversation_id=?').bind(senderId,message.id,actor.projectId,message.conversation_id)]:[])
  ]:[])
 ])
 const prior=data[0].results[0]
 if(prior)return recorded(env,deliveryId,prior)
 if(!data[1].results[0])return {state:'project_deleted'}
 const operatorActivity=message.actor_role==='contact'?await queueOperatorActivity(env,message,actor.projectId):null
 if(operatorActivity?.state==='automatic')return operatorActivity
 if(message.actor_role==='contact'){
  await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:message.conversation_id,event:'request_received',eventId:String(message.id),actorId:senderId})
  await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:message.conversation_id,event:'customer_updated',eventId:String(message.id),actorId:senderId})
 }
 if(message.actor_role!=='contact')await notifyTicketEvent(env,{projectId:actor.projectId,conversationId:message.conversation_id,event:'ticket_updated',eventId:String(message.id),actorId:senderId})
 if(!configured)return {state:'not_configured'}
 const conversation=data[2].results[0]
 if(!conversation)return {state:'not_found'}
 const settings=data[3].results[0]
 if(settings?.is_enabled===0)return {state:'disabled'}
 const contacts=data[4].results as NotificationContact[]
 const sender=senderId?(message.actor_role==='contact'
   ?contacts.find(contact=>contact.id===senderId)||data[5]?.results[0]
   :data[5]?.results[0]):undefined
 const {recipients,state}=notificationRecipients(contacts,sender,message.actor_role==='contact'?senderId:undefined)
 if(!recipients.length)return operatorActivity||{state}
 const {omitted,...content}=await renderConversationEmail(env,{projectId:actor.projectId,conversationId:conversation.id,messages:[message]})
 const inputs:EmailInput[]=await Promise.all(recipients.map(async(recipient,index)=>{const replyTo=settings?await recipientReplyAddress(env,settings.inbound_address,actor.projectId,conversation.id,recipient.email):undefined;return {...(replyTo?content:await withChatReplyNotice(env,actor.projectId,content)),replyTo,projectId:actor.projectId,to:recipient.email,subject:'Reply to your support conversation',headers:loopSuppressionHeaders(message),idempotencyKey:index===0?deliveryId:`${deliveryId}:contact:${recipient.id}`}}))
 try{return outcome(await sendEmails(env,inputs,defer))}
 catch(error){const existing=await recorded(env,deliveryId);if(existing)return existing;throw error}
}
