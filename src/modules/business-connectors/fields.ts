import {HTTPException} from 'hono/http-exception'
const property=/^[A-Za-z_][A-Za-z0-9_]{0,79}$/
const protectedField=/^(id|accountid|contactid|email|isdeleted|createddate|lastmodifieddate|systemmodstamp|hs_object_id)$|password|secret|token|card|socialsecurity|ssn/i
export function connectionFields(input:unknown){
 if(input==null)return {}
 if(typeof input!=='object'||Array.isArray(input))throw new HTTPException(400,{message:'Use explicit CRM property mappings'})
 const result:Record<string,string|string[]>={}
 for(const [key,value] of Object.entries(input)){
  if(['plan','entitlement','account_plan','account_entitlement'].includes(key)){
   if(typeof value!=='string'||!property.test(value))throw new HTTPException(400,{message:'Use a CRM property API name'})
   result[key]=value
  }else if(['editable_contact','editable_account'].includes(key)){
   if(!Array.isArray(value)||value.length>20||value.some(x=>typeof x!=='string'||!property.test(x)||protectedField.test(x)))throw new HTTPException(400,{message:'Choose up to twenty non-identity CRM fields per object'})
   result[key]=[...new Set(value)].sort()
  }else throw new HTTPException(400,{message:'Unknown CRM property mapping'})
 }
 return result
}
