import type {Env} from '../../platform/env'
import type {PublicForm} from './types'
import {fieldCatalogue,storedForm} from './store'
import {publicField} from './definition'
import {livePortalContact,portalSessionGuard,type PortalIdentity} from '../portal/identity'
import {mailboxProofSql} from '../identity/mailbox'
import {fieldError,visibleField} from './validation'

/** Explicit current membership is independent of company ticket visibility. */
export function accountChoiceGuard(projectId:string,contactId:string,accountId:string):{sql:string;args:Array<string|number>}{
 return {sql:`EXISTS(SELECT 1 FROM contact_companies member JOIN companies account ON account.id=member.company_id AND account.project_id=member.project_id JOIN contacts customer ON customer.id=member.contact_id AND customer.project_id=member.project_id WHERE member.project_id=? AND member.contact_id=? AND account.id=? AND account.merged_into IS NULL AND ${mailboxProofSql('customer')} AND ${livePortalContact('customer')})`,args:[projectId,contactId,accountId]}
}
// Publication grants disclosure of the eligible identifier and label only.
function publicationGuard(form:PublicForm,fieldIds:string[]){
 // One JSON parameter preserves the form's 50-field capacity under D1's bind limit.
 return {sql:`EXISTS(SELECT 1 FROM request_forms published WHERE published.project_id=? AND published.id=? AND published.enabled=1 AND published.updated_at=? AND NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN ticket_fields field ON field.project_id=published.project_id AND field.id=expected.value WHERE field.id IS NULL OR field.type<>'account' OR field.read_roles_json<>'[]' OR field.write_roles_json<>'[]' OR NOT EXISTS(SELECT 1 FROM json_each(published.config_json,'$.fields') ref WHERE json_extract(ref.value,'$.fieldId')=expected.value)))`,args:[form.projectId,form.id,form.updatedAt,JSON.stringify(fieldIds)]}
}
export async function validateAccountPublication(env:Env,projectId:string,formId:string,body:unknown){
 const values=body&&typeof body==='object'?(body as any).fields:null
 if(!values||typeof values!=='object'||Array.isArray(values))return
 const catalogue=await fieldCatalogue(env,projectId)
 const supplied=catalogue.filter(field=>field.type==='account'&&values[field.id]!==undefined&&values[field.id]!==null&&values[field.id]!=='')
 if(!supplied.length)return
 const form=await storedForm(env,projectId,formId)
 for(const field of supplied)if(!form.enabled||!publicField(field)||!form.fields.some(ref=>ref.fieldId===field.id))fieldError(field.id,'unavailable_field','This account question is no longer available. Contact the support team through the website chat.')
}
export async function accountChoices(env:Env,form:PublicForm,fieldId:string,identity?:PortalIdentity){
 if(!identity)return []
 const session=portalSessionGuard(identity),contactId=identity.actor.contactId??identity.actor.id
 const publication=publicationGuard(form,[fieldId])
 const membership=accountChoiceGuard(form.projectId,contactId,'')
 // The membership predicate is correlated to the candidate account; no domain lookup.
 const sql=membership.sql.replace('account.id=?','account.id=candidate.id')
 const accounts=await env.DB.prepare(`SELECT candidate.id,candidate.name FROM companies candidate WHERE candidate.project_id=? AND ${sql} AND ${publication.sql} AND ${session.sql} ORDER BY candidate.id`).bind(form.projectId,...membership.args.slice(0,2),...publication.args,...session.args).all<{id:string;name:string}>()
 return accounts.results.map(account=>({value:account.id,label:account.name}))
}
/** Account predicates are evaluated here; their values never cross the customer boundary. */
export async function withAccountChoices(env:Env,form:PublicForm,identity?:PortalIdentity,values:Record<string,unknown>={}){
 const fields=await Promise.all(form.fields.map(async field=>field.type==='account'?{...field,options:await accountChoices(env,form,field.id,identity)}:{...field}))
 const accepted:Record<string,unknown>=Object.create(null)
 for(const field of fields){
  const condition=field.condition,source=condition&&fields.find(f=>f.id===condition.fieldId)
  if(source?.type==='account'){
   const active=visibleField(field,accepted)
   delete field.condition
   field.visible=active
  }
  // Other predicates remain on the field and are checked by the renderer and
  // canonical submission validator. Offers need only eligible account selections.
  const value=values[field.id]
  if(field.type==='account'&&field.visible!==false&&field.options.some(option=>option.value===value))accepted[field.id]=value
 }
 return {...form,verified:!!identity,fields}
}
export async function validateAccountMembership(env:Env,projectId:string,contactId:string,fields:Array<{id:string;type:string;label?:string;name?:string}>,values:Record<string,unknown>){
 const guards:Array<ReturnType<typeof accountChoiceGuard>>=[]
 for(const field of fields){
  const value=values[field.id];if(field.type!=='account'||value===null||value===undefined||value==='')continue
  const guard=accountChoiceGuard(projectId,contactId,String(value))
  if(!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first())fieldError(field.id,'invalid_account',`${field.label??field.name}: Choose an available account`)
  guards.push(guard)
 }
 return [...new Map(guards.map(guard=>[JSON.stringify(guard.args),guard])).values()]
}
export async function validateAccountChoices(env:Env,form:PublicForm,contactId:string,values:Record<string,unknown>){
 const guards=await validateAccountMembership(env,form.projectId,contactId,form.fields,values),published:string[]=[]
 for(const field of form.fields){
  const value=values[field.id];if(field.type!=='account'||value===null||value===undefined||value==='')continue
  const publication=publicationGuard(form,[field.id])
  if(!await env.DB.prepare(`SELECT 1 WHERE ${publication.sql}`).bind(...publication.args).first())fieldError(field.id,'unavailable_field','This account question has changed. Contact the support team through the website chat.')
  published.push(field.id)
 }
 if(published.length)guards.push(publicationGuard(form,published))
 return [...new Map(guards.map(guard=>[JSON.stringify(guard.args),guard])).values()]
}
