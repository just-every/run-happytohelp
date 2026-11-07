import {ZendeskError} from '../zendesk-connection/errors'
import {attachmentOrigin,zendeskOrigin} from '../zendesk-connection/http'
import {Deferred} from '../zendesk-source/context'
/** Zendesk's largest attachment is 50 MB; nothing larger is read. */
export const MAX_BYTES=50*1024*1024
const HOPS=3,TIMEOUT_MS=90000,REDIRECTS=new Set([301,302,303,307,308])
/** A download in flight: its body carries exactly `length` bytes into storage, or errors. */
export interface Transfer {body:ReadableStream<Uint8Array>;length:number;piped:Promise<unknown>}
export type Download=Transfer|{refused:string}
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
 * Retry-After, defer the run; 401 from the account host asks for a reconnect. The body
 * is never held whole: it streams through with its known length (`size` is Zendesk's,
 * used when no Content-Length is declared). */
export async function downloadAttachment(subdomain:string,contentUrl:unknown,size:unknown,token:string):Promise<Download>{
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
  return stream(response,size)
 }
 return {refused:'attachment_too_many_redirects'}
}
const whole=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:typeof value==='string'&&/^\d{1,16}$/.test(value)?Number(value):null
/** The known length is the declared Content-Length, else Zendesk's size. A body that is
 * content-encoded arrives decoded, so its declared length is not the file's. */
async function stream(response:Response,size:unknown):Promise<Download>{
 const encoded=(response.headers.get('Content-Encoding')??'identity').trim().toLowerCase()!=='identity'
 const length=(encoded?null:whole(response.headers.get('Content-Length')))??whole(size)
 if(length===null){await response.body?.cancel();return {refused:'attachment_size_unknown'}}
 if(length>MAX_BYTES){await response.body?.cancel();return {refused:'attachment_too_large'}}
 return exactly(response.body,length)
}
/** Pipes the body, natively and never held whole, into a stream of exactly `length` bytes.
 * A body that runs past it errors the pipe; one that ends early errors the stream's reader. */
function exactly(source:ReadableStream<Uint8Array>|null,length:number):Transfer{
 const fixed=new FixedLengthStream(length)
 return {body:fixed.readable,length,piped:source?source.pipeTo(fixed.writable):fixed.writable.close()}
}
/** Waits for the bytes to reach storage: null once they all have, else the refusal code.
 * The runtime names a body longer or shorter than its length; anything else (a stalled
 * or broken download, a failed put) is a transfer that failed. */
export async function delivered(download:Transfer,stored:Promise<unknown>){
 const [piped,put]=await Promise.allSettled([download.piped,stored])
 if(piped.status==='rejected')return /too many bytes/i.test(String(piped.reason))?'attachment_transfer_overrun':'attachment_transfer_failed'
 if(put.status==='rejected')return /expected bytes/i.test(String(put.reason))?'attachment_transfer_incomplete':'attachment_transfer_failed'
 return null
}
