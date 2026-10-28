import type {SourceRecord} from '../../import-kit/src/types'
import {fieldDefinition,validateFieldValue} from '../../tickets/fields'
import {formDefinition} from '../../forms/definition'
import type {StoredField} from '../../forms/types'
import type {NativeValue} from './normalise'
import {nativeId,sourceId,text,time,object} from './common'

const supported:Record<string,string>={text:'text',textarea:'text',integer:'number',decimal:'decimal',date:'date',checkbox:'checkbox',tagger:'dropdown',multiselect:'multiselect',regexp:'regex'}
const system=new Set(['subject','description'])
export function zendeskField(record:SourceRecord,projectId:string):StoredField{
 const p=record.payload as any,type=supported[p.type]
 if(!type)throw Error('field_type_not_supported')
 if(p.active!==true)throw Error('inactive_field_not_imported')
 if(p.visible_in_portal!==true||p.editable_in_portal!==true||p.agent_can_edit===false)throw Error('field_permissions_require_native_review')
 const options:string[]=[]
 if(['tagger','multiselect'].includes(p.type)){
  if(!Array.isArray(p.custom_field_options))throw Error('field_options_required')
  for(const option of p.custom_field_options){if(!object(option))throw Error('field_options_required');options.push(text(option.value,'field_option_value_required',120))}
 }
 const definition=fieldDefinition({name:p.title,type,required:false,options,...(type==='regex'?{validation:{pattern:p.regexp_for_validation}}:{})})
 return {project_id:projectId,id:nativeId(projectId,'zendesk','field',record.sourceId),...definition,updated_at:time(p.updated_at,'iso')}
}

export function zendeskFields(record:SourceRecord,projectId:string,records:Map<string,SourceRecord>,omissions:string[]):{kind:string;target:string;tables:NativeValue['tables']}|null{
 if(record.kind==='ticket_field'){
  const field=zendeskField(record,projectId),p=record.payload as any
  if(p.required)omissions.push('field_solve_requirement_requires_native_review')
  if(['tagger','multiselect','checkbox'].includes(p.type))omissions.push('field_tag_side_effects_not_activated')
  if(p.default_value!=null&&p.default_value!=='')omissions.push('field_default_value_requires_native_review')
  return {kind:'field',target:field.id,tables:{ticket_fields:[field]}}
 }
 if(record.kind!=='ticket_form')return null
 const p=record.payload as any
 if(p.end_user_visible!==true||p.in_all_brands!==true||!Array.isArray(p.restricted_brand_ids)||p.restricted_brand_ids.length)throw Error('form_brand_or_visibility_requires_native_review')
 if(!Array.isArray(p.agent_conditions)||p.agent_conditions.length||!Array.isArray(p.end_user_conditions)||p.end_user_conditions.length)throw Error('form_conditions_not_supported')
 if(!Array.isArray(p.ticket_field_ids)||!p.ticket_field_ids.length||new Set(p.ticket_field_ids.map(String)).size!==p.ticket_field_ids.length)throw Error('form_fields_required')
 const catalogue:StoredField[]=[],fields:any[]=[],translated:Record<string,any>={}
 for(const raw of p.ticket_field_ids){
  const source=records.get('ticket_field/'+sourceId(raw,'zendesk'))
  if(!source)throw Error('form_field_unavailable')
  const original=source.payload as any
  if(system.has(original.type)){omissions.push('form_native_subject_and_message_always_required');continue}
  const field=zendeskField(source,projectId);catalogue.push(field);fields.push({fieldId:field.id,required:original.required_in_portal===true})
  translated[field.id]={label:text(original.title_in_portal??original.title,'field_label_required',120),description:typeof original.description==='string'?original.description:''}
  if(['tagger','multiselect'].includes(original.type))translated[field.id].options=Object.fromEntries(original.custom_field_options.map((option:any)=>[option.value,text(option.name,'field_option_label_required',120)]))
 }
 const title=text(p.display_name??p.name,'form_name_required',120)
 if(/\{\{|\{%/.test(title))throw Error('form_dynamic_content_not_supported')
 const config=formDefinition({title,enabled:false,locale:'en',fields,translations:{en:{fields:translated}}},catalogue),target=nativeId(projectId,'zendesk','form',record.sourceId)
 omissions.push('form_imported_disabled_explicit_publication_required','form_locale_requires_native_review')
 if(p.default)omissions.push('form_default_requires_native_review')
 return {kind:'form',target,tables:{request_forms:[{project_id:projectId,id:target,config_json:JSON.stringify(config),enabled:0,updated_at:time(p.updated_at,'iso')}]}}
}

export function zendeskTicketFields(record:SourceRecord,projectId:string,conversationId:string,records:Map<string,SourceRecord>,omissions:string[]){
 const values=(record.payload as any).custom_fields
 if(values===undefined)return []
 if(!Array.isArray(values))throw Error('ticket_custom_fields_invalid')
 const seen=new Set<string>(),rows:Record<string,any>[]=[]
 for(const value of values){
  if(!object(value))throw Error('ticket_custom_fields_invalid')
  const source=sourceId(value.id,'zendesk');if(seen.has(source))throw Error('ticket_custom_fields_conflict');seen.add(source)
  if(value.value===null||value.value==='')continue
  const definition=records.get('ticket_field/'+source)
  if(!definition){omissions.push('ticket_custom_field_definition_missing:'+source);continue}
  let field:StoredField
  try{field=zendeskField(definition,projectId)}catch{omissions.push('ticket_custom_field_unsupported:'+source);continue}
  // Do not coerce a vendor value: the original numeric/boolean/string type is
  // part of its meaning and must pass the same native validation as an edit.
  const checked=validateFieldValue(field,value.value)
  if(checked!==null)rows.push({project_id:projectId,conversation_id:conversationId,field_id:field.id,value_json:JSON.stringify(checked)})
 }
 return rows
}
