import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv} from '../../platform/env'
import {scope} from '../management/common'
import {ticketAuthority} from '../tickets/model'
import {auditStatement} from '../audit/record'
import {requireStepUp} from '../identity/two-factor/step-up'
import {STEP_UP_MS} from '../identity/two-factor/state'
import {companyDetail,companyList} from './read'
import {companyData,fields,fieldsGuard,snapshot,together,type CompanySnapshot,type Guard,stale} from './model'
import {attributes,domains,invalid,name,object} from './validation'
import {changed,commitChange,freeDomains} from './mutations'
import {mergeCompanies,mergePreview,undoCompanyHistory} from './merge'
import {contactWritable} from '../../platform/contact-state'

export const companyRoutes=new Hono<AppEnv>()
const prefix='/projects/:projectId/companies'
async function authority(c:any,actor:Actor){const guard=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'contacts.manage');return {sql:`EXISTS(${guard.sql})`,params:guard.params} as Guard}
function recentFactor(c:any,actor:Actor):Guard{
 if(actor.security?.installation)return {sql:'1',params:[]}
 return {sql:`EXISTS(SELECT 1 FROM session_factors factor WHERE factor.token_hash=? AND factor.user_id=? AND factor.verified_at>=max(?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)-?) AND (NOT EXISTS(SELECT 1 FROM user_factors enrolled WHERE enrolled.user_id=factor.user_id AND enrolled.confirmed_at IS NOT NULL) OR factor.method IN ('totp','webauthn','recovery','installation')))`,params:[c.get('sessionHash'),actor.id,Date.now()-STEP_UP_MS,STEP_UP_MS]}
}
async function input(c:any){return object(await c.req.json().catch(()=>invalid('Expected a JSON object')))}
companyRoutes.get(prefix,async c=>{const actor=await scope(c) as Actor;return c.json(await companyList(c.env,actor.projectId))})
companyRoutes.get(`${prefix}/:companyId`,async c=>{const actor=await scope(c) as Actor;return c.json(await companyDetail(c.env,actor.projectId,c.req.param('companyId'),actor.id))})
companyRoutes.post(prefix,async c=>{
 const actor=await scope(c) as Actor,guard=await authority(c,actor),body=await input(c),definitions=await fields(c.env,actor.projectId),id=crypto.randomUUID(),at=Date.now(),assigned=domains(body.domains??[])
 if(body.portalCompanyView!==undefined&&typeof body.portalCompanyView!=='boolean')invalid('Company portal visibility must be boolean')
 const s:CompanySnapshot={company:{id,project_id:actor.projectId,name:name(body.name),attributes_json:JSON.stringify(attributes(body.attributes??{},definitions)),portal_company_view:body.portalCompanyView?1:0,revision:1,created_at:at,updated_at:at,merged_into:null},domains:assigned,members:[]}
 const claim=together(guard,fieldsGuard(actor.projectId,definitions),freeDomains(actor.projectId,assigned,[])),accepted='EXISTS(SELECT 1 FROM companies WHERE project_id=? AND id=?)',historyId=crypto.randomUUID(),db=c.env.DB
 const result=await db.batch([
  db.prepare(`INSERT INTO companies(id,project_id,name,attributes_json,portal_company_view,revision,created_at,updated_at) SELECT ?,?,?,?,?,1,?,? WHERE ${claim.sql}`).bind(id,actor.projectId,s.company.name,s.company.attributes_json,s.company.portal_company_view,at,at,...claim.params),
  db.prepare(`INSERT INTO company_domains(project_id,domain,company_id) SELECT ?,value,? FROM json_each(?) WHERE ${accepted}`).bind(actor.projectId,id,JSON.stringify(assigned),actor.projectId,id),
  db.prepare(`INSERT INTO company_history(id,project_id,company_id,action,actor_id,at,before_json,after_json,provenance_json) SELECT ?,?,?,'created',?,?,'[]',?,'{}' WHERE ${accepted}`).bind(historyId,actor.projectId,id,actor.id,at,JSON.stringify([s]),actor.projectId,id),
  auditStatement(db,{projectId:actor.projectId,category:'data',action:'company.created',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'company',id}},at,{sql:accepted,params:[actor.projectId,id]}),
 ])
 if(!result[0].meta.changes)throw stale()
 return c.json({company:companyData(s)},201)
})
companyRoutes.patch(`${prefix}/:companyId`,async c=>{
 const actor=await scope(c) as Actor,guard=await authority(c,actor),id=c.req.param('companyId'),body=await input(c),[current,definitions]=await Promise.all([snapshot(c.env,actor.projectId,id),fields(c.env,actor.projectId)])
 if(body.revision!==undefined&&body.revision!==current.company.revision)throw stale()
 if(body.portalCompanyView!==undefined&&typeof body.portalCompanyView!=='boolean')invalid('Company portal visibility must be boolean')
 const next=changed(current,{name:body.name===undefined?current.company.name:name(body.name),attributes_json:body.attributes===undefined?current.company.attributes_json:JSON.stringify(attributes(body.attributes,definitions)),portal_company_view:body.portalCompanyView===undefined?current.company.portal_company_view:body.portalCompanyView?1:0},body.domains===undefined?current.domains:domains(body.domains))
 await commitChange(c.env,actor,{action:'updated',before:[current],after:[next],guard:together(guard,fieldsGuard(actor.projectId,definitions),freeDomains(actor.projectId,next.domains,[id]))})
 return c.json({company:companyData(next)})
})
for(const method of ['put','delete'] as const)companyRoutes[method](`${prefix}/:companyId/members/:contactId`,async c=>{
 const actor=await scope(c) as Actor,guard=await authority(c,actor),id=c.req.param('companyId'),contactId=c.req.param('contactId'),current=await snapshot(c.env,actor.projectId,id)
 const contact=await c.env.DB.prepare(`SELECT id FROM contacts WHERE project_id=? AND id=? AND ${contactWritable}`).bind(actor.projectId,contactId).first()
 if(!contact)throw new HTTPException(404,{message:'Contact not found or unavailable'})
 const membership=await c.env.DB.prepare('SELECT company_id FROM contact_companies WHERE project_id=? AND contact_id=?').bind(actor.projectId,contactId).first<{company_id:string}>()
 if(method==='delete'&&membership?.company_id!==id||method==='put'&&membership?.company_id===id)return c.json({company:companyData(current)})
 const before=[current],after=[changed(current,{},current.domains,method==='delete'?current.members.filter(m=>m!==contactId):[...current.members,contactId])]
 if(method==='put'&&membership){const previous=await snapshot(c.env,actor.projectId,membership.company_id);before.push(previous);after.push(changed(previous,{},previous.domains,previous.members.filter(m=>m!==contactId)))}
 await commitChange(c.env,actor,{action:method==='put'?'member_linked':'member_unlinked',before,after,provenance:{contactId,from:membership?.company_id??null,to:method==='put'?id:null},guard:together(guard,{sql:`(SELECT company_id FROM contact_companies WHERE project_id=? AND contact_id=?) IS ? AND EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=? AND ${contactWritable})`,params:[actor.projectId,contactId,membership?.company_id??null,actor.projectId,contactId]})})
 return c.json({company:companyData(after[0])})
})
companyRoutes.post(`${prefix}/:companyId/merge/preview`,async c=>{
 const actor=await scope(c) as Actor;await authority(c,actor)
 const body=await input(c),result=await mergePreview(c.env,actor.projectId,c.req.param('companyId'),body.sourceId)
 return c.json({preview:result.preview})
})
companyRoutes.post(`${prefix}/:companyId/merge`,async c=>{
 const actor=await scope(c) as Actor,guard=await authority(c,actor)
 await requireStepUp(c,actor,'company.merge')
 const historyId=await mergeCompanies(c.env,actor,c.req.param('companyId'),await input(c),together(guard,recentFactor(c,actor)))
 return c.json({...await companyDetail(c.env,actor.projectId,c.req.param('companyId'),actor.id),historyId})
})
companyRoutes.post(`${prefix}/:companyId/history/:historyId/undo`,async c=>{
 const actor=await scope(c) as Actor,guard=await authority(c,actor)
 await requireStepUp(c,actor,'company.undo')
 const historyId=await undoCompanyHistory(c.env,actor,c.req.param('companyId'),c.req.param('historyId'),together(guard,recentFactor(c,actor)))
 return c.json({...await companyDetail(c.env,actor.projectId,c.req.param('companyId'),actor.id),historyId})
})
