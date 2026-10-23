import {HTTPException} from 'hono/http-exception'
import {invalid,named,object,fieldAllowed} from './model'
import type {MemberAccess} from '../access/gate'
export const fieldTypes=['text','number','decimal','date','dropdown','multiselect','checkbox','regex'] as const
export function checkedPattern(value:unknown){if(typeof value!=='string'||!value||value.length>200||/[()|]/.test(value)||/\\[1-9]/.test(value))invalid('Pattern must be at most 200 characters without groups, alternatives or backreferences');const operators=value.replace(/\[(?:\\.|[^\]\\])*\]/g,'X').replace(/\\./g,'X');if((operators.match(/[*+?]|\{\d+,/g)??[]).length>1)invalid('Pattern may have at most one variable-length repetition');try{return new RegExp(value,'u')}catch{invalid('Invalid field pattern')}}
export function fieldDefinition(body:unknown){
 const b=object(body),name=named(b.name),type=b.type==='account_lookup'?'text':b.type
 if(!fieldTypes.includes(type))invalid('Unknown custom field type')
 if(b.required!==undefined&&typeof b.required!=='boolean')invalid('Required must be boolean')
 const options=b.type==='account_lookup'?[]:b.options??[],validation:Record<string,any>={...object(b.validation??{}),...(b.type==='account_lookup'?{lookup:'account'}:{})},read=b.read_roles??[],write=b.write_roles??[]
 if(!Array.isArray(options)||options.length>100||options.some(x=>typeof x!=='string'||!x.trim()||x.length>120)||new Set(options).size!==options.length)invalid('Field options must be unique text values')
 if(['dropdown','multiselect'].includes(type)&&!options.length)invalid('Choice fields need options')
 for(const roles of [read,write])if(!Array.isArray(roles)||roles.length>100||roles.some(x=>typeof x!=='string'||!x||x.length>200))invalid('Field roles must be role IDs')
 if(Object.keys(validation).some(k=>!['min','max','pattern','lookup'].includes(k)))invalid('Unknown field validation')
 if(validation.lookup!==undefined&&(validation.lookup!=='account'||type!=='text'))invalid('Lookup fields must reference a workspace account')
 for(const key of ['min','max'])if(validation[key]!==undefined&&(typeof validation[key]!=='number'||!Number.isFinite(validation[key])))invalid('Bounds must be finite numbers')
 if(validation.min!==undefined&&validation.max!==undefined&&validation.min>validation.max)invalid('Minimum exceeds maximum')
 if(type==='regex'&&!validation.pattern)invalid('Regex fields require a pattern')
 if(validation.pattern!==undefined)checkedPattern(validation.pattern)
 return {name,type,required:b.required?1:0,options_json:JSON.stringify(options),validation_json:JSON.stringify(validation),read_roles_json:JSON.stringify([...new Set(read)]),write_roles_json:JSON.stringify([...new Set(write)])}
}
export function validateFieldValue(field:any,value:unknown){
 const bad=(message:string):never=>invalid(`${field.name}: ${message}`)
 if(value===null||value===undefined||value===''){if(field.required)bad('Required');return null}
 const v=JSON.parse(field.validation_json),options=JSON.parse(field.options_json)
 switch(field.type){
  case 'text':case 'regex':if(typeof value!=='string'||value.length>4000)bad('Enter text up to 4000 characters');if(v.min!==undefined&&(value as string).length<v.min||v.max!==undefined&&(value as string).length>v.max)bad('Text length outside allowed range');if(v.pattern&&!checkedPattern(v.pattern).test(value as string))bad('Value does not match the required pattern');break
  case 'number':case 'decimal':if(typeof value!=='number'||!Number.isFinite(value)||field.type==='number'&&!Number.isSafeInteger(value))bad(field.type==='number'?'Enter a whole number':'Enter a decimal number');if(v.min!==undefined&&(value as number)<v.min||v.max!==undefined&&(value as number)>v.max)bad('Number outside allowed range');break
  case 'checkbox':if(typeof value!=='boolean')bad('Enter true or false');break
  case 'date':if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value)bad('Enter a valid YYYY-MM-DD date');break
  case 'dropdown':if(typeof value!=='string'||!options.includes(value))bad('Choose an available option');break
  case 'multiselect':if(!Array.isArray(value)||value.length>100||value.some(x=>typeof x!=='string'||!options.includes(x))||new Set(value).size!==value.length)bad('Choose unique available options');if(field.required&&!(value as unknown[]).length)bad('Required');break
  default:bad('Unknown field type')
 }
 return value
}
export function validateFieldChanges(fields:any[],values:Record<string,unknown>,change:Record<string,unknown>,access:MemberAccess|null){
 const changes:Record<string,unknown>={}
 for(const [id,value] of Object.entries(change)){
  const field=fields.find(f=>f.id===id)
  if(!field)invalid(`Unknown field: ${id}`)
  if(!fieldAllowed(field,access)||!fieldAllowed(field,access,true))throw new HTTPException(403,{message:'This field is not writable by your role'})
  changes[id]=validateFieldValue(field,value)
 }
 return changes
}
const empty=(value:unknown)=>value===null||value===undefined||value===''||Array.isArray(value)&&!value.length
/** Required fields are required to solve: a change into solved or closed needs a value in
 * every required field the actor may write. Returns the fields whose stored value the
 * write must still find, so a value removed concurrently cannot slip through. */
export function requiredToSolve(fields:any[],values:Record<string,unknown>,changes:Record<string,unknown>,access:MemberAccess|null){
 const stored:string[]=[]
 for(const field of fields){
  if(!field.required||!fieldAllowed(field,access)||!fieldAllowed(field,access,true))continue
  if(empty(field.id in changes?changes[field.id]:values[field.id]))invalid(`${field.name}: Required to solve`)
  if(!(field.id in changes))stored.push(field.id)
 }
 return stored
}
export const solving=(from:string,to:string)=>from!==to&&['solved','closed'].includes(to)
