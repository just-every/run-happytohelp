import type {Env} from '../../../platform/env'
import {validateAttribute} from '../../customers/validation'
import {stale} from './store'
import type {Company,Contact,Definition,ImportRun,PlannedRow} from './types'

/**
 * A run is fenced by the current rows it matched, claimed or wrote, never by unrelated
 * workspace writes. Apply compares them with the dry run's before images, undo with the
 * after images; the same state is then asserted inside the mutating batch.
 */
const planned=`SELECT * FROM csv_customer_import_rows WHERE run_id=?1 AND project_id=?2 AND action<>'skip'`
const domains=(alias:string)=>`(SELECT json_group_array(domain) FROM (SELECT domain FROM company_domains d WHERE d.project_id=${alias}.project_id AND d.company_id=${alias}.id ORDER BY domain))`
const contactState=`json_object(
 'contacts',json((SELECT json_group_array(json_object('id',id,'name',name,'email',email,'external_id',external_id,'metadata_json',metadata_json,'is_verified',is_verified,'company_id',company_id)) FROM (
  SELECT c.id,c.name,c.email,c.external_id,c.metadata_json,c.is_verified,cc.company_id FROM contacts c LEFT JOIN contact_companies cc ON cc.project_id=c.project_id AND cc.contact_id=c.id
  WHERE c.project_id=?2 AND (c.id IN (SELECT entity_id FROM (${planned})) OR lower(c.email) IN (SELECT lower(json_extract(after_json,'$.email')) FROM (${planned}) UNION SELECT lower(json_extract(before_json,'$.email')) FROM (${planned})) OR c.external_id IN (SELECT json_extract(after_json,'$.external_id') FROM (${planned})))
  ORDER BY c.id))),
 'companies',json((SELECT json_group_array(json_object('id',id,'name',name,'merged_into',merged_into,'domains',json(domains))) FROM (
  SELECT co.id,co.name,co.merged_into,${domains('co')} domains FROM companies co
  WHERE co.project_id=?2 AND co.id IN (SELECT json_extract(after_json,'$.company_id') FROM (${planned}) UNION SELECT json_extract(before_json,'$.company_id') FROM (${planned}))
  ORDER BY co.id))))`
const companyState=`json_object(
 'companies',json((SELECT json_group_array(json_object('id',id,'name',name,'attributes_json',attributes_json,'portal_company_view',portal_company_view,'merged_into',merged_into,'domains',json(domains),'members',members)) FROM (
  SELECT co.id,co.name,co.attributes_json,co.portal_company_view,co.merged_into,${domains('co')} domains,(SELECT count(*) FROM contact_companies m WHERE m.project_id=co.project_id AND m.company_id=co.id) members FROM companies co
  WHERE co.project_id=?2 AND (co.id IN (SELECT entity_id FROM (${planned})) OR lower(co.name) IN (SELECT lower(json_extract(after_json,'$.name')) FROM (${planned}))
   OR co.id IN (SELECT d.company_id FROM company_domains d JOIN (${planned}) r JOIN json_each(json_extract(r.after_json,'$.domains')) wanted ON d.domain=wanted.value WHERE d.project_id=?2))
  ORDER BY co.id))),
 'definitions',json((SELECT json_group_array(json_object('id',id,'name',name,'type',type,'options_json',options_json)) FROM (
  SELECT id,name,type,options_json FROM company_attribute_definitions WHERE project_id=?2 AND id IN (SELECT a.key FROM (${planned}) r JOIN json_each(json_extract(r.data_json,'$.attributes')) a)
  ORDER BY id))))`

type CompanyState=Pick<Company,'id'|'name'|'merged_into'|'domains'>&Partial<Pick<Company,'attributes_json'|'portal_company_view'>>&{members?:number}
interface State {contacts?:Omit<Contact,'created_at'>[];companies:CompanyState[];definitions?:Definition[]}

const contactFields=['name','email','external_id','metadata_json','is_verified','company_id'] as const
const companyFields=['name','attributes_json','portal_company_view','merged_into','domains'] as const
const same=(current:object|undefined,image:object|null,fields:readonly string[])=>Boolean(current&&image)&&fields.every(key=>JSON.stringify((current as any)[key])===JSON.stringify((image as any)[key]))
const lower=(value:unknown)=>typeof value==='string'?value.toLowerCase():null

function contactsHold(rows:PlannedRow[],state:State,undo:boolean){
 const contacts=state.contacts!,companies=new Map(state.companies.map(company=>[company.id,company]))
 const active=(id:string|null|undefined)=>!id||Boolean(companies.get(id)&&!companies.get(id)!.merged_into)
 return rows.every(row=>{
  const before=row.before as Contact|null,after=row.after as Contact,current=contacts.find(contact=>contact.id===row.entityId)
  const claimed=(email:string|null|undefined)=>Boolean(email)&&contacts.some(contact=>contact.id!==row.entityId&&lower(contact.email)===lower(email))
  if(undo)return same(current,after,contactFields)&&(before?.company_id===after.company_id||active(before?.company_id))&&(lower(before?.email)===lower(after.email)||!claimed(before?.email))
  if(row.action==='update'?!same(current,before,contactFields):current)return false
  if(claimed(after.email)||(after.external_id&&contacts.some(contact=>contact.id!==row.entityId&&contact.external_id===after.external_id)))return false
  if(after.company_id===before?.company_id)return true
  const company=companies.get(after.company_id!),named=String(row.data.company??'')
  if(after.company_id&&(!active(after.company_id)||(row.domainMatch?.companyId===after.company_id&&!company!.domains.includes(row.domainMatch.domain))||(named&&company!.id!==named&&lower(company!.name)!==lower(named))))return false
  return active(before?.company_id)
 })
}
function companiesHold(rows:PlannedRow[],state:State,undo:boolean){
 const definitions=new Map(state.definitions!.map(definition=>[definition.id,definition]))
 return rows.every(row=>{
  const after=row.after as Company,current=state.companies.find(company=>company.id===row.entityId)
  if(undo)return same(current,after,companyFields)&&(row.action!=='create'||current!.members===0)
  if(row.action==='update'?!same(current,row.before,companyFields):current)return false
  if(state.companies.some(company=>company.id!==row.entityId&&((!company.merged_into&&lower(company.name)===lower(after.name))||company.domains.some(domain=>after.domains.includes(domain)))))return false
  return Object.entries((row.data.attributes??{}) as Record<string,unknown>).every(([id,value])=>{
   const definition=definitions.get(id)
   try{return Boolean(definition)&&validateAttribute(definition!,value)===value}catch{return false}
  })
 })
}

/** Read the run's touched state, refuse if it moved, and return the in-batch assertion of that same state. */
export async function runFence(env:Env,run:ImportRun,rows:PlannedRow[],undo:boolean){
 const sql=run.kind==='contacts'?contactState:companyState
 const text=(await env.DB.prepare(`SELECT ${sql} state`).bind(run.id,run.project_id).first<{state:string}>())!.state
 const state=JSON.parse(text) as State,touched=rows.filter(row=>row.action!=='skip')
 if(!(run.kind==='contacts'?contactsHold(touched,state,undo):companiesHold(touched,state,undo)))throw stale()
 return env.DB.prepare(`INSERT INTO csv_customer_assertions(ok) SELECT CASE WHEN ${sql}=?3 THEN 1 ELSE 0 END`).bind(run.id,run.project_id,text)
}
