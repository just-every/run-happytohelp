import type {Connection} from '../model'
import {request,ProviderFailure} from './http'
const scalar=(x:unknown)=>['string','number','boolean'].includes(typeof x)?String(x).slice(0,2000):null
const unique=(values:(string|undefined)[])=>[...new Set(values.filter(Boolean))].join(',')
export async function crmContext(row:Connection,token:string,source:string){
 const fields=JSON.parse(row.fields_json),hub=row.provider==='hubspot',accountFields=[fields.account_plan,fields.account_entitlement,...(fields.editable_account??[])],contactFields=[fields.plan,fields.entitlement,...(fields.editable_contact??[])];let person:any,relationships:any[],truncated=false
 if(hub){
  const contact=await request(row,token,`/crm/v3/objects/contacts/${source}?properties=${unique(['firstname','lastname','hubspot_owner_id','lifecyclestage',...contactFields])}`)
  if(String(contact.id)!==source||contact.archived)throw new ProviderFailure('identity_mismatch')
  const links=await request(row,token,`/crm/v4/objects/contacts/${source}/associations/companies?limit=100`)
  truncated=!!links.paging?.next||links.results.length>20
  relationships=links.results.slice(0,20).map((x:any)=>({id:String(x.toObjectId),labels:x.associationTypes.map((t:any)=>({id:t.typeId,label:scalar(t.label)}))}))
  const p=contact.properties;person={source_id:source,customer:[scalar(p.firstname),scalar(p.lastname)].filter(Boolean).join(' '),owner:scalar(p.hubspot_owner_id),plan:scalar(p[fields.plan]),entitlement:scalar(p[fields.entitlement]),lifecycle:scalar(p.lifecyclestage),source_revision:scalar(contact.updatedAt),fields:Object.fromEntries((fields.editable_contact??[]).map((key:string)=>[key,p[key]??null]))}
 }else{
  const contact=await request(row,token,`/services/data/v66.0/sobjects/Contact/${source}?fields=${unique(['Id','Name','AccountId','OwnerId','LastModifiedDate',...contactFields])}`)
  if(contact.Id!==source)throw new ProviderFailure('identity_mismatch')
  const query=`SELECT AccountId,IsDirect,Roles FROM AccountContactRelation WHERE ContactId='${source}' AND IsActive=true LIMIT 101`,links=await request(row,token,'/services/data/v66.0/query?q='+encodeURIComponent(query))
  truncated=links.done!==true||links.records.length>20
  relationships=links.records.slice(0,20).map((x:any)=>({id:x.AccountId,direct:x.IsDirect,roles:scalar(x.Roles)}))
  if(contact.AccountId&&!relationships.some(x=>x.id===contact.AccountId))relationships.unshift({id:contact.AccountId,direct:true,roles:null})
  person={source_id:source,customer:scalar(contact.Name),owner:scalar(contact.OwnerId),plan:scalar(contact[fields.plan]),entitlement:scalar(contact[fields.entitlement]),source_revision:scalar(contact.LastModifiedDate),fields:Object.fromEntries((fields.editable_contact??[]).map((key:string)=>[key,contact[key]??null]))}
 }
 if(new Set(relationships.map(x=>x.id)).size!==relationships.length)throw new ProviderFailure('ambiguous_account_relationship')
 const accounts=[]
 for(const relationship of relationships){
  const r=await request(row,token,hub?`/crm/v3/objects/companies/${relationship.id}?properties=${unique(['name','hubspot_owner_id',...accountFields])}`:`/services/data/v66.0/sobjects/Account/${relationship.id}?fields=${unique(['Id','Name','OwnerId','LastModifiedDate',...accountFields])}`)
  if((hub?String(r.id):r.Id)!==relationship.id||r.archived)throw new ProviderFailure('identity_mismatch')
  const p=hub?r.properties:r
  accounts.push({...relationship,object:hub?'company':'account',name:scalar(hub?p.name:p.Name),owner:scalar(hub?p.hubspot_owner_id:p.OwnerId),plan:scalar(p[fields.account_plan]),entitlement:scalar(p[fields.account_entitlement]),source_revision:scalar(hub?r.updatedAt:r.LastModifiedDate),fields:Object.fromEntries((fields.editable_account??[]).map((key:string)=>[key,p[key]??null]))})
 }
 return {...person,accounts,relationships_complete:!truncated,truncated,company:accounts.map(x=>x.name||x.id).join(', ')||null}
}
