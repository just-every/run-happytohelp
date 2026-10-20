import {HTTPException} from 'hono/http-exception'

export function invalid(message:string):never{throw new HTTPException(400,{message})}
export function object(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))invalid('Expected an object');return value as Record<string,any>}
export function name(value:unknown){if(typeof value!=='string'||!value.trim()||value.length>200)invalid('Enter a name of 1–200 characters');return value.trim()}
export const fieldTypes=['text','number','date','dropdown','checkbox'] as const
export interface CompanyField {id:string;name:string;type:string;options_json:string}
export function fieldDefinition(value:unknown){
 const body=object(value),type=body.type,options=body.options??[]
 if(!fieldTypes.includes(type))invalid('Choose a supported company attribute type')
 if(!Array.isArray(options)||options.length>100||options.some(v=>typeof v!=='string'||!v.trim()||v.length>200)||new Set(options).size!==options.length)invalid('Options must be unique nonempty strings')
 if(type==='dropdown'&&!options.length)invalid('A drop-down needs options')
 if(type!=='dropdown'&&options.length)invalid('Only drop-down attributes have options')
 return {name:name(body.name),type:type as string,options_json:JSON.stringify(options)}
}
export function validateAttribute(field:CompanyField,value:unknown){
 if(value===null)return null
 const bad=()=>invalid(`Invalid value for ${field.name}`)
 switch(field.type){
  case 'text':if(typeof value!=='string'||value.length>4000)bad();break
  case 'number':if(typeof value!=='number'||!Number.isFinite(value))bad();break
  case 'date':if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)bad();break
  case 'checkbox':if(typeof value!=='boolean')bad();break
  case 'dropdown':if(typeof value!=='string'||!JSON.parse(field.options_json).includes(value))bad();break
  default:bad()
 }
 return value
}
export function attributes(value:unknown,fields:CompanyField[]){
 const input=object(value),result:Record<string,unknown>={}
 for(const [id,v] of Object.entries(input)){
  const field=fields.find(f=>f.id===id);if(!field)invalid(`Unknown company attribute: ${id}`)
  const checked=validateAttribute(field,v);if(checked!==null)result[id]=checked
 }
 return result
}
export function domains(value:unknown){
 if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'))invalid('Domains must be a list of at most 100 domain names')
 return [...new Set((value as string[]).map(v=>{
  const d=v.trim().toLowerCase().replace(/\.$/,'')
  if(d.length>253||!d.includes('.')||d.split('.').some(part=>part.length>63||!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part)))invalid('Enter a domain name without a URL or email address')
  return d
 }))].sort()
}
