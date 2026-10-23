import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import type {CompanyField} from './validation'

export interface CompanyRow {id:string;project_id:string;name:string;attributes_json:string;portal_company_view:number;revision:number;created_at:number;updated_at:number;merged_into:string|null}
export interface CompanySnapshot {company:CompanyRow;domains:string[];members:string[]}
export interface Guard {sql:string;params:unknown[]}
export const companyTables=['companies','company_domains','contact_companies','company_attribute_definitions','company_history','customer_identity_links'] as const
export const domainSnapshot=`SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains WHERE project_id=? AND company_id=? ORDER BY domain)`
export const memberSnapshot=`SELECT json_group_array(contact_id) FROM (SELECT contact_id FROM contact_companies WHERE project_id=? AND company_id=? ORDER BY contact_id)`
export async function snapshot(env:Env,projectId:string,id:string,active=true):Promise<CompanySnapshot>{
 const row=await env.DB.prepare(`SELECT c.*,(${domainSnapshot}) domains_json,(${memberSnapshot}) members_json FROM companies c WHERE c.project_id=? AND c.id=? ${active?'AND c.merged_into IS NULL':''}`).bind(projectId,id,projectId,id,projectId,id).first<CompanyRow&{domains_json:string;members_json:string}>()
 if(!row)throw new HTTPException(404,{message:'Company not found'})
 const {domains_json,members_json,...company}=row
 return {company,domains:JSON.parse(domains_json),members:JSON.parse(members_json)}
}
export function companyData(s:CompanySnapshot){const {attributes_json,portal_company_view,...row}=s.company;return {...row,attributes:JSON.parse(attributes_json),portalCompanyView:!!portal_company_view,domains:s.domains,memberCount:s.members.length}}
export function snapshotGuard(s:CompanySnapshot):Guard{
 const c=s.company,p=c.project_id,id=c.id
 return {sql:`EXISTS(SELECT 1 FROM companies WHERE project_id=? AND id=? AND revision=? AND name=? AND attributes_json=? AND portal_company_view=? AND merged_into IS ?) AND (${domainSnapshot})=? AND (${memberSnapshot})=?`,params:[p,id,c.revision,c.name,c.attributes_json,c.portal_company_view,c.merged_into,p,id,JSON.stringify(s.domains),p,id,JSON.stringify(s.members)]}
}
export async function fields(env:Env,projectId:string){return (await env.DB.prepare('SELECT id,name,type,options_json FROM company_attribute_definitions WHERE project_id=? ORDER BY id').bind(projectId).all<CompanyField>()).results}
export const fieldData=(f:CompanyField)=>({id:f.id,name:f.name,type:f.type,options:JSON.parse(f.options_json)})
export function fieldsGuard(projectId:string,definitions:CompanyField[]):Guard{
 return {sql:`(SELECT json_group_array(json_object('id',id,'name',name,'type',type,'options_json',options_json)) FROM (SELECT id,name,type,options_json FROM company_attribute_definitions WHERE project_id=? ORDER BY id))=?`,params:[projectId,JSON.stringify(definitions)]}
}
export function together(...guards:Guard[]):Guard{return {sql:guards.map(g=>`(${g.sql})`).join(' AND '),params:guards.flatMap(g=>g.params)}}
export async function fingerprint(value:unknown){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));return [...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('')}
export const stale=()=>new HTTPException(409,{message:'Company, membership or authority changed. Reload and review before applying changes.'})
