import {prepareMobileNotice} from '../mobile/push'
import type {Env} from '../../platform/env'
import {cronRoom} from '../../platform/cron-budget'
import {notificationTicket,notificationTicketSql} from './triggers/eligibility'
import {deliverNotification,loopSuppressionHeaders} from './notification-delivery'
import {emailConfigured} from './email'
import {recipientReplyAddress} from './email-reply-address'
import {notificationLabels} from './notification-kinds'
type Notice={id:string;project_id:string;conversation_id:string;user_id:string;kind:string;email:number;email_address:string}
/** Claim into uncertainty before any provider work. A process lost after this
 * commit leaves a visible outcome and cannot cause an automatic replay. */
export async function deliverTeammateNotice(env:Env,row:Notice){
 await prepareMobileNotice(env,row)
 const ticket=await notificationTicket(env,row.project_id,row.conversation_id)
 const user=await env.DB.prepare(`SELECT u.email,p.email preference,s.is_notifiable_on_conversation_assignment legacy_assignment,e.inbound_address,e.is_enabled
 FROM memberships m JOIN users u ON u.id=m.user_id LEFT JOIN notification_preferences p ON p.project_id=m.project_id AND p.user_id=m.user_id AND p.kind=?
 LEFT JOIN user_settings s ON s.user_id=m.user_id LEFT JOIN email_settings e ON e.project_id=m.project_id WHERE m.project_id=? AND m.user_id=?`).bind(row.kind,row.project_id,row.user_id).first<any>()
 const relation=row.kind==='assignment'?'c.assigned_to=?':row.kind==='group'?`c.assigned_to IS NULL AND EXISTS(SELECT 1 FROM ticket_group_members gm WHERE gm.project_id=c.project_id AND gm.group_id=c.group_id AND gm.user_id=?)`:row.kind==='follower'?`EXISTS(SELECT 1 FROM conversation_followers f WHERE f.conversation_id=c.id AND f.user_id=?)`:'1'
 const relationArgs=relation==='1'?[]:[row.user_id]
 const currentAudience=ticket&&await env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ${relation}`).bind(row.conversation_id,row.project_id,...relationArgs).first()
 const allowed=ticket&&user&&currentAudience&&row.email&&user.preference!==0&&!(row.kind==='assignment'&&user.preference==null&&user.legacy_assignment===0)&&user.is_enabled!==0
 if(!allowed){await env.DB.prepare("UPDATE notification_inbox SET state='complete' WHERE id=? AND state IN ('pending','awaiting_provider')").bind(row.id).run();return}
 if(!emailConfigured(env)){await env.DB.prepare("UPDATE notification_inbox SET state='awaiting_provider' WHERE id=? AND state='pending'").bind(row.id).run();return}
 const claim=await env.DB.prepare(`UPDATE notification_inbox SET state='uncertain' WHERE id=? AND state IN ('pending','awaiting_provider')
 AND EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)
 AND EXISTS(SELECT 1 FROM (${notificationTicketSql}) eligible)
 AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND ${relation})
 AND NOT EXISTS(SELECT 1 FROM notification_preferences WHERE project_id=? AND user_id=? AND kind=? AND email=0)`)
 .bind(row.id,row.project_id,row.user_id,row.conversation_id,row.project_id,row.conversation_id,row.project_id,...relationArgs,row.project_id,row.user_id,row.kind).run()
 if(!claim.meta.changes)return
 let state='uncertain'
 try{
  const url=typeof env.APP_ORIGIN==='string'?new URL(`/projects/${encodeURIComponent(row.project_id)}/conversations/${encodeURIComponent(row.conversation_id)}`,env.APP_ORIGIN).href:''
  const replyTo=user.inbound_address?await recipientReplyAddress(env,user.inbound_address,row.project_id,row.conversation_id,row.email_address):undefined
  const outcome=await deliverNotification(env,{projectId:row.project_id,to:row.email_address,subject:`Support ticket #${row.conversation_id}`,text:`${notificationLabels[row.kind]}${url?'\n\nOpen ticket: '+url:''}`,replyTo,headers:loopSuppressionHeaders({}),idempotencyKey:row.id})
  state=outcome.state==='sending'?'uncertain':outcome.state
 }catch{}
 await env.DB.prepare('UPDATE notification_inbox SET state=? WHERE id=?').bind(state,row.id).run()
}
export async function dispatchPendingTeammateNotifications(env:Env,options:{projectId?:string;conversationId?:string}={}){
 // Provider-blocked mail is dormant until configuration changes. Its inbox entry
 // already exists; it must never occupy the active delivery window every tick.
 const pending=await env.DB.prepare(`SELECT * FROM notification_inbox WHERE (state='pending' ${emailConfigured(env)?"OR state='awaiting_provider'":''}) ${options.projectId?'AND project_id=?':''} ${options.conversationId?'AND conversation_id=?':''} ORDER BY created_at,id LIMIT 100`)
 .bind(...(options.projectId?[options.projectId]:[]),...(options.conversationId?[options.conversationId]:[])).all<Notice>()
 // Includes reply-address proof, provider failure bookkeeping and final state.
 let visited=0
 for(const row of pending.results){if(!cronRoom(env,18))break;await deliverTeammateNotice(env,row);visited++}
 return visited<pending.results.length||pending.results.length===100
}
