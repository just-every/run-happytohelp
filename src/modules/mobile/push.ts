import type {Env} from '../../platform/env'
import {notificationTicketSql} from '../integrations/triggers/eligibility'
import type {MobileAuthority} from './authority'
export interface MobileNotice {id:string;project_id:string;conversation_id:string;user_id:string;kind:string}
// Opaque, device-bound routing only. Names, subjects, messages, attachments,
// workspace IDs, customer IDs and ticket IDs never enter a prepared OS payload.
export const redactedPush=(linkId:string)=>({title:'HappyToHelp',body:'A support ticket needs your attention.',link:`h2h://open/${linkId}`})
function audience(row:MobileNotice){
 const relation=row.kind==='assignment'||row.kind==='customer_updated'?'c.assigned_to=?':row.kind==='group'?`c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=c.project_id AND gm.group_id=c.group_id AND gm.user_id=?)`:row.kind==='follower'?`EXISTS(SELECT 1 FROM conversation_followers f WHERE f.conversation_id=c.id AND f.user_id=?)`:'1'
 return {sql:`EXISTS(SELECT 1 FROM notification_inbox n JOIN conversations c ON c.id=n.conversation_id AND c.project_id=n.project_id
 WHERE n.id=? AND n.project_id=? AND n.user_id=? AND n.inbox=1 AND ${relation}
 AND NOT EXISTS(SELECT 1 FROM notification_preferences p WHERE p.project_id=n.project_id AND p.user_id=n.user_id AND p.kind=n.kind AND p.inbox=0))
 AND EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)`,params:[row.id,row.project_id,row.user_id,...(relation==='1'?[]:[row.user_id]),row.conversation_id,row.project_id]}
}
/** Prepare only committed native inbox notices when the device requests them.
 * This does not add work to the native email/notification delivery budget and
 * makes no provider delivery claim. APNs/FCM and device receipts remain unproved. */
export async function prepareMobileNotices(env:Env,a:MobileAuthority){
 if(!a.device.push_enabled)return
 const notices=await env.DB.prepare(`SELECT n.id,n.project_id,n.conversation_id,n.user_id,n.kind FROM notification_inbox n
  WHERE n.project_id=? AND n.user_id=? AND n.inbox=1 AND n.created_at>=(SELECT created_at FROM mobile_devices WHERE id=?)
  AND NOT EXISTS(SELECT 1 FROM mobile_links l WHERE l.device_id=? AND l.notice_id=n.id)
  ORDER BY n.created_at DESC,n.id LIMIT 100`).bind(a.actor.projectId,a.actor.id,a.device.id,a.device.id).all<MobileNotice>()
 if(!notices.results.length)return
 await env.DB.batch(notices.results.map(row=>{
  const guard=audience(row)
  return env.DB.prepare(`INSERT OR IGNORE INTO mobile_links(id,device_id,conversation_id,notice_id,expires_at)
   SELECT ?,?,?,?,? WHERE ${a.guard.sql} AND ${guard.sql} AND EXISTS(SELECT 1 FROM mobile_devices WHERE id=? AND push_enabled=1)`)
   .bind(crypto.randomUUID(),a.device.id,row.conversation_id,row.id,Math.min(Date.now()+86400000,a.device.expires_at),...a.guard.params,...guard.params,a.device.id)
 }))
}
