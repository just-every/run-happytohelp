import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'

export const rerMail=(env:Env)=>env.MAIL_PROVIDER==='rer'
export const maxMailBytes=24*1024*1024
export const canonical=(value:unknown):string=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(item=>JSON.parse(canonical(item))):Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,JSON.parse(canonical(item))])):value)
export async function rawDigest(raw:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',Uint8Array.from(raw).buffer))].map(v=>v.toString(16).padStart(2,'0')).join('')}
export async function boundedMailBody(stream:ReadableStream<Uint8Array>|null,limit=maxMailBytes){
 const reader=stream?.getReader(),chunks:Uint8Array[]=[];let size=0
 if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new HTTPException(413,{message:'Email exceeds the size limit'})}chunks.push(value)}}finally{reader.releaseLock()}
 const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length}return raw
}
/** Authority is sent only to the configured HTTPS service, never through a redirect. */
export function mailService(value:unknown){
 let url:URL
 try{url=new URL(String(value))}catch{throw new HTTPException(503,{message:'Managed email service is unavailable'})}
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)throw new HTTPException(503,{message:'Managed email service is unavailable'})
 return url
}
export async function mailJson(response:Response){
 const bytes=await boundedMailBody(response.body,64*1024)
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes))}catch{throw new HTTPException(503,{message:'Managed email service returned an unknown outcome'})}
}
export interface ManagedMailbox {project_id:string;allocation_key:string;mailbox_id:string|null;address:string|null;generation:number;state:string;configured:number;route_active:number;last_inbound_at:number|null;last_outbound_at:number|null;error:string|null;updated_at:number;route_checked_at:number|null;route_check_next_at:number;route_check_failures:number;route_check_error:string|null}
export const liveWorkspace=`NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=rer_mailboxes.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`
export function managedMailbox(env:Env,projectId?:string){return env.DB.prepare(`SELECT * FROM rer_mailboxes WHERE ${projectId?'project_id=?':"allocation_key='default'"} AND state<>'revoked' AND ${liveWorkspace}`).bind(...projectId?[projectId]:[]).first<ManagedMailbox>()}
