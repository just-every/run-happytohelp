import type {Env} from '../../../platform/env'
import {nativeId,sourceId} from '../readers/common'
import {fenced,type AttachmentRun} from './store'
const LEDGER='move_in_zendesk_attachments'
/** One attachment on a comment the workspace holds. The content URL and file metadata
 * live only in this invocation's memory; the ledger keeps ids, state and reason. */
export interface Found {attachmentId:string;commentId:string;messageId:string;visible:0|1;mediaId:string;contentUrl:unknown;fileName:unknown;contentType:unknown;deleted:boolean;malware:boolean;createdAt:number}
const id=(value:unknown)=>{try{return sourceId(value,'zendesk')}catch{return null}}
/** The workspace's next imported Zendesk ticket after the cursor, in ticket-id order. */
export const nextTicket=(env:Env,projectId:string,after:string|null|undefined)=>env.DB.prepare("SELECT source_id ticket,conversation_id conversation FROM move_in_conversations WHERE project_id=? AND vendor='zendesk' AND CAST(source_id AS INTEGER)>? ORDER BY CAST(source_id AS INTEGER) LIMIT 1").bind(projectId,after?Number(after):-1).first<{ticket:string;conversation:string}>()
export const heldTicket=(env:Env,projectId:string,ticket:string)=>env.DB.prepare("SELECT source_id ticket,conversation_id conversation FROM move_in_conversations WHERE project_id=? AND vendor='zendesk' AND source_id=?").bind(projectId,ticket).first<{ticket:string;conversation:string}>()
/** Every attachment on this page's comments that the workspace holds, as a message (shown
 * to the team and the conversation's customer) or as a private note (team only). What the
 * workspace holds decides the visibility; comments it does not hold are skipped. */
export async function pageAttachments(env:Env,projectId:string,ticket:string,conversation:string,comments:any[]):Promise<Found[]>{
 const withFiles=comments.flatMap(comment=>{const commentId=comment&&Array.isArray(comment.attachments)&&comment.attachments.length?id(comment.id):null;return commentId?[{comment,commentId,messageId:nativeId(projectId,'zendesk','message',`${ticket}:${commentId}`)}]:[]})
 if(!withFiles.length)return []
 const held=new Map((await env.DB.prepare("SELECT j.value id,CASE WHEN EXISTS(SELECT 1 FROM messages m WHERE m.id=j.value AND m.project_id=?1 AND m.conversation_id=?2 AND m.erased_at IS NULL) THEN 1 WHEN EXISTS(SELECT 1 FROM move_in_notes n WHERE n.id=j.value AND n.project_id=?1 AND n.conversation_id=?2) THEN 0 END visible FROM json_each(?3) j").bind(projectId,conversation,JSON.stringify(withFiles.map(c=>c.messageId))).all<{id:string;visible:0|1|null}>()).results.filter(row=>row.visible!==null).map(row=>[row.id,row.visible as 0|1]))
 const found:Found[]=[],seen=new Set<string>()
 for(const {comment,commentId,messageId} of withFiles){
  const visible=held.get(messageId);if(visible===undefined)continue
  for(const a of comment.attachments){
   const attachmentId=id(a?.id);if(!attachmentId||seen.has(attachmentId))continue;seen.add(attachmentId)
   found.push({attachmentId,commentId,messageId,visible,mediaId:nativeId(projectId,'zendesk','media',`${messageId}:${attachmentId}`),contentUrl:a.content_url,fileName:a.file_name,contentType:a.content_type,deleted:a.deleted===true,malware:a.malware_scan_result==='malware_found'&&a.malware_access_override!==true,createdAt:Date.parse(comment.created_at)||Date.now()})
  }
 }
 return found
}
/** New attachments enter the ledger as pending before any download; any whose file is
 * already in (supplied offline, or stored by an earlier run) is marked stored. A ticket
 * Zendesk returns again leaves the missing-ticket list. */
export function recordPage(env:Env,run:AttachmentRun,ticket:string,conversation:string,found:Found[]){
 const now=Date.now(),rows=JSON.stringify(found.map(f=>({a:f.attachmentId,c:f.commentId,m:f.messageId,v:f.visible,d:f.mediaId}))),ids=JSON.stringify(found.map(f=>f.attachmentId))
 return fenced(env,run,[
  env.DB.prepare('DELETE FROM move_in_zendesk_attachment_tickets WHERE project_id=? AND ticket_id=?').bind(run.project_id,ticket),
  env.DB.prepare(`INSERT OR IGNORE INTO ${LEDGER}(project_id,attachment_id,ticket_id,comment_id,conversation_id,message_id,visible,media_id,state,updated_at) SELECT ?,json_extract(value,'$.a'),?,json_extract(value,'$.c'),?,json_extract(value,'$.m'),json_extract(value,'$.v'),json_extract(value,'$.d'),'pending',? FROM json_each(?)`).bind(run.project_id,ticket,conversation,now,rows),
  env.DB.prepare(`UPDATE ${LEDGER} SET state='stored',reason=NULL,run_id=?,updated_at=? WHERE project_id=? AND state<>'stored' AND attachment_id IN (SELECT value FROM json_each(?)) AND EXISTS(SELECT 1 FROM media WHERE media.id=${LEDGER}.media_id AND media.project_id=${LEDGER}.project_id)`).bind(run.id,now,run.project_id,ids)])
}
/** What this run still fetches on the page: no file in yet, and not already refused by this run. */
export async function unfetched(env:Env,run:AttachmentRun,found:Found[]){
 if(!found.length)return []
 const ids=new Set((await env.DB.prepare(`SELECT l.attachment_id id FROM ${LEDGER} l WHERE l.project_id=? AND l.attachment_id IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM media m WHERE m.id=l.media_id) AND NOT (l.state='refused' AND l.run_id IS ?)`).bind(run.project_id,JSON.stringify(found.map(f=>f.attachmentId)),run.id).all<{id:string}>()).results.map(row=>String(row.id)))
 return found.filter(f=>ids.has(f.attachmentId))
}
/** Refusals by attachment id with a reason code, written together. */
export function recordRefusals(env:Env,run:AttachmentRun,refusals:{a:string;r:string}[]){
 return fenced(env,run,[env.DB.prepare(`UPDATE ${LEDGER} SET state='refused',reason=json_extract(r.value,'$.r'),run_id=?,updated_at=? FROM json_each(?) r WHERE ${LEDGER}.project_id=? AND ${LEDGER}.attachment_id=json_extract(r.value,'$.a') AND ${LEDGER}.state<>'stored'`).bind(run.id,Date.now(),JSON.stringify(refusals),run.project_id)])
}
export const recordMissingTicket=(env:Env,run:AttachmentRun,ticket:string,reason:string)=>fenced(env,run,[env.DB.prepare('INSERT OR REPLACE INTO move_in_zendesk_attachment_tickets(project_id,ticket_id,reason,run_id,updated_at) VALUES(?,?,?,?,?)').bind(run.project_id,ticket,reason,run.id,Date.now())])
