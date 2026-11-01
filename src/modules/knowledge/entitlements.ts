import {provenContactSql} from './door'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {requestSource} from '../audit/record'
import {livePortalContact} from '../portal/identity'

export const entitlementRoutes=new Hono<AppEnv>()
const route='/:projectId/categories/:categoryId/entitlements'
const eligible=provenContactSql('ct')
// Company deletion removes its row; merging retains a row without grant authority.
const liveCompany='co.merged_into IS NULL'
const companyColumns=`co.id,co.name,(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains WHERE project_id=co.project_id AND company_id=co.id ORDER BY domain)) domains_json`
const companyData=(rows:any[])=>rows.map(({domains_json,...row})=>({...row,domains:JSON.parse(domains_json)}))
const grantSnapshot=(table:string,column:string)=>`SELECT json_group_array(${column}) FROM (SELECT ${column} FROM ${table} WHERE project_id=? AND category_id=? ORDER BY ${column})`
function selectedIds(value:unknown,label:string){
 if(!Array.isArray(value)||value.length>100||value.some(id=>typeof id!=='string'||!id||id.length>200))throw new HTTPException(400,{message:`Choose at most 100 ${label}`})
 return [...new Set(value as string[])].sort()
}
entitlementRoutes.use(route,async(c,next)=>{
 const actor=await requireProject(c,c.req.param('projectId'),true)
 if(!['owner','admin'].includes(actor.role))throw new HTTPException(403,{message:'Project administration required'})
 if(!await c.env.DB.prepare('SELECT 1 FROM knowledge_categories WHERE project_id=? AND id=?').bind(c.req.param('projectId'),c.req.param('categoryId')).first())throw new HTTPException(404)
 await next()
})
entitlementRoutes.get(route,async c=>{
 const projectId=c.req.param('projectId'),categoryId=c.req.param('categoryId'),q=(c.req.query('q')||'').trim().slice(0,200).toLowerCase(),pattern=`%${q}%`
 const [category,accounts,candidates,companies,companyCandidates,suggestedCompanies]=await c.env.DB.batch<any>([
  c.env.DB.prepare('SELECT requires_entitlement FROM knowledge_categories WHERE project_id=? AND id=?').bind(projectId,categoryId),
  c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email FROM knowledge_collection_entitlements g JOIN contacts ct ON ct.id=g.contact_id AND ct.project_id=g.project_id WHERE g.project_id=? AND g.category_id=? AND ${eligible} ORDER BY ct.name,ct.email,ct.id LIMIT 100`).bind(projectId,categoryId),
  c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email FROM contacts ct WHERE ct.project_id=? AND ${eligible} AND (lower(coalesce(ct.name,'')) LIKE ? OR lower(coalesce(ct.email,'')) LIKE ?) ORDER BY ct.name,ct.email,ct.id LIMIT 100`).bind(projectId,pattern,pattern),
  c.env.DB.prepare(`SELECT ${companyColumns} FROM knowledge_company_entitlements g JOIN companies co ON co.id=g.company_id AND co.project_id=g.project_id WHERE g.project_id=? AND g.category_id=? AND ${liveCompany} ORDER BY co.name,co.id LIMIT 100`).bind(projectId,categoryId),
  c.env.DB.prepare(`SELECT ${companyColumns} FROM companies co WHERE co.project_id=? AND ${liveCompany} AND (lower(co.name) LIKE ? OR EXISTS(SELECT 1 FROM company_domains d WHERE d.project_id=co.project_id AND d.company_id=co.id AND lower(d.domain) LIKE ?)) ORDER BY co.name,co.id LIMIT 100`).bind(projectId,pattern,pattern),
  c.env.DB.prepare(`SELECT ${companyColumns} FROM companies co WHERE co.project_id=? AND ${liveCompany} AND EXISTS(SELECT 1 FROM company_domains d JOIN knowledge_categories k ON k.project_id=d.project_id JOIN json_each(k.allowed_domains) hint ON lower(hint.value)=lower(d.domain) WHERE k.id=? AND d.project_id=co.project_id AND d.company_id=co.id) ORDER BY co.name,co.id LIMIT 100`).bind(projectId,categoryId),
 ])
 if(!category.results.length)throw new HTTPException(404)
 return c.json({required:!!category.results[0].requires_entitlement,accounts:accounts.results,candidates:candidates.results,companies:companyData(companies.results),companyCandidates:companyData(companyCandidates.results),suggestedCompanies:companyData(suggestedCompanies.results)})
})
/** One guarded audit receipt admits the complete replacement in the same batch.
 * Domain suggestions never enter this command unless explicitly selected. */
entitlementRoutes.put(route,async c=>{
 const projectId=c.req.param('projectId'),categoryId=c.req.param('categoryId'),actor=c.get('actor'),body=await c.req.json()
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HTTPException(400,{message:'Provide collection grants'})
 const contacts=selectedIds(body.contactIds,'customer accounts'),companies=selectedIds(body.companyIds??[],'companies'),required=body.required??true
 if(typeof required!=='boolean'||!required&&(contacts.length>0||companies.length>0))throw new HTTPException(400,{message:'Selected grants require selected collection access'})
 const contactJson=JSON.stringify(contacts),companyJson=JSON.stringify(companies)
 const contactSelection=`NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=? AND ct.id=selected.value AND ${eligible}))`
 const companySelection=`NOT EXISTS(SELECT 1 FROM json_each(?) selected WHERE NOT EXISTS(SELECT 1 FROM companies co WHERE co.project_id=? AND co.id=selected.value AND ${liveCompany}))`
 const selectionArgs=[contactJson,projectId,companyJson,projectId]
 const observed=await c.env.DB.batch<any>([
  c.env.DB.prepare(`SELECT k.audience,k.requires_entitlement,k.parent_id,k.is_published,k.allowed_domains,(${grantSnapshot('knowledge_collection_entitlements','contact_id')}) contacts,(${grantSnapshot('knowledge_company_entitlements','company_id')}) companies FROM knowledge_categories k WHERE k.project_id=? AND k.id=?`).bind(projectId,categoryId,projectId,categoryId,projectId,categoryId),
  c.env.DB.prepare(`SELECT 1 ok WHERE ${contactSelection} AND ${companySelection}`).bind(...selectionArgs),
 ])
 const current=observed[0].results[0]
 if(!current)throw new HTTPException(404)
 if(!observed[1].results.length)throw new HTTPException(400,{message:'Choose proven customer accounts and active companies in this workspace'})
 const now=Date.now(),receipt=crypto.randomUUID()
 const session=`EXISTS(SELECT 1 FROM sessions s JOIN memberships m ON m.user_id=s.actor_id AND m.project_id=? JOIN projects p ON p.id=m.project_id WHERE s.token_hash=? AND s.actor_id=? AND s.role=m.role AND m.role IN ('owner','admin') AND (s.project_id IS NULL OR s.project_id=m.project_id) AND s.revoked_at IS NULL AND s.expires_at>max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=p.id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL))`
 const category=`EXISTS(SELECT 1 FROM knowledge_categories WHERE project_id=? AND id=? AND audience=? AND requires_entitlement=? AND parent_id IS ? AND is_published=? AND allowed_domains=?)`
 const unchanged=`(${grantSnapshot('knowledge_collection_entitlements','contact_id')})=? AND (${grantSnapshot('knowledge_company_entitlements','company_id')})=?`
 const guard=`${session} AND ${category} AND ${contactSelection} AND ${companySelection} AND ${unchanged}`
 const args=[projectId,c.get('sessionHash'),actor.id,now,projectId,categoryId,current.audience,current.requires_entitlement,current.parent_id,current.is_published,current.allowed_domains,...selectionArgs,projectId,categoryId,current.contacts,projectId,categoryId,current.companies]
 const accepted='EXISTS(SELECT 1 FROM audit_events WHERE id=? AND project_id=?)'
 const result=await c.env.DB.batch([
  c.env.DB.prepare(`INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','knowledge.entitlements.updated','succeeded','user',?,?,'category',?,? WHERE ${guard}`).bind(receipt,projectId,now,actor.id,requestSource(c),categoryId,JSON.stringify({accountCount:contacts.length,companyCount:companies.length,contactIds:contacts,companyIds:companies,previousContactIds:JSON.parse(current.contacts),previousCompanyIds:JSON.parse(current.companies),previousRequired:!!current.requires_entitlement,required}),...args),
  c.env.DB.prepare(`UPDATE knowledge_categories SET audience=CASE WHEN ?=1 THEN 'signed-in' WHEN audience='domains' THEN 'signed-in' ELSE audience END,requires_entitlement=? WHERE project_id=? AND id=? AND ${accepted} AND (requires_entitlement<>${required?1:0} OR audience<>CASE WHEN ${required?1:0}=1 OR audience='domains' THEN 'signed-in' ELSE audience END)`).bind(required?1:0,required?1:0,projectId,categoryId,receipt,projectId),
  c.env.DB.prepare(`DELETE FROM knowledge_collection_entitlements WHERE project_id=? AND category_id=? AND contact_id NOT IN (SELECT value FROM json_each(?)) AND ${accepted}`).bind(projectId,categoryId,contactJson,receipt,projectId),
  c.env.DB.prepare(`DELETE FROM knowledge_company_entitlements WHERE project_id=? AND category_id=? AND company_id NOT IN (SELECT value FROM json_each(?)) AND ${accepted}`).bind(projectId,categoryId,companyJson,receipt,projectId),
  c.env.DB.prepare(`INSERT OR IGNORE INTO knowledge_collection_entitlements(project_id,category_id,contact_id,granted_by,created_at) SELECT ?,?,value,?,? FROM json_each(?) WHERE ${accepted}`).bind(projectId,categoryId,actor.id,now,contactJson,receipt,projectId),
  c.env.DB.prepare(`INSERT OR IGNORE INTO knowledge_company_entitlements(project_id,category_id,company_id,granted_by,created_at) SELECT ?,?,value,?,? FROM json_each(?) WHERE ${accepted}`).bind(projectId,categoryId,actor.id,now,companyJson,receipt,projectId),
 ])
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Collection, grants, account, company or authority changed. Reload before saving.'})
 return c.json({restricted:required,required,contactIds:contacts,companyIds:companies})
})
