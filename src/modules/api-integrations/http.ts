import {conversationReach} from './reach'
import {ApiError} from './errors'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {rateLimits} from '../../platform/limit-config'
import {enforceRateLimits} from '../../platform/rate-limits'
import {tokens,verifiedToken,type ApiScope,type TokenAuthority} from '../../platform/integration-authority'
export type ApiEnv={Bindings:AppEnv['Bindings'];Variables:{authority:TokenAuthority;tokenScopes:string[]}}
export function apiRouter(){const app=new Hono<ApiEnv>();app.onError((e,c)=>{
 if(e instanceof ApiError){for(const [key,value] of Object.entries(e.headers))c.header(key,value);return c.json({error:{code:e.code,message:e.message,...e.details}},e.status)}
 const status=e instanceof HTTPException?e.status:500
 const codes:Record<number,string>={400:'invalid_request',401:'unauthorized',403:'insufficient_scope',404:'not_found',409:'conflict',429:'rate_limited',503:'unavailable'}
 if(status===429&&e instanceof HTTPException){const retry=e.getResponse().headers.get('Retry-After');if(retry)c.header('Retry-After',retry)}
 return c.json({error:{code:codes[status]||'internal_error',message:status===500?'Request failed':e.message||codes[status]||'Request refused'}},status)
 });app.notFound(c=>c.json({error:{code:'not_found',message:'Not found'}},404));return app}
export const requireBearer=(scope?:ApiScope)=>async(c:any,next:()=>Promise<void>)=>{
 const auth=c.req.header('Authorization'),match=typeof auth==='string'?/^Bearer (int_[a-f0-9]{64})$/.exec(auth):null
 if(!match)throw new HTTPException(401,{message:'Valid bearer token required'})
 const hash=await hashToken(match[1]);const row=await c.env.DB.prepare('SELECT t.namespace,t.id,t.credential_id,c.policy_revision,c.source_product,t.revoked_at,t.expires_at,c.revoked_at credential_revoked,c.expires_at credential_expires FROM integration_tokens t JOIN api_credentials c ON c.namespace=t.namespace AND c.id=t.credential_id WHERE t.token_hash=?').bind(hash).first()
 if(row&&row.credential_revoked===null&&row.credential_expires!==null&&Number(row.credential_expires)<=Date.now())await c.env.DB.prepare("INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES(?,?,?,'access','credential.expired','succeeded','api',?,'api','credential',?,'{}')").bind('api:expired:'+row.namespace+':'+row.credential_id+':'+row.credential_expires,row.namespace,Date.now(),row.credential_id,row.credential_id).run()
 if(!row||row.credential_revoked!==null||row.credential_expires!==null&&Number(row.credential_expires)<=Date.now()||row.revoked_at!==null||row.expires_at!==null&&Number(row.expires_at)<=Date.now())throw new HTTPException(401,{message:'Invalid or expired bearer token'})

 const active=await c.env.DB.prepare("SELECT p.id FROM projects p WHERE p.id=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=p.id AND (json_extract(s.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(s.settings_json,'$.suspended_at') IS NOT NULL))").bind(row.namespace).first()
 if(!active)throw new HTTPException(401,{message:'Invalid or expired bearer token'})
 const denied=()=>c.env.DB.prepare('INSERT INTO integration_token_usage(namespace,id,token_id,at,required_scopes,request_id,resource,allowed) VALUES(?,?,?,?,?,?,?,0)').bind(row.namespace,crypto.randomUUID(),row.id,Date.now(),JSON.stringify(scope?[scope]:[]),crypto.randomUUID(),scope||'mcp').run()
 try{await enforceRateLimits(c.env,[['apiRequestsPerTokenMinute',row.credential_id]])}catch(error){await denied();if(row.source_product&&error instanceof HTTPException&&error.status===429)throw new ApiError(429,'credential','Credential request quota exceeded',{}, {'Retry-After':error.getResponse().headers.get('Retry-After')??'60','RateLimit-Limit':String(rateLimits(c.env).apiRequestsPerTokenMinute),'RateLimit-Remaining':'0','RateLimit-Reset':String((Math.floor(Date.now()/60000)+1)*60)});throw error}
 const conversationId=c.req.param('id')
 if(conversationId&&c.req.path.includes('/conversations/')&&!await c.env.DB.prepare(`SELECT 1 FROM conversations c WHERE c.project_id=? AND c.id=? AND ${conversationReach()}`).bind(row.namespace,conversationId,row.credential_id).first()){await denied();throw new ApiError(404,'not_found')}
 const service=tokens(c.env,row.namespace),context={requestId:crypto.randomUUID(),resource:scope||'mcp'}
 const credential=await service.authorize(match[1],scope?[scope]:[],context)
 if(!credential){const live=await c.env.DB.prepare('SELECT 1 FROM integration_tokens WHERE token_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)').bind(hash,Date.now()).first();throw new HTTPException(live?403:401,{message:live?'Token does not grant this scope':'Invalid or expired bearer token'})}
 c.set('tokenScopes',credential.scopes);if(scope)c.set('authority',verifiedToken(row.namespace,credential.id,scope,row.credential_id,row.policy_revision,c.req.path.includes('/conversations/')?conversationId:undefined));c.header('Cache-Control','no-store');await next()
}
export const requireScope=(scope:ApiScope)=>requireBearer(scope)
export function iso(row:any){if(!row)return row;return Object.fromEntries(Object.entries(row).map(([k,v])=>[k,typeof v==='number'&&/(?:_at|At)$/.test(k)?new Date(v).toISOString():v]))}
export function page(query:Record<string,string>,binding:unknown){
 const size=query.limit===undefined?50:Number(query.limit);if(!Number.isInteger(size)||size<1||size>100)throw new HTTPException(400,{message:'Limit must be between 1 and 100'})
 let cursor:any=null;if(query.cursor){try{cursor=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(query.cursor),c=>c.charCodeAt(0))));if(JSON.stringify(cursor.binding)!==JSON.stringify(binding)||!Number.isSafeInteger(cursor.time)||typeof cursor.id!=='string'||cursor.id.length>200)throw Error()}catch{throw new HTTPException(400,{message:'Invalid cursor'})}}
 return {size,cursor,finish:(rows:any[],column:string)=>{const more=rows.length>size,data=rows.slice(0,size),last=data.at(-1);return {data:data.map(iso),next_cursor:more?btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify({binding,time:last[column],id:last.id})))):null}}}

}
export async function readBody(c:any,limit=200000,json=true){
 if(json&&!/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type')??''))throw new ApiError(415,'unsupported_media_type')
 if(Number(c.req.header('Content-Length'))>limit)throw new ApiError(413,'payload_too_large')
 const reader=c.req.raw.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new ApiError(413,'payload_too_large');chunks.push(value)}}finally{await reader?.cancel()}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return bytes
}
export async function jsonBody(c:any,limits:Record<string,number>={content:100000,body:100000,subject:500}){
 const bytes=await readBody(c)
 let body:any
 try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error()}catch{throw new ApiError(400,'invalid_request','JSON object required')}
 for(const [field,max] of Object.entries(limits))if(typeof body[field]==='string'&&body[field].length>max)throw new ApiError(413,'payload_too_large')
 return body
}
