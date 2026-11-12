import type {Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../../platform/env'
import {b64url,fromB64url} from '../two-factor/webauthn'
import {hashToken} from '../../../platform/auth'
export type RecoveryContext=Context<AppEnv>
export const random=()=>b64url(crypto.getRandomValues(new Uint8Array(32)))
export const digest=async(secret:string)=>b64url(new Uint8Array(await crypto.subtle.digest('SHA-256',fromB64url(secret))))
export const isRandom=(value:unknown):value is string=>typeof value==='string'&&/^[\w-]{43}$/.test(value)&&b64url(fromB64url(value))===value
export const refuse=(status:400|401|403|409|429|503=403,code='recovery_refused'):never=>{throw new HTTPException(status,{res:Response.json({error:code==='installation_owner_binding_required'?'This installation needs its original owner binding before recovery is available.':'Recovery is unavailable or the proof was not accepted. Restart recovery or use a surviving factor.',code},{status,headers:{'Cache-Control':'no-store',...(status===429?{'Retry-After':'3600'}:{})}})})}
export function browserOrigin(c:RecoveryContext){
 const origin=new URL(c.req.url).origin
 if(c.req.header('Origin')&&c.req.header('Origin')!==origin||c.req.header('Sec-Fetch-Site')==='cross-site')refuse()
 if(c.env.APP_ORIGIN&&c.env.APP_ORIGIN!==origin)refuse()
}
export async function json(c:RecoveryContext){
 const length=Number(c.req.header('Content-Length')||0);if(length>8192)refuse(400)
 const reader=c.req.raw.body?.getReader();if(!reader)refuse(400)
 const chunks:Uint8Array[]=[];let size=0
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();refuse(400)}chunks.push(value)}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
 try{
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
  // Track each object's field names without confusing quoted braces or values.
  const stack:(Set<string>|null)[]=[]
  for(let i=0;i<text.length;i++){
   const ch=text[i]
   if(ch==='{'||ch==='[')stack.push(ch==='{'?new Set():null)
   else if(ch==='}'||ch===']')stack.pop()
   else if(ch==='"'){
    let end=i+1;while(end<text.length){if(text[end]==='\\'){end+=2;continue}if(text[end]==='"')break;end++}
    let next=end+1;while(/\s/.test(text[next]||'!'))next++
    if(text[next]===':'){const key=JSON.parse(text.slice(i,end+1)),keys=stack.at(-1);if(!keys||keys.has(key))refuse(400);keys.add(key)}
    i=end
   }
  }
  return JSON.parse(text)
 }catch{refuse(400)}
}
export function keyValue(env:Env){const key=typeof env.H2H_OWNER_RECOVERY_KEY==='string'?env.H2H_OWNER_RECOVERY_KEY.trim():'';if(key.length<32)refuse(503);return key}
export const keyHash=(env:Env)=>hashToken(`owner-recovery-key:${keyValue(env)}`)
export function generation(env:Env){const value=Number(env.H2H_OWNER_RECOVERY_GENERATION??0);if(!Number.isSafeInteger(value)||value<0)refuse(503);return value}
export interface Predicate {sql:string;args:unknown[]}
export function assertion(db:D1Database,predicate:Predicate){return db.prepare(`INSERT INTO identity_recovery_assertions(ok) SELECT CASE WHEN (${predicate.sql}) THEN 1 ELSE 0 END`).bind(...predicate.args)}
export async function guarded(db:D1Database,predicate:Predicate,statements:D1PreparedStatement[]){
 try{return await db.batch([assertion(db,predicate),...statements,db.prepare('DELETE FROM identity_recovery_assertions')])}
 catch(error){if(String(error).includes('CHECK constraint failed: ok=1'))refuse(409);throw error}
}
