import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {notificationTicketSql} from '../integrations/triggers/eligibility'
import {deviceAuthority,liveDeviceSql,type Device} from './authority'
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
/** Native post-commit audience selection is the only producer. This slice
 * prepares redacted envelopes; there is deliberately no provider transport or
 * delivery claim. APNs/FCM integration and device receipts remain unproved. */
export async function prepareMobileNotice(env:Env,row:MobileNotice){
 const devices=await env.DB.prepare(`${liveDeviceSql} AND d.project_id=? AND d.user_id=? AND d.push_enabled=1 LIMIT 10`).bind(row.project_id,row.user_id).all<Device>()
 for(const device of devices.results){
  let a;try{a=await deviceAuthority(env,device,'push')}catch(error){if(error instanceof HTTPException&&[401,403].includes(error.status))continue;throw error}
  const id=crypto.randomUUID(),guard=audience(row)
  await env.DB.prepare(`INSERT OR IGNORE INTO mobile_links(id,device_id,conversation_id,notice_id,expires_at)
   SELECT ?,?,?,?,? WHERE ${a.guard.sql} AND ${guard.sql} AND EXISTS(SELECT 1 FROM mobile_devices WHERE id=? AND push_enabled=1)`)
   .bind(id,device.id,row.conversation_id,row.id,Math.min(Date.now()+86400000,device.expires_at),...a.guard.params,...guard.params,device.id).run()
 }
}
