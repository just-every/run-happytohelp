import type {SourceRecord} from '../../import-kit/src/types'
import type {Vendor} from '../types'
import type {NativeValue} from './normalise'
import {nativeId,sourceId,text,time,object} from './common'

export const companyKind=(vendor:Vendor)=>vendor==='zendesk'||vendor==='helpscout'?'organization':'company'
export function sourceCompany(record:SourceRecord,projectId:string,importedAt:number,omissions:string[]){
 const vendor=record.namespace as Vendor,p=record.payload as any
 if(record.kind!==companyKind(vendor))return null
 if(p.deleted_at!=null||p.deleted===true)throw Error('deleted_company_not_imported')
 const id=nativeId(projectId,vendor,'company',record.sourceId),unknown=vendor==='helpscout'
 const created=unknown?importedAt:time(p.created_at,vendor==='intercom'?'unix':'iso'),updated=unknown?importedAt:time(p.updated_at,vendor==='intercom'?'unix':'iso')
 omissions.push('company_domains_and_visibility_not_activated','company_attributes_retained_in_original_only')
 if(unknown)omissions.push('company_source_timestamps_unavailable_native_import_time_recorded')
 return {kind:'company',target:id,tables:{companies:[{id,project_id:projectId,name:text(p.name,'company_name_required',500),attributes_json:'{}',portal_company_view:0,revision:1,created_at:created,updated_at:updated,merged_into:null}]} as NativeValue['tables'],...(unknown?{nativeCreatedAt:importedAt}:{})}
}

export function contactCompany(record:SourceRecord,projectId:string,records:Map<string,SourceRecord>,contactId:string,omissions:string[]){
 const vendor=record.namespace as Vendor,p=record.payload as any
 let selected:unknown=vendor==='zendesk'?p.organization_id:vendor==='freshdesk'?p.company_id:vendor==='helpscout'?p.organizationId:null
 if(vendor==='intercom'&&p.companies!=null){
  if(!object(p.companies)||!Array.isArray(p.companies.data)||p.companies.has_more===true||p.companies.total_count!==p.companies.data.length){omissions.push('company_memberships_incomplete_not_activated');return []}
  if(p.companies.data.length>1){omissions.push('multiple_companies_require_native_primary_review');return []}
  selected=p.companies.data[0]?.id
 }
 if(vendor==='freshdesk'&&Array.isArray(p.other_companies)&&p.other_companies.length)omissions.push('multiple_companies_require_native_primary_review')
 if(selected==null)return []
 const sid=sourceId(selected,vendor),source=records.get(`${companyKind(vendor)}/${sid}`)?.payload as any
 if(!source||source.deleted_at!=null||source.deleted===true)throw Error('contact_company_unavailable')
 omissions.push('company_affiliation_does_not_grant_portal_visibility')
 return [{project_id:projectId,contact_id:contactId,company_id:nativeId(projectId,vendor,'company',sid)}]
}
