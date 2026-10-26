import {HTTPException} from 'hono/http-exception'
import {validateFieldValue} from '../tickets/fields'
import {emailAddress} from '../integrations/inbound-routing'
import {reservedLocalId} from '../conversations/admission'
import type {PublicField,PublicForm,Submission} from './types'
export function fieldError(field:string,code:string,error:string):never{throw new HTTPException(422,{message:error,res:Response.json({error,field,code},{status:422})})}
export function visibleField(field:PublicField,values:Record<string,unknown>){
 const c=field.condition;if(!c)return true
 const value=values[c.fieldId]
 if(c.operator==='present')return value!==undefined&&value!==null&&value!==''&&(!Array.isArray(value)||value.length>0)
 if(value===undefined||value===null||value===''||Array.isArray(value)&&value.length===0)return false
 if(c.operator==='includes')return Array.isArray(value)&&value.includes(c.value)
 return c.operator==='equals'?value===c.value:value!==c.value
}
/** Validate every public door before identity or challenge checks, naming the exact field. */
export function validateSubmission(form:PublicForm,body:unknown):Submission{
 if(!body||typeof body!=='object'||Array.isArray(body))fieldError('form','invalid','Expected a submission object')
 const b=body as Record<string,unknown>,fields=b.fields??{}
 if(!fields||typeof fields!=='object'||Array.isArray(fields))fieldError('fields','invalid','Expected field values')
 const values=fields as Record<string,unknown>,known=new Set(form.fields.filter(f=>!['subject','message'].includes(f.id)).map(f=>f.id))
 for(const id of Object.keys(values))if(!known.has(id))fieldError(id,'unknown_field','This field is not available on this form')
 for(const [id,max] of [['subject',500],['message',100000]] as const){const value=b[id],label=form.fields.find(f=>f.id===id)?.label??id;if(typeof value!=='string'||!value.trim())fieldError(id,'required',`${label} is required`);if((value as string).length>max)fieldError(id,'too_long',`Enter at most ${max} characters`)}
 const accepted:Record<string,unknown>=Object.create(null)
 for(const f of form.fields){if(['subject','message'].includes(f.id))continue
  const value=values[f.id]
  if(!visibleField(f,accepted)){if(value!==undefined&&value!==null&&value!=='')fieldError(f.id,'inactive_field','This field is not active for your choices');continue}
  if(f.required&&(value===null||value===undefined||value===''||typeof value==='string'&&!value.trim()||Array.isArray(value)&&!value.length))fieldError(f.id,'required',`${f.label} is required`)
  try{accepted[f.id]=validateFieldValue({name:f.label,type:f.type,required:f.required?1:0,options_json:JSON.stringify(f.options.map(o=>o.value)),validation_json:JSON.stringify(f.validation)},value)}catch(error){fieldError(f.id,'invalid',error instanceof Error?error.message:`Invalid ${f.label}`)}
 }
 const localId=b.localId??crypto.randomUUID();if(typeof localId!=='string'||!localId.trim()||localId.length>200||reservedLocalId(localId))fieldError('localId','invalid','Enter a unique command ID up to 200 characters without a reserved prefix')
 const rawCc=b.cc??[]
 if(!Array.isArray(rawCc)||rawCc.length>50)fieldError('cc','invalid','Enter at most 50 CC addresses')
 const cc:string[]=[]
 for(const raw of rawCc){const email=emailAddress(raw);if(typeof raw!=='string'||!email||raw.trim().toLowerCase()!==email)fieldError('cc','invalid','Enter a valid CC address');if(!cc.includes(email!))cc.push(email!)}
 cc.sort()
 return {cc,subject:(b.subject as string).trim(),message:(b.message as string).trim(),fields:accepted,localId:localId as string}
}
