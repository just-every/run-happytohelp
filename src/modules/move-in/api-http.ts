import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {Vendor} from './types'
import type {ApiClient} from './readers/api/types'
export interface VendorCredential {token:string;email?:string;docsToken?:string}
export class VendorError extends Error {constructor(message:string,public status=502,public retryAt:number|null=null){super(message)}}
const names={zendesk:'Zendesk',intercom:'Intercom',helpscout:'Help Scout',freshdesk:'Freshdesk'}
export function providerBase(env:Env,vendor:Vendor,domain?:unknown){
 const configured=env[`MOVE_IN_${vendor.toUpperCase()}_BASE_URL`]
 let base:string
 if(typeof configured==='string')base=configured
 else if(vendor==='intercom')base='https://api.intercom.io'
 else if(vendor==='helpscout')base='https://api.helpscout.net'
 else {if(typeof domain!=='string'||!/^[a-z0-9][a-z0-9-]{0,62}(?:\.(?:zendesk|freshdesk)\.com)?$/i.test(domain))throw new HTTPException(400,{message:`Enter your ${names[vendor]} subdomain`});if(domain.includes('.')&&!domain.toLowerCase().endsWith(`.${vendor}.com`))throw new HTTPException(400,{message:`Enter your ${names[vendor]} domain`});base=`https://${domain.includes('.')?domain:`${domain}.${vendor}.com`}`}
 const url=new URL(base)
 if(url.username||url.password||url.search||url.hash||!(url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new HTTPException(400,{message:'The provider base URL must use HTTPS (or a local development server)'})
 return url.href.replace(/\/$/,'')
}
export function credentials(vendor:Vendor,body:any):VendorCredential {
 const value=(input:unknown,label:string)=>{if(typeof input!=='string'||!input.trim()||input.length>4096||/[\r\n\0]/.test(input))throw new HTTPException(400,{message:`Enter ${label}`});return input.trim()}
 return {token:value(body.token,vendor==='freshdesk'?'your Freshdesk API key':'your API access token'),...(vendor==='zendesk'?{email:value(body.email,'your Zendesk administrator email')}:{}),...(vendor==='helpscout'?{docsToken:value(body.docsToken,'your Help Scout Docs API key to include articles')}:{})}
}
export async function readBounded(response:Response,limit:number){
 const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0
 if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new VendorError('Provider response exceeds the import size limit')}
 if(reader)try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw new VendorError('Provider response exceeds the import size limit')}chunks.push(next.value)}}finally{reader.releaseLock()}
 const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length}return result
}
/** Redirects never inherit authorization. A saved cursor cannot select a different origin. */
export function vendorHttp(env:Env,vendor:Vendor,base:string,credential:VendorCredential):ApiClient & {attachment(url:string):Promise<{bytes:Uint8Array;contentType:string}>} {
 const origin=new URL(base),docsBase=typeof env.MOVE_IN_HELPSCOUT_DOCS_BASE_URL==='string'?env.MOVE_IN_HELPSCOUT_DOCS_BASE_URL:'https://docsapi.helpscout.net'
 const locate=(path:string)=>{const requested=new URL(path,base+'/');if(requested.username||requested.password)throw new VendorError('Provider URL contains credentials');if(requested.origin===origin.origin)return requested
  if(vendor==='helpscout'&&['api.helpscout.net','docsapi.helpscout.net'].includes(requested.hostname)){const target=new URL(requested.hostname==='api.helpscout.net'?base:docsBase);return new URL(requested.pathname+requested.search,target)}
  throw new VendorError('Provider pagination changed to an unapproved host')}
 const headers=(docs:boolean)=>{const h=new Headers({Accept:'application/json'});h.set('Authorization',vendor==='zendesk'?`Basic ${btoa(`${credential.email}/token:${credential.token}`)}`:vendor==='freshdesk'?`Basic ${btoa(`${credential.token}:X`)}`:docs?`Basic ${btoa(`${credential.docsToken}:X`)}`:`Bearer ${credential.token}`);if(vendor==='intercom')h.set('Intercom-Version','2.16');return h}
 const redirects=new Set([301,302,303,307,308])
 const checked=async(url:URL,init:RequestInit={},allowRedirect=false)=>{
  let response:Response;try{response=await fetch(url,{...init,redirect:'manual',signal:AbortSignal.timeout(30000)})}catch{throw new VendorError(`${names[vendor]} could not be reached. Check the connection and resume.`)}
  if(response.status===401)throw new VendorError(`${names[vendor]} rejected this token. Check the token and account.`,401)
  if(response.status===403)throw new VendorError(`${names[vendor]} denied access: this token is missing permission for ${url.pathname}. Grant read access and reconnect.`,403)
  if(response.status===429){const raw=response.headers.get('Retry-After'),seconds=raw&&/^\d+$/.test(raw)?Number(raw)*1000:raw?Date.parse(raw)-Date.now():60000,retryAt=Date.now()+Math.max(1000,Math.min(seconds||60000,86400000));await response.body?.cancel();throw new VendorError(`${names[vendor]} rate limit reached. Try again after ${new Date(retryAt).toISOString()} (Retry-After).`,429,retryAt)}
  if(allowRedirect&&redirects.has(response.status))return response
  if(!response.ok){await response.body?.cancel();throw new VendorError(`${names[vendor]} returned HTTP ${response.status} for ${url.pathname}. The checkpoint was kept.`,response.status===404?404:502)}return response
 }
 const json=async(path:string,body?:unknown,maxBytes=2*1024*1024)=>{const url=locate(path),docs=vendor==='helpscout'&&new URL(path,base+'/').hostname==='docsapi.helpscout.net';const h=headers(docs);if(body!==undefined)h.set('Content-Type','application/json');const response=await checked(url,{method:body===undefined?'GET':'POST',headers:h,...(body!==undefined?{body:JSON.stringify(body)}:{})});const bytes=await readBounded(response,maxBytes);try{return JSON.parse(new TextDecoder().decode(bytes))}catch{throw new VendorError(`${names[vendor]} returned an unreadable response. The checkpoint was kept.`)}}
 return {get:(path,options)=>json(path,undefined,options?.maxBytes),post:(path,body)=>json(path,body),async attachment(path){
  const allowed:Record<Vendor,string[]>={zendesk:['zendesk.com','zdusercontent.com','zendeskusercontent.com','zdassets.com','amazonaws.com'],intercom:['intercomcdn.com','intercomassets.com','intercom.io'],helpscout:['helpscout.net'],freshdesk:['freshdesk.com','freshworks.com','freshdesk-attachments.com','amazonaws.com']}
  const candidate=new URL(path,base+'/');let url=vendor==='helpscout'&&candidate.hostname==='api.helpscout.net'?locate(path):candidate
  for(let hop=0;hop<4;hop++){
   if(url.username||url.password||!(url.protocol==='https:'||url.origin===origin.origin&&url.protocol==='http:'))throw new VendorError('Attachment URL must use HTTPS')
   if(url.origin!==origin.origin&&(/^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)||url.hostname.includes(':')))throw new VendorError('Attachment host is private')
   if(url.origin!==origin.origin&&!allowed[vendor].some(host=>url.hostname===host||url.hostname.endsWith('.'+host)))throw new VendorError('Attachment host is not a documented provider download host')
   // Each hop is validated again; credentials go only to the source API origin.
   const response=await checked(url,{headers:url.origin===origin.origin?headers(false):new Headers()},true)
   if(!redirects.has(response.status))return {bytes:await readBounded(response,20_000_000),contentType:response.headers.get('content-type')||'application/octet-stream'}
   const location=response.headers.get('Location');await response.body?.cancel()
   if(!location)throw new VendorError('Attachment redirect has no download URL')
   url=new URL(location,url)
  }
  throw new VendorError('Attachment download exceeded the redirect limit')
 }}
}
export async function probe(vendor:Vendor,client:ApiClient){await client.get(vendor==='zendesk'?'/api/v2/users.json?page[size]=1':vendor==='intercom'?'/admins':vendor==='helpscout'?'/v2/users?page=1':'/api/v2/agents?per_page=1&page=1')}
