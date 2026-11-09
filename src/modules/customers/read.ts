import type {Env} from '../../platform/env'
import {contactWritable} from '../../platform/contact-state'
import {HTTPException} from 'hono/http-exception'
import {clauses,inboxAccess} from '../management/inbox-entries'
import {companyData,fields,fieldData,type CompanyRow,type CompanySnapshot} from './model'

export async function companyList(env:Env,projectId:string){
 const [rows,definitions]=await Promise.all([
  env.DB.prepare(`SELECT c.*,(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains WHERE project_id=c.project_id AND company_id=c.id ORDER BY domain)) domains_json,(SELECT count(*) FROM contact_companies cc JOIN contacts co ON co.project_id=cc.project_id AND co.id=cc.contact_id WHERE cc.project_id=c.project_id AND cc.company_id=c.id AND coalesce(json_extract(co.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(co.metadata_json,'$.is_erased'),0)!=1) member_count FROM companies c WHERE c.project_id=? AND c.merged_into IS NULL ORDER BY c.name,c.id`).bind(projectId).all<any>(),
  fields(env,projectId),
 ])
 return {companies:rows.results.map(row=>{const {domains_json,member_count,...company}=row;return {...companyData({company,domains:JSON.parse(domains_json),members:[]}),memberCount:member_count}}),fields:definitions.map(fieldData)}
}
/** The workspace's companies by name, for a filter that shows only names: one row per company. */
export async function companyNames(env:Env,projectId:string){
 return {companies:(await env.DB.prepare('SELECT id,name FROM companies WHERE project_id=? AND merged_into IS NULL ORDER BY name,id').bind(projectId).all<{id:string;name:string}>()).results}
}
// Each company's domains and members through its own index (the workspace-wide primary keys would read every row).
const domainsOf=(company:string)=>`(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains INDEXED BY company_domains_company WHERE project_id=${company}.project_id AND company_id=${company}.id ORDER BY domain))`
const membersOf=(company:string)=>`(SELECT json_group_array(contact_id) FROM (SELECT contact_id FROM contact_companies INDEXED BY contact_companies_company WHERE project_id=${company}.project_id AND company_id=${company}.id ORDER BY contact_id))`
// SQLite's BINARY order of text is code point order; JavaScript's default sort compares UTF-16 code units.
const binary=(a:string,b:string)=>{const x=[...a],y=[...b];for(let i=0;i<x.length&&i<y.length;i++){const d=x[i].codePointAt(0)!-y[i].codePointAt(0)!;if(d)return d}return x.length-y.length}
type Membership={contact_id:string;id:string;name:string|null;email:string|null;external_id:string|null;created_at:number;listed:number}
/** One company's page, read in proportion to the company, never the workspace. The company is looked up first, so
 * a merged-away or unknown one reads nothing more. Each membership is read with its contact once: the members are
 * the writable ones (`contactWritable`), and a ticket is listed when its contact is (contactAvailableSql()'s
 * predicate on the same row), named from it. Tickets are each member's conversations through
 * conversations_contact_history, under the role's ticket scope evaluated once as sets (inboxAccess). */
export async function companyDetail(env:Env,projectId:string,id:string,userId:string){
 const company=await env.DB.prepare(`SELECT c.*,${domainsOf('c')} domains_json FROM companies c WHERE c.project_id=? AND c.id=? AND c.merged_into IS NULL`).bind(projectId,id).first<CompanyRow&{domains_json:string}>()
 if(!company)throw new HTTPException(404,{message:'Company not found'})
 const access=clauses(inboxAccess('c',userId,{deleted:false}))
 const [definitions,memberships,conversations,history]=await Promise.all([
  fields(env,projectId),
  env.DB.prepare(`SELECT cc.contact_id,member.id,member.name,member.email,member.external_id,member.created_at,member.id IS NOT NULL AND ${contactWritable} listed FROM contact_companies cc INDEXED BY contact_companies_company LEFT JOIN contacts member ON member.project_id=cc.project_id AND member.id=cc.contact_id WHERE cc.project_id=? AND cc.company_id=? ORDER BY member.name,member.email,member.id`).bind(projectId,id).all<Membership>(),
  env.DB.prepare(`SELECT c.id,c.contact_id,c.subject,c.status_id,c.status_category,c.priority,c.assigned_to,c.created_at,c.updated_at FROM contact_companies cc INDEXED BY contact_companies_company CROSS JOIN conversations c INDEXED BY conversations_contact_history WHERE cc.project_id=? AND cc.company_id=? AND c.project_id=cc.project_id AND c.contact_id=cc.contact_id AND ${access.sql} ORDER BY c.updated_at DESC,c.id`).bind(projectId,id,...access.params).all<{contact_id:string}>(),
  // The entries naming this company, through both of its indexes (the planner may otherwise walk the workspace's history).
  env.DB.prepare('SELECT history.*,users.name actor_name FROM company_history history LEFT JOIN users ON users.id=history.actor_id WHERE history.rowid IN (SELECT rowid FROM company_history INDEXED BY company_history_company WHERE project_id=? AND company_id=? UNION SELECT rowid FROM company_history INDEXED BY company_history_source WHERE project_id=? AND source_company_id=?) ORDER BY history.at DESC,history.id DESC LIMIT 200').bind(projectId,id,projectId,id).all<any>(),
 ])
 const {domains_json,...row}=company,current:CompanySnapshot={company:row,domains:JSON.parse(domains_json),members:memberships.results.map(m=>m.contact_id)}
 const members=memberships.results.filter(m=>m.listed).map(({contact_id,listed,...member})=>member),listed=new Map(members.map(m=>[m.id,m]))
 const tickets=conversations.results.filter(t=>listed.has(t.contact_id)).map(t=>{const contact=listed.get(t.contact_id)!;return {...t,contact_name:contact.name,contact_email:contact.email}})
 // Undo is available while every company an entry changed is still as the entry left it. This company's state is
 // what was read above (members in the snapshot's `ORDER BY contact_id`); one query reads the other participants.
 const states=new Map<string,CompanySnapshot>([[id,{...current,members:[...current.members].sort(binary)}]])
 const companyIds=[...new Set<string>(history.results.flatMap(h=>(JSON.parse(h.after_json) as CompanySnapshot[]).map(s=>s.company.id)))].filter(other=>other!==id)
 if(companyIds.length){
  const rows=await env.DB.prepare(`SELECT c.*,${domainsOf('c')} domains_json,${membersOf('c')} members_json FROM companies c WHERE c.project_id=? AND c.id IN (SELECT value FROM json_each(?))`).bind(projectId,JSON.stringify(companyIds)).all<any>()
  for(const row of rows.results){const {domains_json,members_json,...company}=row;states.set(company.id,{company,domains:JSON.parse(domains_json),members:JSON.parse(members_json)})}
 }
 return {company:companyData(current),members,tickets,domains:current.domains,fields:definitions.map(fieldData),history:history.results.map(h=>({id:h.id,companyId:h.company_id,sourceId:h.source_company_id,action:h.action,actorId:h.actor_id,actorName:h.actor_name,at:h.at,undoneBy:h.undone_by,provenance:JSON.parse(h.provenance_json),canUndo:!h.undone_by&&JSON.parse(h.before_json).length>0&&(JSON.parse(h.after_json) as CompanySnapshot[]).every(s=>JSON.stringify(states.get(s.company.id))===JSON.stringify(s))}))}
}
