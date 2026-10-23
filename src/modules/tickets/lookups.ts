import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'

/** One JSON binding keeps a 50-field form within D1's parameter and statement
 * limits. Lookup ids are references, never a claim that a caller owns an account. */
export async function lookupValueGuard(env:Env,projectId:string,definitions:any[],values:Record<string,unknown>,customerId?:string){
 const refs=Object.entries(values).flatMap(([id,value])=>{
  const field=definitions.find(f=>f.id===id)
  return field&&JSON.parse(field.validation_json).lookup==='account'&&value!==null&&value!==undefined&&value!==''?[{id,name:field.name,value}]:[]
 })
 if(!refs.length)return {sql:'1',params:[] as unknown[]}
 const unavailable=`NOT EXISTS(SELECT 1 FROM companies account WHERE account.project_id=? AND account.id=json_extract(ref.value,'$.value') AND account.merged_into IS NULL ${customerId?'AND EXISTS(SELECT 1 FROM contact_companies member WHERE member.project_id=account.project_id AND member.company_id=account.id AND member.contact_id=?)':''})`,params=[JSON.stringify(refs),projectId,...(customerId?[customerId]:[])]
 const refused=await env.DB.prepare(`SELECT json_extract(ref.value,'$.id') id,json_extract(ref.value,'$.name') name FROM json_each(?) ref WHERE ${unavailable} LIMIT 1`).bind(...params).first<{id:string;name:string}>()
 if(refused)throw new HTTPException(422,{message:`${refused.name}: Choose an available account`,res:Response.json({error:`${refused.name}: Choose an available account`,field:refused.id,code:'unavailable_lookup'},{status:422})})
 return {sql:`NOT EXISTS(SELECT 1 FROM json_each(?) ref WHERE ${unavailable})`,params}
}
