import {ApiError} from './errors'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {enforceRateLimits} from '../../platform/rate-limits'
import {tokens,verifiedToken,type ApiScope,type TokenAuthority} from '../../platform/integration-authority'
export type ApiEnv={Bindings:AppEnv['Bindings'];Variables:{authority:TokenAuthority}}
export function apiRouter(){const app=new Hono<ApiEnv>();app.onError((e,c)=>{
 if(e instanceof ApiError){for(const [key,value] of Object.entries(e.headers))c.header(key,value);return c.json({error:{code:e.code,message:e.message,...e.details}},e.status)}
 const status=e instanceof HTTPException?e.status:500
 const codes:Record<number,string>={400:'invalid_request',401:'unauthorized',403:'insufficient_scope',404:'not_found',409:'conflict',429:'rate_limited',503:'unavailable'}
 if(status===429&&e instanceof HTTPException){const retry=e.getResponse().headers.get('Retry-After');if(retry)c.header('Retry-After',retry)}
 return c.json({error:{code:codes[status]||'internal_error',message:status===500?'Request failed':e.message||codes[status]||'Request refused'}},status)
 });app.notFound(c=>c.json({error:{code:'not_found',message:'Not found'}},404));return app}
export const requireScope=(scope:ApiScope)=>async(c:any,next:()=>Promise<void>)=>{
 const auth=c.req.header('Authorization'),match=typeof auth==='string'?/^Bearer (int_[a-f0-9]{64})$/.exec(auth):null
 if(!match)throw new HTTPException(401,{message:'Valid bearer token required'})
 const hash=await hashToken(match[1]);const row=await c.env.DB.prepare('SELECT namespace,id,source_product,bindings_json,family_id,create_minute,create_day FROM integration_tokens WHERE token_hash=?').bind(hash).first()
 if(!row)throw new HTTPException(401,{message:'Invalid or expired bearer token'})

 const service=tokens(c.env,row.namespace),context={requestId:crypto.randomUUID(),resource:scope}
 const credential=await service.authorize(match[1],[scope],context)
 if(!credential){const live=await c.env.DB.prepare('SELECT 1 FROM integration_tokens WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').bind(hash,Date.now()).first();throw new HTTPException(live?403:401,{message:live?'Token does not grant this scope':'Invalid or expired bearer token'})}
 const active=await c.env.DB.prepare("SELECT p.id FROM projects p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)").bind(row.namespace).first()
 if(!active)throw new HTTPException(401,{message:'Invalid or expired bearer token'})
 try{await enforceRateLimits(c.env,[['apiRequestsPerTokenMinute',row.id]])}catch(error){if(row.source_product&&error instanceof HTTPException&&error.status===429)throw new ApiError(429,'credential','Credential request quota exceeded',{}, {'Retry-After':error.getResponse().headers.get('Retry-After')??'60','RateLimit-Limit':'120','RateLimit-Remaining':'0','RateLimit-Reset':String((Math.floor(Date.now()/60000)+1)*60)});throw error}
 c.set('authority',verifiedToken(row.namespace,credential.id,scope,JSON.stringify([row.source_product,row.bindings_json,row.family_id,row.create_minute,row.create_day])));c.header('Cache-Control','no-store');await next()
}
export function iso(row:any){if(!row)return row;return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='number'&&/(?:_at|At)$/.test(k)?new Date(v).toISOString():v]))}
export function page(query:Record<string,string>,binding:unknown){
 const size=query.limit===undefined?50:Number(query.limit);if(!Number.isInteger(size)||size<1||size>100)throw new HTTPException(400,{message:'Limit must be between 1 and 100'})
 let cursor:any=null;if(query.cursor){try{cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(query.cursor),c=>c.charCodeAt(0))));if(JSON.stringify(cursor.binding)!==JSON.stringify(binding)||!Number.isSafeInteger(cursor.time)||typeof cursor.id!=='string'||cursor.id.length>200)throw Error()}catch{throw new HTTPException(400,{message:'Invalid cursor'})}}
 return {size,cursor,finish:(rows:any[],column:string)=>{const more=rows.length>size,data=rows.slice(0,size),last=data.at(-1);return {data:data.map(iso),next_cursor:more?btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({binding,time:last[column],id:last.id})))):null}}}

}
export async function jsonBody(c:any){
 try{const body=await c.req.json();if(!body||typeof body!=='object'||Array.isArray(body))throw Error();return body}catch{throw new HTTPException(400,{message:'JSON object required'})}
}
