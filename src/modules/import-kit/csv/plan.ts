import {HTTPException} from 'hono/http-exception'
import {attributeValue,parseCsv} from './parse'
import {domains as companyDomains,name as companyName} from '../../customers/validation'
import type {Company,Contact,DomainMatch,PlannedRow,PreviewInput,Snapshot} from './types'

function resolveCompany(value:string,companies:Company[]){
 const matches=companies.filter(company=>!company.merged_into&&(company.id===value||company.name.toLowerCase()===value.toLowerCase()))
 if(matches.length!==1)throw new Error(matches.length?'Company name is ambiguous':'Company not found')
 return matches[0]
}
function domainMatches(domains:string[],companies:Company[]){
 return domains.flatMap(domain=>companies.filter(company=>!company.merged_into&&company.domains.includes(domain)).map(company=>({domain,companyId:company.id,companyName:company.name})))
}
function contactPlan(data:Record<string,unknown>,input:PreviewInput,snapshot:Snapshot,now:number){
 const email=typeof data.email==='string'?data.email.toLowerCase():undefined,externalId=data.externalId as string|undefined
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Invalid email address')
 if(!data.name&&!email&&!externalId)throw new Error('Name, email or external ID required')
 const matches=snapshot.contacts.filter(contact=>(Boolean(email)&&contact.email?.toLowerCase()===email)||(Boolean(externalId)&&contact.external_id===externalId))
 if(matches.length>1)throw new Error('Contact identity is ambiguous or conflicts with another contact')
 const before=matches[0]??null,metadata=JSON.parse(before?.metadata_json||'{}')
 if(metadata.is_erased||metadata.is_erasing||metadata.is_deleted)throw new Error('Contact is erased, being erased or deleted')
 let companyId=before?.company_id??null,domainMatch:DomainMatch|null=null
 if('company' in data){companyId=data.company?resolveCompany(String(data.company),snapshot.companies).id:null}
 if(input.matchDomains&&email){
  const found=domainMatches([email.split('@')[1]],snapshot.companies)
  if(found.length>1)throw new Error('Email domain matches multiple companies')
  domainMatch=found[0]??null
  if(domainMatch&&'company' in data&&companyId!==domainMatch.companyId)throw new Error('Explicit company conflicts with email domain match')
  if(domainMatch&&!('company' in data))companyId=domainMatch.companyId
 }
 const after:Contact={id:before?.id??crypto.randomUUID(),name:before?.name??null,email:before?.email??null,external_id:before?.external_id??null,metadata_json:before?.metadata_json??'{}',is_verified:before?.is_verified??0,created_at:before?.created_at??now,company_id:companyId}
 if('name' in data)after.name=String(data.name)||null
 if(email!==undefined){after.email=email||null;if(after.email!==before?.email)after.is_verified=0}
 if(externalId!==undefined)after.external_id=externalId||null
 if(email!==undefined)data.email=email
 return {before,after,domainMatch}
}
function companyPlan(data:Record<string,unknown>,input:PreviewInput,snapshot:Snapshot,now:number){
 data.name=companyName(data.name)
 const domains='domains' in data?companyDomains(String(data.domains).split(/[;,\s]+/).filter(Boolean)):undefined
 const named=snapshot.companies.filter(company=>!company.merged_into&&company.name.toLowerCase()===String(data.name).toLowerCase())
 if(named.length>1)throw new Error('Company name is ambiguous')
 const found=input.matchDomains&&domains?domainMatches(domains,snapshot.companies):[],matchedIds=new Set(found.map(match=>match.companyId))
 if(matchedIds.size>1)throw new Error('Domains match different companies')
 const domainMatch=found[0]??null
 if(named[0]&&domainMatch&&named[0].id!==domainMatch.companyId)throw new Error('Company name conflicts with domain match')
 const before=named[0]??(domainMatch?snapshot.companies.find(company=>company.id===domainMatch.companyId)!:null)
 if(domains?.some(domain=>snapshot.companies.some(company=>company.id!==before?.id&&company.domains.includes(domain))))throw new Error('Domain already belongs to another company')
 const attributes=JSON.parse(before?.attributes_json||'{}')
 for(const [key,value] of Object.entries((data.attributes||{}) as Record<string,unknown>)){if(value===null)delete attributes[key];else attributes[key]=value}
 const after:Company={id:before?.id??crypto.randomUUID(),name:String(data.name),attributes_json:JSON.stringify(attributes),portal_company_view:before?.portal_company_view??0,revision:(before?.revision??0)+1,created_at:before?.created_at??now,updated_at:now,merged_into:null,domains:domains??before?.domains??[]}
 if(domains)data.domains=domains
 return {before,after,domainMatch}
}

export function planRows(input:PreviewInput,snapshot:Snapshot,now:number):PlannedRow[]{
 const {headers,records}=parseCsv(input.csv),definitions=new Map(snapshot.definitions.map(definition=>[definition.id,definition]))
 for(const [target,column] of Object.entries(input.mapping)){
  if(!headers.includes(column))throw new HTTPException(400,{message:`Mapped column not found: ${column}`})
  if(target.startsWith('attribute:')&&(input.kind!=='companies'||!definitions.has(target.slice(10))))throw new HTTPException(400,{message:'Unknown company attribute mapping'})
 }
 const claimed=new Set<string>()
 return records.map((cells,index)=>{
  const row:PlannedRow={row:index+2,action:'skip',reason:'',data:{},domainMatch:null,entityId:null,before:null,after:null}
  try{
   if(cells.length!==headers.length)throw new Error('Column count differs from the header')
   const attributes:Record<string,unknown>={}
   for(const [target,column] of Object.entries(input.mapping)){
    const value=cells[headers.indexOf(column)].trim()
    if(target.startsWith('attribute:'))attributes[target.slice(10)]=attributeValue(value,definitions.get(target.slice(10))!)
    else{if(value.length>320&&target!=='domains')throw new Error(`${target} exceeds 320 characters`);row.data[target]=value}
   }
   if(Object.keys(attributes).length)row.data.attributes=attributes
   const result=input.kind==='contacts'?contactPlan(row.data,input,snapshot,now):companyPlan(row.data,input,snapshot,now)
   Object.assign(row,result);row.entityId=result.after.id
   const keys=[`id:${result.after.id}`]
   if(input.kind==='contacts'){const contact=result.after as Contact;if(contact.email)keys.push(`email:${contact.email.toLowerCase()}`);if(contact.external_id)keys.push(`external:${contact.external_id}`)}
   else{const company=result.after as Company;keys.push(`name:${company.name.toLowerCase()}`,...company.domains.map(domain=>`domain:${domain}`))}
   if(keys.some(key=>claimed.has(key)))throw new Error('Duplicate entity or identity in this CSV; only the first row is planned')
   keys.forEach(key=>claimed.add(key))
   if(!result.before){row.action='create';row.reason='New customer record'}
   else{
    const same=input.kind==='contacts'?JSON.stringify(result.before)===JSON.stringify(result.after):['name','attributes_json','portal_company_view','merged_into','domains'].every(key=>JSON.stringify((result.before as unknown as Record<string,unknown>)[key])===JSON.stringify((result.after as unknown as Record<string,unknown>)[key]))
    row.action=same?'skip':'update';row.reason=same?'No changes':'Matched existing customer record'
   }
  }catch(error){row.reason=error instanceof Error?error.message:'Invalid row';row.before=null;row.after=null;row.entityId=null;row.domainMatch=null}
  return row
 })
}
