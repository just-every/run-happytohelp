import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {writableConversationSql} from '../conversation-actions/merge-read'
import {clockSql,type MobileAuthority} from './authority'
export const scheduleSnapshotSql=(ticket='c.id')=>`(SELECT coalesce(json_group_array(json_array(id,version,state)), '[]') FROM (SELECT id,version,state FROM workflow_schedules WHERE conversation_id=${ticket} ORDER BY id))`
export interface Frontier {id:string;device_id:string;conversation_id:string;revision:number;last_message_id:string|null;ticket_version:number;schedules_json:string;expires_at:number}
export async function issueFrontier(env:Env,a:MobileAuthority,ticketId:string){
 const id=crypto.randomUUID(),expiresAt=Date.now()+5*60000
 const result=await env.DB.batch([
  env.DB.prepare(`DELETE FROM mobile_frontiers WHERE device_id=? AND expires_at<=${clockSql}`).bind(a.device.id),
  env.DB.prepare(`INSERT INTO mobile_frontiers(id,device_id,conversation_id,revision,last_message_id,ticket_version,schedules_json,expires_at)
   SELECT ?,?,c.id,c.revision,c.last_message_id,c.ticket_version,${scheduleSnapshotSql()},? FROM conversations c
   WHERE c.id=? AND c.project_id=? AND ${contactAvailableSql()} AND ${a.guard.sql}
   AND (SELECT count(*) FROM mobile_frontiers WHERE device_id=?)<100`).bind(id,a.device.id,expiresAt,ticketId,a.actor.projectId,...a.guard.params,a.device.id),
 ])
 if(!result[1].meta.changes)throw new HTTPException(409,{message:'Refresh this ticket before continuing'})
 return (await env.DB.prepare('SELECT * FROM mobile_frontiers WHERE id=?').bind(id).first<Frontier>())!
}
export async function loadFrontier(env:Env,a:MobileAuthority,ticketId:string,value:unknown){
 if(typeof value!=='string')throw new HTTPException(400,{message:'A reconnect frontier is required'})
 const row=await env.DB.prepare('SELECT * FROM mobile_frontiers WHERE id=? AND device_id=? AND conversation_id=?').bind(value,a.device.id,ticketId).first<Frontier>()
 if(!row)throw new HTTPException(409,{message:'Refresh this ticket before continuing'})
 return row
}
export function frontierGuard(a:MobileAuthority,f:Frontier){return {
 sql:`${a.guard.sql} AND EXISTS(SELECT 1 FROM mobile_frontiers f JOIN conversations c ON c.id=f.conversation_id
 WHERE f.id=? AND f.device_id=? AND c.project_id=? AND f.expires_at>${clockSql}
 AND c.revision=f.revision AND c.last_message_id IS f.last_message_id AND c.ticket_version=f.ticket_version
 AND ${scheduleSnapshotSql()}=f.schedules_json AND ${contactAvailableSql()} AND ${writableConversationSql('c')})`,
 params:[...a.guard.params,f.id,a.device.id,a.actor.projectId],
}}
