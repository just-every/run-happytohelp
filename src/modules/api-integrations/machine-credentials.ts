import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {tokens,type Issuer} from '../../platform/integration-authority'
export function machineInput(body:any){
 if(typeof body.source_product!=='string'||! /^[a-z][a-z0-9_-]{0,63}$/.test(body.source_product))throw new HTTPException(400,{message:'A source product label is required'})
 const bindings=body.bindings??{}
 if(!bindings||Array.isArray(bindings)||typeof bindings!=='object')throw new HTTPException(400,{message:'Bindings must be an object'})
 for(const [key,value] of Object.entries(bindings))if(!['brands','mailboxes','groups','forms','priorities','tags','credentials'].includes(key)||!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||!v||v.length>200))throw new HTTPException(400,{message:'Invalid credential binding'})
 const minute=body.create_per_minute??20,day=body.create_per_day??1000
 if(!Number.isInteger(minute)||minute<1||minute>60||!Number.isInteger(day)||day<1||day>10000)throw new HTTPException(400,{message:'Create quota exceeds installation ceiling'})
 return {source:body.source_product,bindings:JSON.stringify(bindings),minute,day}
}
export async function rotateMachine(env:Env,who:Issuer,id:string,body:any){
 const old=await env.DB.prepare('SELECT * FROM integration_tokens WHERE namespace=? AND id=? AND revoked_at IS NULL AND source_product IS NOT NULL').bind(who.actor.projectId,id).first<any>()
 if(!old)throw new HTTPException(404)
 const overlap=body.overlap_seconds??0
 if(!Number.isInteger(overlap)||overlap<0||overlap>604800)throw new HTTPException(400,{message:'Overlap must be between zero and seven days'})
 try{return await tokens(env,who.actor.projectId,{source:old.source_product,bindings:old.bindings_json,minute:old.create_minute,day:old.create_day,family:old.family_id,rotate:{id,overlap:overlap*1000,expires:old.expires_at,policy:JSON.stringify([old.scopes,old.bindings_json,old.create_minute,old.create_day])}}).issue(who,{name:old.name,scopes:JSON.parse(old.scopes),...(old.expires_at?{expiresAt:old.expires_at}:{})})}catch(error){
  const current=await env.DB.prepare('SELECT * FROM integration_tokens WHERE namespace=? AND id=?').bind(who.actor.projectId,id).first<any>()
  if(!current||current.revoked_at!==null||current.expires_at!==old.expires_at||current.scopes!==old.scopes||current.bindings_json!==old.bindings_json||current.create_minute!==old.create_minute||current.create_day!==old.create_day)throw new HTTPException(409,{message:'Credential changed; reload before rotating'})
  throw error
 }
}
