import {ticketScopeSql} from '../access/ticket-scope'
import type {Env} from '../../platform/env'
import type {TicketNotificationEvent} from './triggers'
import {notificationTicket,notificationTicketSql} from './triggers/eligibility'
import {deliverTeammateNotice} from './notification-teammate-delivery'
export {teammateKinds,notificationLabels} from './notification-kinds'
/** Membership is this edition's live ticket read boundary, including collaborators.
 * Every event freezes its entire audience before any inbox or provider effect. */
export async function teammateTicketNotification(env:Env,event:TicketNotificationEvent){
 const claimEvent=`team:${event.event}:${event.eventId}`,claimId=`ticket-notice:${event.projectId}:${event.conversationId}:${claimEvent}`
 if(await env.DB.prepare('SELECT 1 FROM notification_trigger_claims WHERE id=?').bind(claimId).first())return {state:'recorded'}
 const ticket=await notificationTicket(env,event.projectId,event.conversationId)
 if(!ticket)return {state:'suppressed'}
 const selected=new Map<string,string>()
 if(['customer_updated','ticket_updated','mention'].includes(event.event)){
  if(event.event==='customer_updated'&&ticket.assigned_to)selected.set(ticket.assigned_to,'customer_updated')
  const followers=await env.DB.prepare('SELECT user_id FROM conversation_followers WHERE conversation_id=?').bind(ticket.id).all<{user_id:string}>()
  for(const row of followers.results)if(!selected.has(row.user_id))selected.set(row.user_id,'follower')
 }
 if((event.event==='group'||event.event==='customer_updated')&&!ticket.assigned_to&&ticket.group_id){
  const group=await env.DB.prepare('SELECT user_id FROM ticket_group_members WHERE project_id=? AND group_id=?').bind(event.projectId,ticket.group_id).all<{user_id:string}>()
  for(const row of group.results)if(!selected.has(row.user_id))selected.set(row.user_id,'group')
 }
 if(['assignment','follower','mention'].includes(event.event))for(const userId of [...new Set(event.recipientIds??[])].slice(0,100))selected.set(userId,event.event)
 const rows=[]
 for(const [userId,kind] of selected){
  if(userId===event.actorId||kind==='assignment'&&ticket.assigned_to!==userId)continue
  const preference=await env.DB.prepare(`SELECT u.email email_address,coalesce(p.inbox,1) inbox,coalesce(p.email,CASE WHEN ?='assignment' THEN coalesce(s.is_notifiable_on_conversation_assignment,1) ELSE 1 END) email
   FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN notification_preferences p ON p.project_id=m.project_id AND p.user_id=m.user_id AND p.kind=? LEFT JOIN user_settings s ON s.user_id=m.user_id
   WHERE m.project_id=? AND m.user_id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND ${ticketScopeSql('m.user_id')})`).bind(kind,kind,event.projectId,userId,ticket.id).first<{inbox:number;email:number;email_address:string}>()
  if(!preference)continue
  // Assigned-customer email remains in the existing coalesced digest.
  rows.push({id:event.event==='assignment'&&event.eventId.startsWith('assignment:')?event.eventId:`team-notice:${event.projectId}:${event.event}:${event.eventId}:${userId}`,project_id:event.projectId,conversation_id:ticket.id,user_id:userId,kind,inbox:preference.inbox,email:kind==='customer_updated'?0:preference.email,email_address:preference.email_address,preference_email:preference.email})
 }
 const claimToken=crypto.randomUUID(),now=Date.now()
 const claim=env.DB.prepare(`INSERT OR IGNORE INTO notification_trigger_claims(id,project_id,conversation_id,event,claim_token,state,outcome_json,created_at)
 SELECT ?,?,?,?,?,'complete',?,? WHERE EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)
 AND NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN notification_preferences p ON p.project_id=m.project_id AND p.user_id=m.user_id AND p.kind=json_extract(selected.value,'$.kind') LEFT JOIN user_settings s ON s.user_id=m.user_id WHERE m.project_id=? AND m.user_id=json_extract(selected.value,'$.user_id') AND u.email IS json_extract(selected.value,'$.email_address') AND coalesce(p.inbox,1)=json_extract(selected.value,'$.inbox') AND coalesce(p.email,CASE WHEN json_extract(selected.value,'$.kind')='assignment' THEN coalesce(s.is_notifiable_on_conversation_assignment,1) ELSE 1 END)=json_extract(selected.value,'$.preference_email') AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND ${ticketScopeSql('m.user_id')})))`)
 .bind(claimId,event.projectId,ticket.id,claimEvent,claimToken,JSON.stringify({recipients:rows.map(row=>row.user_id)}),now,ticket.id,event.projectId,JSON.stringify(rows),event.projectId,ticket.id)
 const result=await env.DB.batch([claim,...rows.map(row=>env.DB.prepare(`INSERT OR IGNORE INTO notification_inbox(id,project_id,conversation_id,user_id,kind,inbox,email,email_address,created_at)
 SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM notification_trigger_claims WHERE id=? AND claim_token=?)`).bind(row.id,row.project_id,row.conversation_id,row.user_id,row.kind,row.inbox,row.email,row.email_address,now,claimId,claimToken))])
 if(!result[0].meta.changes)return {state:'recorded'}
 for(const row of rows)await deliverTeammateNotice(env,row)
 return {state:'complete',notifications:rows.map(row=>row.id)}
}
