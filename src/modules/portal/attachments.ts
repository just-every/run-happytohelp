import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {enforceRateLimits} from '../../platform/rate-limits'
import {mediaResponseHeaders} from '../conversations/media-response'
import {auditStatement} from '../audit/record'
import {portalSessionGuard,type PortalIdentity} from './identity'
import {portalRequest} from './requests'

export async function attachPortalFile(env:Env,identity:PortalIdentity,ticketId:string,file:{data:ArrayBuffer;filename:string;contentType:string}){
 await portalRequest(env,identity,ticketId)
 if(!file.data.byteLength||file.data.byteLength>20000000)throw new HTTPException(413,{message:'Choose an attachment up to 20 MB'})
 if(file.filename.length>255||/[\r\n\u0000]/.test(file.filename)||file.contentType.length>200)throw new HTTPException(400,{message:'Invalid attachment'})
 await enforceRateLimits(env,[['uploadsPerContactDay',identity.actor.id],['uploadBytesPerContactDay',identity.actor.id,file.data.byteLength],['uploadsPerProjectDay',identity.actor.projectId],['uploadBytesPerProjectDay',identity.actor.projectId,file.data.byteLength]])
 const id=crypto.randomUUID(),key=`${identity.actor.projectId}/${ticketId}/${id}`,guard=portalSessionGuard(identity)
 await env.FILES.put(key,file.data,{httpMetadata:{contentType:file.contentType}})
 try{
  const result=await env.DB.prepare(`INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,created_at) SELECT ?,c.project_id,c.id,?,?,?,?,?,? FROM conversations c WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND c.status_category<>'closed' AND ${guard.sql}`).bind(id,identity.actor.id,key,file.filename,file.contentType,file.data.byteLength,Date.now(),ticketId,identity.actor.projectId,identity.actor.id,...guard.args).run()
  if(!result.meta.changes)throw new HTTPException(409,{message:'Request or access changed'})
 }catch(error){await env.FILES.delete(key);throw error}
 await auditStatement(env.DB,{projectId:identity.actor.projectId,category:'data',action:'portal.attachment.uploaded',actor:{type:'system'},source:'api',target:{type:'media',id}}).run()
 return {id,filename:file.filename,contentType:file.contentType,size:file.data.byteLength}
}
export async function readPortalFile(env:Env,identity:PortalIdentity,ticketId:string,mediaId:string){
 const guard=portalSessionGuard(identity)
 const row=await env.DB.prepare(`SELECT m.object_key,m.content_type,m.filename FROM media m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=? AND c.id=? AND c.project_id=? AND c.contact_id=? AND m.message_id IS NOT NULL AND ${guard.sql}`).bind(mediaId,ticketId,identity.actor.projectId,identity.actor.id,...guard.args).first<{object_key:string;content_type:string;filename:string}>()
 if(!row)throw new HTTPException(404)
 const object=await env.FILES.get(row.object_key)
 if(!object)throw new HTTPException(404)
 // Recheck after R2 so erasure or session revocation cannot release stale bytes.
 const live=portalSessionGuard(identity)
 if(!await env.DB.prepare(`SELECT 1 FROM media m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=? AND c.id=? AND c.project_id=? AND c.contact_id=? AND m.object_key=? AND m.message_id IS NOT NULL AND ${live.sql}`).bind(mediaId,ticketId,identity.actor.projectId,identity.actor.id,row.object_key,...live.args).first())throw new HTTPException(404)
 return new Response(object.body,{headers:{...mediaResponseHeaders(row.content_type,row.filename),'Cache-Control':'private, no-store'}})
}
