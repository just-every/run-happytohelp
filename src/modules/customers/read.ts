import type {Env} from '../../platform/env'
import {contactWritable} from '../../platform/contact-state'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {companyData,fields,fieldData,snapshot,type CompanySnapshot} from './model'

export async function companyList(env:Env,projectId:string){
 const [rows,definitions]=await Promise.all([
  env.DB.prepare(`SELECT c.*,(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains WHERE project_id=c.project_id AND company_id=c.id ORDER BY domain)) domains_json,(SELECT count(*) FROM contact_companies cc JOIN contacts co ON co.project_id=cc.project_id AND co.id=cc.contact_id WHERE cc.project_id=c.project_id AND cc.company_id=c.id AND coalesce(json_extract(co.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(co.metadata_json,'$.is_erased'),0)!=1) member_count FROM companies c WHERE c.project_id=? AND c.merged_into IS NULL ORDER BY c.name,c.id`).bind(projectId).all<any>(),
  fields(env,projectId),
 ])
 return {companies:rows.results.map(row=>{const {domains_json,member_count,...company}=row;return {...companyData({company,domains:JSON.parse(domains_json),members:[]}),memberCount:member_count}}),fields:definitions.map(fieldData)}
}
export async function companyDetail(env:Env,projectId:string,id:string){
 const [current,definitions,members,tickets,history]=await Promise.all([
  snapshot(env,projectId,id),fields(env,projectId),
  env.DB.prepare(`SELECT id,name,email,external_id,created_at FROM contacts WHERE project_id=? AND id IN (SELECT contact_id FROM contact_companies WHERE project_id=? AND company_id=?) AND ${contactWritable} ORDER BY name,email,id`).bind(projectId,projectId,id).all(),
  env.DB.prepare(`SELECT c.id,c.contact_id,c.subject,c.status_id,c.status_category,c.priority,c.assigned_to,c.created_at,c.updated_at,co.name contact_name,co.email contact_email FROM conversations c JOIN contact_companies cc ON cc.project_id=c.project_id AND cc.contact_id=c.contact_id JOIN contacts co ON co.project_id=c.project_id AND co.id=c.contact_id WHERE c.project_id=? AND cc.company_id=? AND ${contactAvailableSql()} ORDER BY c.updated_at DESC,c.id`).bind(projectId,id).all(),
  env.DB.prepare('SELECT * FROM company_history WHERE project_id=? AND (company_id=? OR source_company_id=?) ORDER BY at DESC,id DESC LIMIT 200').bind(projectId,id,id).all<any>(),
 ])
 const companyIds=[...new Set<string>(history.results.flatMap(h=>(JSON.parse(h.after_json) as CompanySnapshot[]).map(s=>s.company.id)))],states=new Map<string,CompanySnapshot>()
 // One query reads all historical participants to show whether undo is currently available.
 if(companyIds.length){
  const rows=await env.DB.prepare(`SELECT c.*,(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains WHERE project_id=c.project_id AND company_id=c.id ORDER BY domain)) domains_json,(SELECT json_group_array(contact_id) FROM (SELECT contact_id FROM contact_companies WHERE project_id=c.project_id AND company_id=c.id ORDER BY contact_id)) members_json FROM companies c WHERE c.project_id=? AND c.id IN (SELECT value FROM json_each(?))`).bind(projectId,JSON.stringify(companyIds)).all<any>()
  for(const row of rows.results){const {domains_json,members_json,...company}=row;states.set(company.id,{company,domains:JSON.parse(domains_json),members:JSON.parse(members_json)})}
 }
 return {company:companyData(current),members:members.results,tickets:tickets.results,domains:current.domains,fields:definitions.map(fieldData),history:history.results.map(h=>({id:h.id,companyId:h.company_id,sourceId:h.source_company_id,action:h.action,actorId:h.actor_id,at:h.at,undoneBy:h.undone_by,provenance:JSON.parse(h.provenance_json),canUndo:!h.undone_by&&JSON.parse(h.before_json).length>0&&(JSON.parse(h.after_json) as CompanySnapshot[]).every(s=>JSON.stringify(states.get(s.company.id))===JSON.stringify(s))}))}
}
