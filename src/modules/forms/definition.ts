import {HTTPException} from 'hono/http-exception'
import {object} from '../tickets/model'
import {validateFieldValue} from '../tickets/fields'
import type {FormConfig,FormField,FormTranslation,StoredField} from './types'
export const publicField=(f:StoredField)=>JSON.parse(f.read_roles_json).length===0&&JSON.parse(f.write_roles_json).length===0
const bad=(message:string):never=>{throw new HTTPException(400,{message})}
function text(value:unknown,max:number,empty=false){if(typeof value!=='string'||value.length>max||!empty&&!value.trim())bad(`Enter text ${empty?'up to':'of 1–'} ${max} characters`);return (value as string).trim()}
const locale=(value:unknown)=>{if(typeof value!=='string'||!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value))bad('Invalid locale');return value as string}
export function formDefinition(body:unknown,catalogue:StoredField[]):FormConfig{
 const b=object(body),title=text(b.title,120),description=text(b.description??'',2000,true),submitLabel=text(b.submitLabel??'Submit request',120),base=locale(b.locale??'en')
 if(b.enabled!==undefined&&typeof b.enabled!=='boolean')bad('Enabled must be boolean')
 const refs=b.fields??[];if(!Array.isArray(refs)||refs.length>50)bad('Choose up to 50 ticket fields')
 const seen=new Set<string>(),fields:FormField[]=[]
 for(const raw of refs){const ref=object(raw),field=catalogue.find(f=>f.id===ref.fieldId&&publicField(f));if(!field||['subject','message'].includes(ref.fieldId))bad('Unknown or internal ticket field');if(seen.has(field!.id))bad('Duplicate ticket field');if(ref.required!==undefined&&typeof ref.required!=='boolean')bad('Required must be boolean')
  let condition:FormField['condition']
  if(ref.condition!==undefined){const c=object(ref.condition);if(!seen.has(c.fieldId)||!['equals','not_equals','includes','present'].includes(c.operator))bad('Conditions must refer to an earlier form field');const source=catalogue.find(f=>f.id===c.fieldId)!
   if(c.operator!=='present'){if(source.type==='account'&&!JSON.parse(source.options_json).includes(c.value))bad('Choose an account from this workspace for the condition');if(!['string','number','boolean'].includes(typeof c.value))bad('Condition needs a scalar value');try{validateFieldValue({...source,required:0},c.operator==='includes'?[c.value]:c.value)}catch{bad('Condition value does not match its ticket field')};if(c.operator==='includes'&&source.type!=='multiselect')bad('Includes conditions require a multiselect field')}
   condition={fieldId:c.fieldId,operator:c.operator,...(c.operator==='present'?{}:{value:c.value})}
  }
  fields.push({fieldId:field!.id,required:!!ref.required,...(condition?{condition}:{})});seen.add(field!.id)
 }
 const translations:Record<string,FormTranslation>=Object.create(null);const source=object(b.translations??{});if(Object.keys(source).length>30)bad('Too many form locales')
 for(const [key,value] of Object.entries(source)){locale(key);const t=object(value),out:FormTranslation={}
  for(const k of ['title','description','submitLabel'] as const)if(t[k]!==undefined)out[k]=text(t[k],k==='description'?2000:120,k==='description')
  if(t.fields!==undefined){const translatedFields:NonNullable<FormTranslation['fields']>=Object.create(null);out.fields=translatedFields;for(const [id,raw] of Object.entries(object(t.fields))){if(!['subject','message'].includes(id)&&!seen.has(id))bad('Translation refers to a field outside this form');const f=object(raw),translation:NonNullable<FormTranslation['fields']>[string]={}
    if(f.label!==undefined)translation.label=text(f.label,120)
    if(f.description!==undefined)translation.description=text(f.description,2000,true)
    if(f.options!==undefined){const options:string[]=id==='subject'||id==='message'?[]:JSON.parse(catalogue.find(f=>f.id===id)!.options_json);const translatedOptions:Record<string,string>=Object.create(null);translation.options=translatedOptions;for(const [option,label] of Object.entries(object(f.options))){if(!options.includes(option))bad('Translation refers to an unknown choice');translatedOptions[option]=text(label,120)}}
    translatedFields[id]=translation
  }}translations[key]=out
 }
 return {title,description,submitLabel,locale:base,enabled:b.enabled??false,fields,translations}
}
