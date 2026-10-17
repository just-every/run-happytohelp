import {HTTPException} from 'hono/http-exception'
export const MIME_LIMIT=24*1024*1024
const hosts=new Set(['oauth2.googleapis.com','gmail.googleapis.com','login.microsoftonline.com','graph.microsoft.com'])
export class MailboxProviderError extends Error {
 status:number
 constructor(status:number){super(`Mailbox provider HTTP ${status}`);this.status=status}
}
/** All provider URLs, including Graph's opaque paging links, pass this gate. */
export function providerUrl(value:string){
 const u=new URL(value)
 if(u.protocol!=='https:'||!hosts.has(u.hostname)||u.port||u.username||u.password||u.hash)throw new HTTPException(502,{message:'Invalid mailbox provider URL'})
 return u
}
export function graphPageUrl(value:string){
 const u=providerUrl(value)
 // Graph's documented nextLink may use lowercase mailfolders('opaque-id')
 // rather than the slash form used by the initial request. Both remain confined
 // to this user's folder message delta API on the fixed Graph host.
 if(u.hostname!=='graph.microsoft.com'||!/^\/v1\.0\/me\/mailfolders(?:\/[^/]+|\('[^']+'\))\/messages\/delta$/i.test(u.pathname))throw new HTTPException(502,{message:'Invalid mailbox cursor'})
 return u.href
}
export async function providerBytes(url:string,init:RequestInit={},limit=MIME_LIMIT):Promise<{bytes:Uint8Array;status:number}>{
 providerUrl(url)
 if(typeof init.body==='string'&&new TextEncoder().encode(init.body).length>36*1024*1024)throw new HTTPException(413)
 const response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(20000)})
 if(!response.ok){await response.body?.cancel();throw new MailboxProviderError(response.status)}
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new HTTPException(502,{message:'Mailbox response exceeds size limit'})}
 const reader=response.body?.getReader(),parts:Uint8Array[]=[];let length=0
 if(reader)try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit)throw new HTTPException(502,{message:'Mailbox response exceeds size limit'});parts.push(value)}}finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length}
 return {bytes,status:response.status}
}
export async function providerJson<T=any>(url:string,init:RequestInit={},limit=2*1024*1024):Promise<T>{
 const {bytes}=await providerBytes(url,init,limit)
 try{return JSON.parse(new TextDecoder().decode(bytes)) as T}catch{throw new HTTPException(502,{message:'Invalid mailbox provider response'})}
}
export const bearer=(token:string)=>({Authorization:`Bearer ${token}`})
export function base64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s)}
export function unbase64(value:string){return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))}
export const base64url=(bytes:Uint8Array)=>base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
