import {ticketScopeSql} from '../access/ticket-scope'
import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {availableTicketSql} from '../tickets/model'
export async function validateAttachments(env:Env,actor:Actor,ids:string[],owned=false){
 const rows=[]
 for(const id of ids){
  const row=await env.DB.prepare(`SELECT media.*,coalesce(cp.source_contact_id,c.contact_id) source_contact_id FROM media JOIN conversations c ON c.id=media.conversation_id LEFT JOIN macro_attachment_copies cp ON cp.media_id=media.id AND cp.project_id=media.project_id WHERE media.id=? AND media.project_id=? AND c.project_id=media.project_id AND ${availableTicketSql()} AND ${ticketScopeSql('?')} AND EXISTS(SELECT 1 FROM contacts root WHERE root.id=coalesce(cp.source_contact_id,c.contact_id) AND root.project_id=c.project_id AND coalesce(json_extract(root.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(root.metadata_json,'$.is_erasing'),0)!=1) ${owned?'AND media.uploaded_by=?':''}`).bind(id,actor.projectId,actor.id,...(owned?[actor.id]:[])).first<any>()
  if(!row)throw new HTTPException(400,{message:'A macro attachment is unavailable or belongs to another workspace'})
  rows.push(row)
 }
 return rows
}
/** Copy bytes before admission; rows are created in the guarded macro transaction.
 * An unadmitted copy is removed. Existing objects are never shared by identity. */
export async function copyAttachments(env:Env,actor:Actor,conversationId:string,rows:any[]){
 const copies:any[]=[]
 try{for(const source of rows){
  const object=await env.FILES.get(source.object_key)
  if(!object)throw new HTTPException(409,{message:'A macro attachment is no longer available'})
  const id=crypto.randomUUID(),object_key=`${actor.projectId}/macro-drafts/${id}`
  copies.push({...source,id,object_key,conversation_id:conversationId,uploaded_by:actor.id,source_media_id:source.id,source_contact_id:source.source_contact_id,created_at:Date.now()})
  await env.FILES.put(object_key,object.body,{httpMetadata:object.httpMetadata})
 }}catch(error){await Promise.all(copies.map(row=>env.FILES.delete(row.object_key)));throw error}
 return {copies,cleanup:()=>Promise.all(copies.map(row=>env.FILES.delete(row.object_key)))}
}
export function attachmentStatements(env:Env,rows:any[],guard:string,params:any[]){return rows.flatMap(row=>[env.DB.prepare(`INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) SELECT ?,?,?,?,?,?,?,?,NULL,? WHERE ${guard}`).bind(row.id,row.project_id,row.conversation_id,row.uploaded_by,row.object_key,row.filename,row.content_type,row.size,row.created_at,...params),env.DB.prepare(`INSERT INTO macro_attachment_copies(media_id,project_id,source_media_id,source_contact_id) SELECT ?,?,?,? WHERE ${guard}`).bind(row.id,row.project_id,row.source_media_id,row.source_contact_id,...params)])}

/** Embed in canonical media reads to fence the ancestry during contact erasure. */
export const macroAttachmentAvailableSql=(alias='media')=>`(NOT EXISTS(SELECT 1 FROM macro_attachment_copies cp WHERE cp.media_id=${alias}.id AND cp.project_id=${alias}.project_id) OR EXISTS(SELECT 1 FROM macro_attachment_copies cp JOIN contacts root ON root.id=cp.source_contact_id AND root.project_id=cp.project_id WHERE cp.media_id=${alias}.id AND cp.project_id=${alias}.project_id AND coalesce(json_extract(root.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(root.metadata_json,'$.is_erasing'),0)!=1))`
