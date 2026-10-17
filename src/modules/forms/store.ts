import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {requireActiveProject} from '../../platform/project-status'
import {publicField} from './definition'
import type {PublicForm,PublicField,RequestForm,StoredField} from './types'
export async function fieldCatalogue(env:Env,projectId:string){return (await env.DB.prepare('SELECT * FROM ticket_fields WHERE project_id=? ORDER BY name,id').bind(projectId).all<StoredField>()).results}
export function decodeForm(row:any):RequestForm{return {...JSON.parse(row.config_json),id:row.id,projectId:row.project_id,enabled:!!row.enabled,updatedAt:row.updated_at}}
export async function storedForm(env:Env,projectId:string,formId:string){const row=await env.DB.prepare('SELECT * FROM request_forms WHERE project_id=? AND id=?').bind(projectId,formId).first<any>();if(!row)throw new HTTPException(404,{message:'Request form not found'});return decodeForm(row)}
function publicDefinition(form:RequestForm,catalogue:StoredField[],env:Env,requested?:string):PublicForm|null{
 if(!form.enabled||form.fields.some(ref=>!catalogue.some(f=>f.id===ref.fieldId&&publicField(f))))return null
 const locale=requested&&form.translations[requested]?requested:form.locale,base=form.translations[form.locale]??{},translation=form.translations[locale]??{},localized={...base,...translation}
 const field=(id:string,type:string,label:string,required:boolean,options:string[]=[],validation:Record<string,unknown>={},condition?:PublicField['condition']):PublicField=>{
  const translated={...base.fields?.[id],...translation.fields?.[id]},optionLabels={...base.fields?.[id]?.options,...translation.fields?.[id]?.options}
  return {id,type,label:translated.label??label,description:translated.description??'',required,options:options.map(value=>({value,label:optionLabels[value]??value})),validation,...(condition?{condition}:{})}
 }
 return {id:form.id,projectId:form.projectId,title:localized.title??form.title,description:localized.description??form.description,submitLabel:localized.submitLabel??form.submitLabel,locale,defaultLocale:form.locale,locales:[...new Set([form.locale,...Object.keys(form.translations)])],fields:[field('subject','text','Subject',true,[],{max:500}),field('message','text','Message',true,[],{max:100000}),...form.fields.map(ref=>{const f=catalogue.find(f=>f.id===ref.fieldId)!;return field(f.id,f.type,f.name,ref.required||!!f.required,JSON.parse(f.options_json),JSON.parse(f.validation_json),ref.condition)})],turnstileSiteKey:typeof env.FORMS_TURNSTILE_SITE_KEY==='string'&&env.FORMS_TURNSTILE_SITE_KEY.trim()?env.FORMS_TURNSTILE_SITE_KEY:null,updatedAt:form.updatedAt}
}
/** Only published forms with exclusively customer-visible R3 fields cross this boundary. */
export async function listForms(env:Env,projectId:string,locale?:string):Promise<PublicForm[]>{
 await requireActiveProject(env,projectId)
 const [forms,catalogue]=await Promise.all([env.DB.prepare('SELECT * FROM request_forms WHERE project_id=? AND enabled=1 ORDER BY updated_at,id').bind(projectId).all<any>(),fieldCatalogue(env,projectId)])
 return forms.results.map(row=>publicDefinition(decodeForm(row),catalogue,env,locale)).filter((form):form is PublicForm=>!!form)
}
export async function loadPublicForm(env:Env,projectId:string,formId:string,locale?:string){
 await requireActiveProject(env,projectId)
 const [form,catalogue]=await Promise.all([storedForm(env,projectId,formId),fieldCatalogue(env,projectId)])
 const result=publicDefinition(form,catalogue,env,locale);if(!result)throw new HTTPException(404,{message:'Request form not found'});return {form:result,catalogue}
}

export async function readForm(env:Env,projectId:string,formId:string,locale?:string):Promise<PublicForm>{return (await loadPublicForm(env,projectId,formId,locale)).form}
