import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'

export const accountLookupSql=(customerId?:string)=>`SELECT 1 FROM companies account WHERE account.project_id=? AND account.id=? AND account.merged_into IS NULL ${customerId?'AND EXISTS(SELECT 1 FROM contact_companies member WHERE member.project_id=account.project_id AND member.company_id=account.id AND member.contact_id=?)':''}`
/** Lookup ids are references, never a claim that the caller owns an account. */
export async function lookupValueGuard(env:Env,projectId:string,definitions:any[],values:Record<string,unknown>,customerId?:string){
 const predicates:string[]=[],params:unknown[]=[]
 for(const [id,value] of Object.entries(values)){
  const field=definitions.find(f=>f.id===id),validation=field?JSON.parse(field.validation_json):{}
  if(validation.lookup!=='account'||value===null||value===undefined||value==='')continue
  const sql=accountLookupSql(customerId),args=[projectId,value,...(customerId?[customerId]:[])]
  if(!await env.DB.prepare(sql).bind(...args).first())throw new HTTPException(422,{message:`${field.name}: Choose an available account`,res:Response.json({error:`${field.name}: Choose an available account`,field:id,code:'unavailable_lookup'},{status:422})})
  predicates.push(`EXISTS(${sql})`);params.push(...args)
 }
 return {sql:predicates.length?predicates.join(' AND '):'1',params}
}
