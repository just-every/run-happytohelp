import type {MappingInput,PreparedMapping} from '../types'
import {recordKey} from '../types'
import {completeNativeValue} from '../targets'
import {domains,name} from '../../customers/validation'
import {nativeId,sourceId,time,object} from './common'

const sourceKind=(vendor:string)=>['zendesk','helpscout'].includes(vendor)?'organization':'company'
/** Imported relationships assert source history, never verified identity or
 * company-wide portal access. The native one-company limit is explicit. */
export function mapCompanies({projectId,vendor,source}:MappingInput,result:PreparedMapping){
 const kind=sourceKind(vendor),companies=source.records.filter(record=>record.kind===kind),byId=new Map(companies.map(record=>[record.sourceId,record])),domainOwners=new Map<string,string[]>()
 for(const record of companies){
  const key=recordKey(record),p=record.payload as any
  if(result.rejections.has(key))continue
  result.omissions.set(key,(result.omissions.get(key)??[]).filter(reason=>!reason.startsWith('unsupported_record_kind:')&&!reason.startsWith('source_metadata_only:')))
  try{
   const target=nativeId(projectId,vendor,'company',record.sourceId),knownTimes=vendor!=='helpscout',at=knownTimes?time(p.created_at,vendor==='intercom'?'unix':'iso'):Date.now(),updated=knownTimes?time(p.updated_at,vendor==='intercom'?'unix':'iso'):at
   const claimed=domains(vendor==='zendesk'?p.domain_names??[]:vendor==='intercom'?[]:p.domains??[])
   const omissions=result.omissions.get(key)??[]
   const used=new Set(['id','type','kind','_offline_provenance','name','created_at','updated_at',vendor==='zendesk'?'domain_names':vendor==='intercom'?'':'domains'])
   for(const field of Object.keys(p))if(!used.has(field))omissions.push('company_metadata_retained_in_original_only:'+field)
   omissions.push('company_portal_access_not_activated')
   if(!knownTimes)omissions.push('company_source_times_unavailable_import_time_used')
   if(p.organization_fields||p.custom_fields||p.custom_attributes||p.properties)omissions.push('company_custom_attributes_retained_in_original_only')
   if(vendor==='intercom'&&p.website)omissions.push('company_website_not_inferred_as_membership_domain')
   const value={tables:{companies:[{id:target,project_id:projectId,name:name(p.name),attributes_json:'{}',portal_company_view:0,revision:1,created_at:at,updated_at:updated,merged_into:null}],company_domains:claimed.map(domain=>({project_id:projectId,company_id:target,domain}))},source:{vendor,kind,id:record.sourceId,...(vendor==='zendesk'&&Array.isArray(p._offline_provenance)?{packedProvenance:p._offline_provenance}:{}),created_at:knownTimes?p.created_at:null,updated_at:knownTimes?p.updated_at:null}}
   result.effects.set(key,[{targetKind:'company',targetId:target,value:completeNativeValue('company',value) as any}]);result.omissions.set(key,omissions)
   for(const domain of claimed)domainOwners.set(domain,[...(domainOwners.get(domain)??[]),key])
  }catch(error){result.rejections.set(key,error instanceof Error?error.message:'company_mapping_failed');result.effects.set(key,[])}
 }
 for(const owners of domainOwners.values())if(owners.length>1)for(const key of owners)result.rejections.set(key,'company_domain_conflict')
 for(const record of source.records){
  const key=recordKey(record),effect=result.effects.get(key)?.find(effect=>effect.targetKind==='contact');if(!effect)continue
  const p=record.payload as any,omissions=result.omissions.get(key)??[];let member:unknown
  if(vendor==='zendesk'){member=p.organization_id;if(member!=null)omissions.push('only_default_organization_mapped_other_memberships_require_review')}
  else if(vendor==='freshdesk'){member=p.company_id;if(p.other_companies?.length)omissions.push('additional_company_memberships_not_imported')}
  else if(vendor==='helpscout'){member=p.organizationId;if(member==null&&p.organization)omissions.push('company_name_without_source_id_not_linked')}
  else if(p.companies!==undefined){
   const list=p.companies,data=list?.data
   if(!object(list)||!Array.isArray(data)||list.has_more!==false||!Number.isSafeInteger(list.total_count)||list.total_count!==data.length||data.some((row:any)=>!object(row)||row.type!=='company')||new Set(data.map((row:any)=>row.id)).size!==data.length)omissions.push('company_membership_list_incomplete_not_linked')
   else if(data.length>1)omissions.push('multiple_company_memberships_require_native_review')
   else member=data[0]?.id
  }
  if(member!=null){
   let id:string|undefined;try{id=sourceId(member,vendor)}catch{omissions.push('company_reference_invalid')}
   const company=id?byId.get(id):undefined
   if(company&&!result.rejections.has(recordKey(company))&&result.effects.get(recordKey(company))?.some(effect=>effect.targetKind==='company')){
    (effect.value as any).tables.contact_companies=[{project_id:projectId,contact_id:effect.targetId,company_id:nativeId(projectId,vendor,'company',id!)}]
   }else omissions.push('company_reference_unavailable')
  }
  if(omissions.length)result.omissions.set(key,omissions)
 }
}
