import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {fieldAllowed,ticketAuthority} from '../tickets/model'
import {validateFieldValue} from '../tickets/fields'
import {fieldCatalogue,storedForm} from '../forms/store'
import {fieldError,validateSubmission} from '../forms/validation'
import {formFieldGuard} from '../forms/field-guard'
import {accountChoiceGuard,validateAccountMembership} from '../forms/account-lookup'
import type {PublicForm,StoredField} from '../forms/types'
import type {OutboundTicketInput} from './outbound-ticket-input'

/** Native form semantics, with submission requirements independent of required-to-solve. */
export async function operatorForm(env:Env,actor:Actor,formId:string,access:Awaited<ReturnType<typeof ticketAuthority>>['access']){
 let form
 try{form=await storedForm(env,actor.projectId,formId)}catch(error){if(error instanceof HTTPException&&error.status===404)fieldError('formId','unavailable_form','Choose an available workspace request form');throw error}
 const catalogue=await fieldCatalogue(env,actor.projectId)
 if(!form.enabled)fieldError('formId','unavailable_form','Choose an available request form')
 const definitions:StoredField[]=form.fields.map(ref=>{
  const field=catalogue.find(f=>f.id===ref.fieldId)
  if(!field||!fieldAllowed(field,access)||!fieldAllowed(field,access,true))fieldError(ref.fieldId,'unavailable_field','This form contains a field your role cannot write')
  return field
 })
 const definition:PublicForm={id:form.id,projectId:form.projectId,title:form.title,description:form.description,submitLabel:form.submitLabel,locale:form.locale,defaultLocale:form.locale,locales:[form.locale],turnstileSiteKey:null,updatedAt:form.updatedAt,fields:form.fields.map((ref,index)=>{const field=definitions[index];return {id:field.id,type:field.type,label:field.name,description:'',required:ref.required,options:JSON.parse(field.options_json).map((value:string)=>({value,label:value})),validation:JSON.parse(field.validation_json),...(ref.condition?{condition:ref.condition}:{})}})}
 return {form,definitions,definition}
}
export async function prepareOutboundConfiguration(env:Env,actor:Actor,input:OutboundTicketInput,contactId:string,access:Awaited<ReturnType<typeof ticketAuthority>>['access']){
 const predicates:string[]=[],params:unknown[]=[],values:Record<string,unknown>={}
 let provenance:{id:string;title:string;version:number}|null=null
 if(input.formId){
  const {form,definitions,definition}=await operatorForm(env,actor,input.formId,access)
  // Public submission validation owns condition order, hidden values and field-specific errors.
  Object.assign(values,validateSubmission(definition,{subject:input.subject,message:input.content,fields:input.fields,localId:input.localId}).fields)
  const guard=formFieldGuard(actor.projectId,definitions)
  predicates.push(guard.sql,'EXISTS(SELECT 1 FROM request_forms WHERE project_id=? AND id=? AND enabled=1 AND updated_at=?)')
  params.push(...guard.args,actor.projectId,form.id,form.updatedAt)
  provenance={id:form.id,title:form.title,version:form.updatedAt}
 }else{
  const catalogue=Object.keys(input.fields??{}).length?await fieldCatalogue(env,actor.projectId):[]
  for(const [id,value] of Object.entries(input.fields??{})){
   const field=catalogue.find(f=>f.id===id)
   if(!field)fieldError(id,'unavailable_field','Choose an available workspace field')
   if(!fieldAllowed(field,access)||!fieldAllowed(field,access,true))fieldError(id,'denied_field','Your role cannot write this field')
   try{values[id]=validateFieldValue({...field,required:0},value)}catch(error){fieldError(id,'invalid',error instanceof Error?error.message:'Invalid field value')}
  }
  // Pin the exact permission-bearing definitions used above, including role edits.
  if(catalogue.length){predicates.push("NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN ticket_fields f ON f.project_id=? AND f.id=json_extract(expected.value,'$.id') WHERE f.id IS NULL OR f.updated_at<>json_extract(expected.value,'$.updated_at') OR f.read_roles_json<>json_extract(expected.value,'$.read_roles_json') OR f.write_roles_json<>json_extract(expected.value,'$.write_roles_json'))");params.push(JSON.stringify(catalogue.filter(f=>f.id in values)),actor.projectId)}
 }
 const definitions=Object.keys(values).length?await fieldCatalogue(env,actor.projectId):[]
 for(const guard of await validateAccountMembership(env,actor.projectId,contactId,definitions,values)){predicates.push(guard.sql);params.push(...guard.args)}
 const groupId=input.groupId??null,assigneeId=input.assigneeId===undefined?actor.id:input.assigneeId
 if(groupId){const sql='SELECT 1 FROM ticket_groups WHERE project_id=? AND id=?';if(!await env.DB.prepare(sql).bind(actor.projectId,groupId).first())fieldError('groupId','unavailable_group','Choose an available workspace group');predicates.push(`EXISTS(${sql})`);params.push(actor.projectId,groupId)}
 if(assigneeId){const sql=`SELECT 1 FROM memberships WHERE project_id=? AND user_id=? ${groupId?'AND EXISTS(SELECT 1 FROM ticket_group_members WHERE project_id=? AND group_id=? AND user_id=?)':''}`,args=[actor.projectId,assigneeId,...(groupId?[actor.projectId,groupId,assigneeId]:[])];if(!await env.DB.prepare(sql).bind(...args).first())fieldError('assigneeId','unavailable_assignee','Choose a current teammate in the selected group');predicates.push(`EXISTS(${sql})`);params.push(...args)}
 return {values,provenance,groupId,assigneeId,sql:predicates.length?predicates.join(' AND '):'1',params}
}

/** Account offers disclose only this requester's explicit current native membership. */
export async function outboundAccountOptions(env:Env,projectId:string,contactId:string){
 const guard=accountChoiceGuard(projectId,contactId,'')
 const rows=await env.DB.prepare(`SELECT candidate.id value,candidate.name label FROM companies candidate WHERE candidate.project_id=? AND ${guard.sql.replace('account.id=?','account.id=candidate.id')} ORDER BY candidate.name,candidate.id`).bind(projectId,...guard.args.slice(0,2)).all<{value:string;label:string}>()
 return rows.results
}
