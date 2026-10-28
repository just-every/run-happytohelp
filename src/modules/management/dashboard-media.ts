import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {id,requiredString} from '../../platform/db'
import {scope} from './common'
import {requireTicketScope} from '../access/ticket-scope'
import {ticketAuthority} from '../tickets/model'
export const dashboardMedia=new Hono<AppEnv>()
dashboardMedia.post('/projects/:projectId/media',async c=>{
 const actor=await scope(c) as Actor,form=await c.req.formData(),file=form.get('file'),conversationId=requiredString(form.get('conversation_id'),'conversation_id')
 if(!(file instanceof File)||file.size<1||file.size>20000000)throw new HTTPException(400,{message:'File must be 1 byte to 20 MB'})
 await requireTicketScope(c.env,actor.id,actor.projectId,conversationId)
 const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply',conversationId),key=id(),objectKey=`${actor.projectId}/${conversationId}/${key}`
 await c.env.FILES.put(objectKey,await file.arrayBuffer(),{httpMetadata:{contentType:file.type||'application/octet-stream'}})
 try{
  const saved=await c.env.DB.prepare(`INSERT INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) SELECT ?,?,?,?,?,?,?,?,NULL,? WHERE EXISTS(${guard.sql})`).bind(key,actor.projectId,conversationId,actor.id,objectKey,file.name,file.type||'application/octet-stream',file.size,Date.now(),...guard.params).run()
  if(!saved.meta.changes)throw new HTTPException(409,{message:'The ticket or your access changed. Reload before uploading again.'})
 }catch(error){await c.env.FILES.delete(objectKey);throw error}
 return c.json({data:{id:key,filename_original:file.name,filename:file.name,size:file.size,aggregate_type:file.type.startsWith('image/')?'image':'file',url:`/api/conversations/${conversationId}/media/${key}`,preview_url:`/api/conversations/${conversationId}/media/${key}`}},201)
})
