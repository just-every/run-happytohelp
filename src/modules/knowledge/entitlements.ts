import {nativeEmailProofSql} from './access'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {auditStatement,requestSource} from '../audit/record'
import {livePortalContact} from '../portal/identity'

export const entitlementRoutes=new Hono<AppEnv>()
const eligible=`${livePortalContact('ct')} AND (ct.is_verified=1 OR (${nativeEmailProofSql.replaceAll('c.','ct.')}) OR EXISTS(SELECT 1 FROM portal_identities pi WHERE pi.project_id=ct.project_id AND pi.contact_id=ct.id AND pi.email=lower(trim(ct.email))))`
entitlementRoutes.use('/:projectId/categories/:categoryId/entitlements',async(c,next)=>{
 const actor=await requireProject(c,c.req.param('projectId'),true)
 if(!['owner','admin'].includes(actor.role))throw new HTTPException(403,{message:'Project administration required'})
 if(!await c.env.DB.prepare('SELECT 1 FROM knowledge_categories WHERE project_id=? AND id=?').bind(c.req.param('projectId'),c.req.param('categoryId')).first())throw new HTTPException(404)
 await next()
})
entitlementRoutes.get('/:projectId/categories/:categoryId/entitlements',async c=>{
 const projectId=c.req.param('projectId'),categoryId=c.req.param('categoryId'),q=(c.req.query('q')||'').trim().slice(0,200)
 const [category,accounts,candidates]=await c.env.DB.batch<any>([
  c.env.DB.prepare('SELECT audience,requires_entitlement FROM knowledge_categories WHERE project_id=? AND id=?').bind(projectId,categoryId),
  c.env.DB.prepare('SELECT ct.id,ct.name,ct.email FROM knowledge_collection_entitlements g JOIN contacts ct ON ct.id=g.contact_id AND ct.project_id=g.project_id WHERE g.project_id=? AND g.category_id=? ORDER BY ct.name,ct.email,ct.id').bind(projectId,categoryId),
  c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email FROM contacts ct WHERE ct.project_id=? AND ?<>'' AND ${eligible} AND (lower(coalesce(ct.name,'')) LIKE ? OR lower(coalesce(ct.email,'')) LIKE ?) ORDER BY ct.name,ct.email,ct.id LIMIT 20`).bind(projectId,q,`%${q.toLowerCase()}%`,`%${q.toLowerCase()}%`)
 ])
 return c.json({required:(category.results[0]?.audience!=='public'||!!category.results[0]?.requires_entitlement),accounts:accounts.results,candidates:candidates.results})
})
// Grants name verified workspace accounts. A domain or company never creates a grant.
entitlementRoutes.put('/:projectId/categories/:categoryId/entitlements',async c=>{
 const projectId=c.req.param('projectId'),categoryId=c.req.param('categoryId'),actor=c.get('actor'),body=await c.req.json(),ids=body.contactIds,required=body.required??true
 if(typeof required!=='boolean'||!Array.isArray(ids)||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>200)||(!required&&ids.length))throw new HTTPException(400,{message:'Choose explicit customer accounts'})
 const contacts=[...new Set(ids)] as string[]
 for(const id of contacts)if(!await c.env.DB.prepare(`SELECT 1 FROM contacts ct WHERE ct.project_id=? AND ct.id=? AND ${eligible}`).bind(projectId,id).first())throw new HTTPException(400,{message:'Choose a verified customer account in this workspace'})
 const guard=`EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=? WHERE s.token_hash=? AND s.actor_id=? AND s.role=m.role AND m.role IN ('owner','admin') AND s.revoked_at IS NULL AND s.expires_at>?) AND NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=? AND ct.id=selected.value AND ${eligible}))`
 const args=[projectId,c.get('sessionHash'),actor.id,Date.now(),JSON.stringify(contacts),projectId],now=Date.now()
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`SELECT id FROM knowledge_categories WHERE project_id=? AND id=? AND ${guard}`).bind(projectId,categoryId,...args),
  c.env.DB.prepare(`UPDATE knowledge_categories SET requires_entitlement=? WHERE project_id=? AND id=? AND requires_entitlement<>? AND ${guard}`).bind(required?1:0,projectId,categoryId,required?1:0,...args),
  c.env.DB.prepare(`DELETE FROM knowledge_collection_entitlements WHERE project_id=? AND category_id=? AND contact_id NOT IN (SELECT value FROM json_each(?)) AND ${guard}`).bind(projectId,categoryId,JSON.stringify(contacts),...args),
  ...contacts.map(id=>c.env.DB.prepare(`INSERT OR IGNORE INTO knowledge_collection_entitlements SELECT ?,?,?,?,? WHERE ${guard}`).bind(projectId,categoryId,id,actor.id,now,...args)),
  auditStatement(c.env.DB,{projectId,category:'data',action:'knowledge.entitlements.updated',actor:{type:'user',id:actor.id},source:requestSource(c),target:{type:'category',id:categoryId},detail:{accountCount:contacts.length,required}})
 ])
 if(!result[0].results.length)throw new HTTPException(409,{message:'Account or authority changed'})
 return c.json({restricted:required,contactIds:contacts})
})
