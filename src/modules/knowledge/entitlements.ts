import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {auditStatement,requestSource} from '../audit/record'

export const entitlementRoutes=new Hono<AppEnv>()
// Grants name a workspace customer account. Neither a domain nor imported
// company membership is authority to create a grant.
entitlementRoutes.put('/:projectId/categories/:categoryId/entitlements',async c=>{
 const projectId=c.req.param('projectId'),categoryId=c.req.param('categoryId'),actor=await requireProject(c,projectId,true)
 if(!['owner','admin'].includes(actor.role))throw new HTTPException(403,{message:'Project administration required'})
 const body=await c.req.json(),ids=body.contactIds
 if(!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>200))throw new HTTPException(400,{message:'Choose explicit customer accounts'})
 const contacts=[...new Set(ids)] as string[]
 if(!await c.env.DB.prepare('SELECT 1 FROM knowledge_categories WHERE project_id=? AND id=?').bind(projectId,categoryId).first())throw new HTTPException(404)
 for(const id of contacts)if(!await c.env.DB.prepare('SELECT 1 FROM contacts WHERE project_id=? AND id=?').bind(projectId,id).first())throw new HTTPException(400,{message:'Customer account is not in this workspace'})
 const guard=`EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=? WHERE s.token_hash=? AND s.actor_id=? AND s.role=m.role AND m.role IN ('owner','admin') AND s.revoked_at IS NULL AND s.expires_at>?)`
 const args=[projectId,c.get('sessionHash'),actor.id,Date.now()],now=Date.now()
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE knowledge_categories SET requires_entitlement=1 WHERE project_id=? AND id=? AND ${guard} RETURNING id`).bind(projectId,categoryId,...args),
  c.env.DB.prepare(`DELETE FROM knowledge_collection_entitlements WHERE project_id=? AND category_id=? AND ${guard}`).bind(projectId,categoryId,...args),
  ...contacts.map(id=>c.env.DB.prepare(`INSERT INTO knowledge_collection_entitlements SELECT ?,?,?,?,? WHERE ${guard} AND EXISTS(SELECT 1 FROM contacts WHERE id=? AND project_id=?)`).bind(projectId,categoryId,id,actor.id,now,...args,id,projectId)),
  auditStatement(c.env.DB,{projectId,category:'data',action:'knowledge.entitlements.updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'category',id:categoryId},detail:{accountCount:contacts.length}})
 ])
 if(!result[0].results.length)throw new HTTPException(409,{message:'Authority changed'})
 return c.json({restricted:true,contactIds:contacts})
})
