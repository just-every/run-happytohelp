import type {Env} from '../../platform/env'
import type {PublicForm} from './types'
import {livePortalContact} from '../portal/identity'
import {mailboxProofSql} from '../identity/mailbox'
import {fieldError} from './validation'

/** The existing portal entitlement is required even for a customer's own account. */
export function accountChoiceGuard(projectId:string,contactId:string,accountId:string){
 return {sql:`EXISTS(SELECT 1 FROM contact_companies member JOIN companies account ON account.id=member.company_id AND account.project_id=member.project_id JOIN contacts customer ON customer.id=member.contact_id AND customer.project_id=member.project_id WHERE member.project_id=? AND member.contact_id=? AND account.id=? AND account.portal_company_view=1 AND account.merged_into IS NULL AND ${mailboxProofSql('customer')} AND ${livePortalContact('customer')})`,args:[projectId,contactId,accountId]}
}
export async function accountChoices(env:Env,projectId:string,contactId?:string){
 if(!contactId)return []
 const membership=await env.DB.prepare('SELECT company_id FROM contact_companies WHERE project_id=? AND contact_id=?').bind(projectId,contactId).first<{company_id:string}>()
 if(!membership)return []
 const guard=accountChoiceGuard(projectId,contactId,membership.company_id)
 const account=await env.DB.prepare(`SELECT id,name FROM companies WHERE project_id=? AND id=? AND ${guard.sql}`).bind(projectId,membership.company_id,...guard.args).first<{id:string;name:string}>()
 return account?[{value:account.id,label:account.name}]:[]
}
export async function withAccountChoices(env:Env,form:PublicForm,contactId?:string){
 if(!form.fields.some(field=>field.type==='account'))return form
 const options=await accountChoices(env,form.projectId,contactId)
 return {...form,fields:form.fields.map(field=>field.type==='account'?{...field,options}:field)}
}
export async function validateAccountChoices(env:Env,projectId:string,contactId:string,fields:Array<{id:string;type:string;label?:string;name?:string}>,values:Record<string,unknown>){
 const guards:Array<ReturnType<typeof accountChoiceGuard>>=[]
 for(const field of fields){
  const value=values[field.id];if(field.type!=='account'||value===null||value===undefined||value==='')continue
  const guard=accountChoiceGuard(projectId,contactId,String(value))
  if(!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first())fieldError(field.id,'invalid_account',`${field.label??field.name}: Choose an available account`)
  guards.push(guard)
 }
 return [...new Map(guards.map(guard=>[JSON.stringify(guard.args),guard])).values()]
}
