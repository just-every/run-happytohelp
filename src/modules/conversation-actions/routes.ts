import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {dashboardAccess} from '../management/dashboard'
import {ticketAuthority} from '../tickets/model'
import {mergeConversations,previewMerge,undoMerge} from './merge'
import {mergeHistory,operatorThreadIds} from './merge-read'
import {forwardToPartner,previewPartnerForward} from './partner-forward'
import {bucketsData} from '../management/buckets'

export const conversationActionRoutes=new Hono<AppEnv>()
const path='/projects/:projectId/conversations/:conversationId'
conversationActionRoutes.post(`${path}/merge/preview`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await previewMerge(c.env,actor,conversation.id,await c.req.json(),{sessionHash:c.get('sessionHash')})})})
conversationActionRoutes.post(`${path}/merge`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await mergeConversations(c.env,actor,conversation.id,await c.req.json(),{sessionHash:c.get('sessionHash')})},201)})
conversationActionRoutes.get(`${path}/merges`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await mergeHistory(c.env,actor.projectId,conversation.id,actor.id)})})
conversationActionRoutes.post(`${path}/merges/:mergeId/undo`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await undoMerge(c.env,actor,conversation.id,c.req.param('mergeId'),{sessionHash:c.get('sessionHash')})})})
// Per-source pagination preserves the native bucket hydration and attachment urls.
conversationActionRoutes.get(`${path}/merged-history`,async c=>{
 const {actor,conversation}=await dashboardAccess(c),ids=await operatorThreadIds(c.env,actor.projectId,conversation.id,actor.id),data=[],page=Math.max(1,Math.min(100000,Number(c.req.query('page'))||1))
 for(const id of ids){
  const source=await c.env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(id,actor.projectId).first<any>();if(!source)continue
  const buckets=(await c.env.DB.prepare('SELECT id FROM (SELECT id,created_at FROM conversation_buckets WHERE conversation_id=? UNION SELECT id,created_at FROM conversations WHERE id=?) ORDER BY created_at DESC,id LIMIT 10 OFFSET ?').bind(id,id,(page-1)*10).all<{id:string}>()).results
  data.push({conversation_id:id,subject:source.subject,channel:source.channel,contact_id:source.contact_id,source_link:`/conversations/${id}`,buckets:await bucketsData(c.env,source,buckets.map(b=>b.id))})
 }
 return c.json({data,meta:{page,per_source:10}})
})
conversationActionRoutes.post(`${path}/partner-forwards/preview`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await previewPartnerForward(c.env,actor,conversation,await c.req.json(),{sessionHash:c.get('sessionHash')})})})
conversationActionRoutes.post(`${path}/partner-forwards`,async c=>{const {actor,conversation}=await dashboardAccess(c);return c.json({data:await forwardToPartner(c.env,actor,conversation,await c.req.json(),{sessionHash:c.get('sessionHash')})},201)})
conversationActionRoutes.get(`${path}/partner-forwards`,async c=>{
 const {actor,conversation}=await dashboardAccess(c),ids=JSON.stringify(await operatorThreadIds(c.env,actor.projectId,conversation.id,actor.id))
 const rows=await c.env.DB.batch([
  c.env.DB.prepare('SELECT id,conversation_id,actor_id,recipient,subject,content,message_ids_json,created_at,revoked_at,state FROM partner_forwards WHERE project_id=? AND conversation_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id LIMIT 100').bind(actor.projectId,ids),
  c.env.DB.prepare('SELECT r.id,r.conversation_id,r.forward_id,r.content,r.created_at FROM partner_replies r WHERE r.project_id=? AND r.conversation_id IN (SELECT value FROM json_each(?)) ORDER BY r.created_at DESC,r.id LIMIT 200').bind(actor.projectId,ids),
  c.env.DB.prepare('SELECT id,conversation_id,reply_id,filename,content_type,size FROM partner_reply_files WHERE project_id=? AND conversation_id IN (SELECT value FROM json_each(?)) ORDER BY created_at DESC,id LIMIT 400').bind(actor.projectId,ids),
 ])
 return c.json({data:{forwards:rows[0].results,replies:rows[1].results,files:rows[2].results,visibility:'private'}})
})
conversationActionRoutes.delete(`${path}/partner-forwards/:forwardId`,async c=>{
 const {actor,conversation}=await dashboardAccess(c),guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply',conversation.id),now=Date.now(),forwardId=c.req.param('forwardId')
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE partner_forwards SET revoked_at=? WHERE id=? AND project_id=? AND conversation_id=? AND revoked_at IS NULL AND EXISTS(${guard.sql})`).bind(now,forwardId,actor.projectId,conversation.id,...guard.params),
  c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,project_id,?,'access','conversation.partner_revoked','succeeded','user',?,'dashboard','conversation',conversation_id,json_object('forward_id',id) FROM partner_forwards WHERE id=? AND project_id=? AND revoked_at=?`).bind(crypto.randomUUID(),now,actor.id,forwardId,actor.projectId,now),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Partner thread or authority changed'})
 return c.json({data:{id:forwardId,revoked:true}})
})
conversationActionRoutes.get(`${path}/partner-files/:fileId`,async c=>{
 const {actor,conversation}=await dashboardAccess(c),file=await c.env.DB.prepare('SELECT * FROM partner_reply_files WHERE project_id=? AND conversation_id=? AND id=?').bind(actor.projectId,conversation.id,c.req.param('fileId')).first<any>()
 if(!file)throw new HTTPException(404)
 const object=await c.env.FILES.get(file.object_key);if(!object)throw new HTTPException(404)
 return new Response(object.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}})
})
