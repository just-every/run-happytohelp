import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../../platform/env'
import type {Company,Contact,Definition,ImportRun,PlannedRow,Snapshot} from './types'

export const csvCustomerTables=['csv_customer_epochs','csv_customer_imports','csv_customer_import_rows','csv_customer_assertions'] as const
export const epochSql='coalesce((SELECT revision FROM csv_customer_epochs WHERE project_id=?),0)'
export const stale=()=>new HTTPException(409,{message:'Customer data, import status or authority changed. Review a fresh preview before continuing.'})

export async function readSnapshot(env:Env,projectId:string):Promise<Snapshot>{
 const [contacts,companies,definitions,epoch]=await env.DB.batch<any>([
  env.DB.prepare(`SELECT c.id,c.name,c.email,c.external_id,c.metadata_json,c.is_verified,c.created_at,cc.company_id FROM contacts c LEFT JOIN contact_companies cc ON cc.project_id=c.project_id AND cc.contact_id=c.id WHERE c.project_id=? ORDER BY c.id`).bind(projectId),
  env.DB.prepare(`SELECT c.id,c.name,c.attributes_json,c.portal_company_view,c.revision,c.created_at,c.updated_at,c.merged_into,(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains d WHERE d.project_id=c.project_id AND d.company_id=c.id ORDER BY domain)) domains_json FROM companies c WHERE c.project_id=? ORDER BY c.id`).bind(projectId),
  env.DB.prepare('SELECT id,name,type,options_json FROM company_attribute_definitions WHERE project_id=? ORDER BY id').bind(projectId),
  env.DB.prepare(`SELECT ${epochSql} epoch`).bind(projectId),
 ])
 return {contacts:contacts.results as unknown as Contact[],companies:companies.results.map(row=>{const {domains_json,...company}=row;return {...company,domains:JSON.parse(domains_json as string)} as unknown as Company}),definitions:definitions.results as unknown as Definition[],epoch:Number(epoch.results[0].epoch)}
}

export function previewStatements(env:Env,run:ImportRun,rows:PlannedRow[]){
 return [env.DB.prepare('INSERT INTO csv_customer_imports(id,project_id,kind,status,epoch,actor_id,created_at) VALUES(?,?,?,?,?,?,?)').bind(run.id,run.project_id,run.kind,run.status,run.epoch,run.actor_id,run.created_at),
  env.DB.prepare(`INSERT INTO csv_customer_import_rows(run_id,project_id,row_number,action,reason,entity_id,data_json,domain_match_json,before_json,after_json)
   SELECT ?,?,json_extract(value,'$.row'),json_extract(value,'$.action'),json_extract(value,'$.reason'),json_extract(value,'$.entityId'),json_extract(value,'$.data'),coalesce(json_extract(value,'$.domainMatch'),'null'),coalesce(json_extract(value,'$.before'),'null'),coalesce(json_extract(value,'$.after'),'null') FROM json_each(?)`).bind(run.id,run.project_id,JSON.stringify(rows))]
}

export async function readRun(env:Env,projectId:string,id:string){
 const run=await env.DB.prepare('SELECT * FROM csv_customer_imports WHERE project_id=? AND id=?').bind(projectId,id).first<ImportRun>()
 if(!run)throw new HTTPException(404,{message:'Import run not found'})
 const stored=await env.DB.prepare('SELECT * FROM csv_customer_import_rows WHERE project_id=? AND run_id=? ORDER BY row_number').bind(projectId,id).all<Record<string,unknown>>()
 const rows:PlannedRow[]=stored.results.map(row=>({row:Number(row.row_number),action:row.action as PlannedRow['action'],reason:String(row.reason),entityId:row.entity_id as string|null,data:JSON.parse(row.data_json as string),domainMatch:JSON.parse(row.domain_match_json as string),before:JSON.parse(row.before_json as string),after:JSON.parse(row.after_json as string)}))
 return {run,rows}
}
export function result(run:ImportRun,rows:PlannedRow[]){
 const counts={create:0,update:0,skip:0};for(const row of rows)counts[row.action]++
 return {id:run.id,kind:run.kind,status:run.status,rows:rows.map(({before:_before,after:_after,...row})=>row),counts}
}

