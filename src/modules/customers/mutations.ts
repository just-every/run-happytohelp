import type {Actor,Env} from '../../platform/env'
import {auditStatement} from '../audit/record'
import {contactWritable} from '../../platform/contact-state'
import {type CompanySnapshot,type Guard,snapshotGuard,together,stale} from './model'

export function changed(s:CompanySnapshot,patch:Partial<CompanySnapshot['company']>={},domains=s.domains,members=s.members):CompanySnapshot{
 return {company:{...s.company,...patch,revision:s.company.revision+1,updated_at:Math.max(Date.now(),s.company.updated_at+1)},domains:[...domains].sort(),members:[...members].sort()}
}
export function liveMembers(projectId:string,snapshots:CompanySnapshot[]):Guard{
 const ids=[...new Set(snapshots.flatMap(s=>s.members))]
 return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND id=wanted.value AND ${contactWritable}))`,params:[JSON.stringify(ids),projectId]}
}
export interface Change {action:string;before:CompanySnapshot[];after:CompanySnapshot[];provenance?:Record<string,unknown>;guard:Guard;undoId?:string}
/** Claim the exact reviewed state, then perform all writes under that claim in one D1 transaction. */
export async function commitChange(env:Env,actor:Actor,change:Change){
 const {before,after}=change,db=env.DB,id=crypto.randomUUID(),at=Date.now(),companyId=after[0].company.id,source=after[1]?.company.id??null
 const guard=together(change.guard,...before.map(snapshotGuard),liveMembers(actor.projectId,after)),accepted='EXISTS(SELECT 1 FROM company_history WHERE id=?)'
 const statements=[db.prepare(`INSERT INTO company_history(id,project_id,company_id,source_company_id,action,actor_id,at,before_json,after_json,provenance_json) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${guard.sql}`).bind(id,actor.projectId,companyId,source,change.action,actor.id,at,JSON.stringify(before),JSON.stringify(after),JSON.stringify(change.provenance??{}),...guard.params)]
 // Delete associations for the complete affected set before restoring any of them.
 for(const s of after){
  const c=s.company
  statements.push(db.prepare(`UPDATE companies SET name=?,attributes_json=?,portal_company_view=?,revision=?,updated_at=?,merged_into=? WHERE project_id=? AND id=? AND ${accepted}`).bind(c.name,c.attributes_json,c.portal_company_view,c.revision,c.updated_at,c.merged_into,actor.projectId,c.id,id),
   db.prepare(`DELETE FROM company_domains WHERE project_id=? AND company_id=? AND ${accepted}`).bind(actor.projectId,c.id,id),
   db.prepare(`DELETE FROM contact_companies WHERE project_id=? AND company_id=? AND ${accepted}`).bind(actor.projectId,c.id,id))
 }
 for(const s of after){
  statements.push(db.prepare(`INSERT INTO company_domains(project_id,domain,company_id) SELECT ?,value,? FROM json_each(?) WHERE ${accepted}`).bind(actor.projectId,s.company.id,JSON.stringify(s.domains),id),
   db.prepare(`INSERT INTO contact_companies(project_id,contact_id,company_id) SELECT ?,value,? FROM json_each(?) WHERE ${accepted}`).bind(actor.projectId,s.company.id,JSON.stringify(s.members),id))
 }
 if(change.undoId)statements.push(db.prepare(`UPDATE company_history SET undone_by=? WHERE project_id=? AND id=? AND ${accepted}`).bind(id,actor.projectId,change.undoId,id))
 statements.push(auditStatement(db,{projectId:actor.projectId,category:'data',action:`company.${change.action}`,actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'company',id:companyId},detail:{historyId:id,...(source?{sourceId:source}:{})}},at,{sql:accepted,params:[id]}))
 const result=await db.batch(statements)
 if(!result[0].meta.changes)throw stale()
 return id
}
export function freeDomains(projectId:string,domains:string[],allowedIds:string[]):Guard{
 return {sql:'NOT EXISTS(SELECT 1 FROM company_domains WHERE project_id=? AND domain IN (SELECT value FROM json_each(?)) AND company_id NOT IN (SELECT value FROM json_each(?)))',params:[projectId,JSON.stringify(domains),JSON.stringify(allowedIds)]}
}
