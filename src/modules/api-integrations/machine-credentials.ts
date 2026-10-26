import {credentialById} from './credentials'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {tokens,credentialScopes,type Issuer} from '../../platform/integration-authority'
export function machineInput(body:any){
 if(body.source_product==null)throw new HTTPException(400,{message:'A source product label is required'})
 credentialScopes(body.scopes,body.source_product)
 const bindings=body.bindings??{}
 if(!bindings||Array.isArray(bindings)||typeof bindings!=='object')throw new HTTPException(400,{message:'Bindings must be an object'})
 for(const [key,value] of Object.entries(bindings))if(!['brands','mailboxes','groups','forms','priorities','tags','credentials'].includes(key)||!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||!v||v.length>200))throw new HTTPException(400,{message:'Invalid credential binding'})
 const minute=body.create_per_minute??20,day=body.create_per_day??1000
 if(!Number.isInteger(minute)||minute<1||minute>60||!Number.isInteger(day)||day<1||day>10000)throw new HTTPException(400,{message:'Create quota exceeds installation ceiling'})
 const reach=Object.fromEntries(Object.entries(bindings).filter(([key])=>!['priorities','tags'].includes(key))),values=Object.fromEntries(Object.entries(bindings).filter(([key])=>['priorities','tags'].includes(key)))
 return {source:body.source_product,reach:JSON.stringify(reach),values:JSON.stringify(values),minute,day}
}
export async function rotateMachine(env:Env,who:Issuer,id:string,body:any){
 if(Object.keys(body).some(key=>key!=='overlap_seconds'))throw new HTTPException(400,{message:'Rotation only accepts an overlap interval'})
 const old=await credentialById(env,who.actor.projectId,id)
 if(!old)throw new HTTPException(404)
 if(old.revoked_at!==null||old.expires_at!==null&&old.expires_at<=Date.now())throw new HTTPException(409,{message:'Credential is expired or revoked'})
 credentialScopes(JSON.parse(old.scopes),old.source_product)
 const overlap=body.overlap_seconds??0
 if(!Number.isInteger(overlap)||overlap<0||overlap>604800)throw new HTTPException(400,{message:'Overlap must be between zero and seven days'})
 try{const result=await tokens(env,who.actor.projectId,{rotate:{id:old.id,overlap:overlap*1000,revision:old.policy_revision}}).issue(who,{name:old.name,scopes:JSON.parse(old.scopes),...(old.expires_at?{expiresAt:old.expires_at}:{})})
 return {...result,credential:{...result.credential,credential_id:old.id}}
 }catch(error){const current=await credentialById(env,who.actor.projectId,old.id);if(!current||current.policy_revision!==old.policy_revision||current.revoked_at!==null||current.expires_at!==null&&current.expires_at<=Date.now())throw new HTTPException(409,{message:'Credential changed; reload before rotating'});throw error}
}
