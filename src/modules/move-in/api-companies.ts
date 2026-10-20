import type {Env} from '../../platform/env'
import type {SourceBundle,SourceRecord,TargetEffect} from '../import-kit/src/types'
import type {PreparedMapping,Run} from './types'
import {recordKey} from './types'
import {nativeId,text,time} from './readers/common'
import {completeNativeValue} from './targets'
import {domains} from '../customers/validation'

/** Company rows and domains belong to the company; a contact owns its membership.
 * Portal sharing remains off. Untyped source attributes stay in private custody. */
export async function prepareApiCompanies(env:Env,run:Run,source:SourceBundle,prepared:PreparedMapping){
 const companyRecords=source.records.filter(r=>r.kind==='company'),domainOwners=new Map<string,string[]>(),effects=new Map<string,TargetEffect>();
 for(const record of companyRecords){const key=recordKey(record);if(prepared.rejections.has(key))continue
  try{const p=record.payload as any,id=nativeId(run.project_id,run.vendor,'company',record.sourceId),format=run.vendor==='intercom'?'unix':'iso',created=p.created_at??p.createdAt??p.updated_at??p.updatedAt,updated=p.updated_at??p.updatedAt??created,companyDomains=domains(p.domain_names??p.domains??[]);
   const value={source:{vendor:run.vendor,kind:record.kind,id:record.sourceId,api_import:true,created_at:created??null,updated_at:updated??null},tables:{companies:[{id,project_id:run.project_id,name:text(p.name,'company_name_required',500),attributes_json:'{}',portal_company_view:0,revision:1,created_at:created==null?run.created_at:time(created,format),updated_at:updated==null?run.created_at:time(updated,format),merged_into:null}],company_domains:companyDomains.map(domain=>({project_id:run.project_id,company_id:id,domain}))}};
   effects.set(key,{targetKind:'company',targetId:id,value:completeNativeValue('company',value) as any});
   for(const domain of companyDomains){const owners=domainOwners.get(domain)??[];owners.push(key);domainOwners.set(domain,owners)}
   if(created==null)prepared.omissions.set(key,[...(prepared.omissions.get(key)??[]),'Company dates record when fetched; the source supplies no original company timestamp.']);
  }catch{prepared.rejections.set(key,'company_name_dates_or_domains_invalid')}
 }
 const claimed=[...domainOwners.keys()],existing=claimed.length?(await env.DB.prepare('SELECT domain,company_id FROM company_domains WHERE project_id=? AND domain IN (SELECT value FROM json_each(?))').bind(run.project_id,JSON.stringify(claimed)).all<{domain:string;company_id:string}>()).results:[];
 for(const [domain,owners] of domainOwners)for(const key of owners)if(owners.length>1||existing.some(row=>row.domain===domain&&row.company_id!==effects.get(key)?.targetId))prepared.rejections.set(key,'company_domain_conflict');
 for(const [key,effect] of effects){prepared.effects.set(key,[effect]);prepared.omissions.set(key,(prepared.omissions.get(key)??[]).filter(reason=>!reason.startsWith('record_kind_not_understood')&&!reason.includes('metadata_retained')))}
 const refs=(record:SourceRecord):string[]=>{const p=record.payload as any,v=run.vendor==='zendesk'?p.organization_id:run.vendor==='freshdesk'?p.company_id:run.vendor==='helpscout'?p.organizationId:null;return run.vendor==='intercom'?(Array.isArray(p.companies?.data)?p.companies.data.filter((c:any)=>c?.id!=null).map((c:any)=>String(c.id)):[]):v==null?[]:[String(v)]};
 for(const record of source.records)for(const effect of prepared.effects.get(recordKey(record))??[]){if(effect.targetKind!=='contact')continue
  const key=recordKey(record),p=record.payload as any,ids=[...new Set(refs(record))],omit=(reason:string)=>prepared.omissions.set(key,[...(prepared.omissions.get(key)??[]),reason]);
  if(ids.length>1||p.companies?.has_more===true){omit('Company membership was not imported: the source lists multiple companies or an incomplete membership list.');continue}
  if(!ids.length)continue;const companyId=nativeId(run.project_id,run.vendor,'company',ids[0]),sourceCompany=companyRecords.find(c=>c.sourceId===ids[0]),available=sourceCompany?!prepared.rejections.has(recordKey(sourceCompany))&&effects.has(recordKey(sourceCompany)):await env.DB.prepare("SELECT 1 FROM companies c JOIN move_in_origins o ON o.project_id=c.project_id AND o.target_kind='company' AND o.target_id=c.id WHERE c.project_id=? AND c.id=? AND c.merged_into IS NULL AND o.vendor=?").bind(run.project_id,companyId,run.vendor).first();
  if(!available){omit('Company membership was not imported: its source company is unavailable or needs fixing.');continue}
  (effect.value as any).tables.contact_companies=[{project_id:run.project_id,contact_id:effect.targetId,company_id:companyId}];
 }
}
