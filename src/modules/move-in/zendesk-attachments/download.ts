import {ZendeskError} from '../zendesk-connection/errors'
import {attachmentOrigin,zendeskOrigin} from '../zendesk-connection/http'
import {Deferred} from '../zendesk-source/context'
/** Zendesk's largest attachment is 50 MB; nothing larger is read. */
export const MAX_BYTES=50*1024*1024
const HOPS=3,TIMEOUT_MS=90000,REDIRECTS=new Set([301,302,303,307,308])
export type Download={bytes:Uint8Array}|{refused:string}
/** Retry-After as seconds or an HTTP date; null when absent or unreadable. */
export function retryAfterMs(value:string|null,now=Date.now()){
 if(!value)return null
 const seconds=Number(value);if(Number.isFinite(seconds)&&seconds>=0)return seconds*1000
 const at=Date.parse(value);return Number.isFinite(at)?Math.max(0,at-now):null
}
/** An https URL on exactly one of the allowed origins, with no credentials in it. */
function owned(value:string,base:URL|undefined,allowed:string[]){
 let url:URL;try{url=base?new URL(value,base):new URL(value)}catch{return null}
 return url.protocol==='https:'&&!url.username&&!url.password&&allowed.includes(url.origin)?url:null
}
/** Downloads one attachment. The content URL must be on the account's own Zendesk host,
 * which alone receives the token. Redirects are followed by hand, at most three hops,
 * only to that host or the account's own attachment host, which never receives the
 * token. Nothing here is stored or logged: a refusal is a code. 429, and 503 with
 * Retry-After, defer the run; 401 from the account host asks for a reconnect. */
export async function downloadAttachment(subdomain:string,contentUrl:unknown,token:string):Promise<Download>{
 const account=zendeskOrigin(subdomain),files=attachmentOrigin(subdomain)
 if(typeof contentUrl!=='string'||!contentUrl)return {refused:'attachment_url_missing'}
 let url=owned(contentUrl,undefined,[account]);if(!url)return {refused:'attachment_host_not_owned'}
 const signal=AbortSignal.timeout(TIMEOUT_MS)
 for(let hop=0;hop<=HOPS;hop++){
  const own=url.origin===account
  let response:Response
  try{response=await fetch(url,{method:'GET',redirect:'manual',signal,headers:own?{Authorization:`Bearer ${token}`}:{}})}
  catch{return {refused:'attachment_unreachable'}}
  if(REDIRECTS.has(response.status)){
   const location=response.headers.get('Location');await response.body?.cancel()
   if(!location)return {refused:'attachment_redirect_invalid'}
   const next=owned(location,url,[account,files]);if(!next)return {refused:'attachment_host_not_owned'}
   url=next;continue
  }
  const wait=retryAfterMs(response.headers.get('Retry-After'))
  if(response.status===429||response.status===503&&wait!==null){await response.body?.cancel();throw new Deferred(wait??60000)}
  if(response.status===401&&own){await response.body?.cancel();throw new ZendeskError('zendesk_reconnect_required',401)}
  if(response.status<200||response.status>=300){await response.body?.cancel();return {refused:`attachment_download_failed:${response.status}`}}
  return read(response)
 }
 return {refused:'attachment_too_many_redirects'}
}
async function read(response:Response):Promise<Download>{
 const header=response.headers.get('Content-Length'),declared=header===null?null:Number(header)
 if(declared!==null&&declared>MAX_BYTES){await response.body?.cancel();return {refused:'attachment_too_large'}}
 const reader=response.body?.getReader();if(!reader)return declared?{refused:'attachment_transfer_incomplete'}:{bytes:new Uint8Array(0)}
 const chunks:Uint8Array[]=[];let length=0
 try{for(;;){const next=await reader.read();if(next.done)break;length+=next.value.byteLength;if(length>MAX_BYTES){await reader.cancel();return {refused:'attachment_too_large'}}chunks.push(next.value)}}
 catch{return {refused:'attachment_transfer_failed'}}
 if(declared!==null&&Number.isFinite(declared)&&length!==declared)return {refused:'attachment_transfer_incomplete'}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
 return {bytes}
}
