import {HTTPException} from 'hono/http-exception'
import type {Connection,Provider} from '../model'
const fixed={stripe:'api.stripe.com',hubspot:'api.hubapi.com'}
export function host(provider:Provider,input:unknown){
 if(provider==='orbit')throw new HTTPException(409,{message:'Orbit scoped public API is not available'})
 const value=typeof input==='string'?input:provider in fixed?'https://'+fixed[provider as keyof typeof fixed]:''
 let url:URL;try{url=new URL(value)}catch{throw new HTTPException(400,{message:'Use the provider HTTPS origin'})}
 const valid=provider in fixed?url.hostname===fixed[provider as keyof typeof fixed]:provider==='shopify'?/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(url.hostname):/^[a-z0-9][a-z0-9.-]*\.(my\.salesforce|salesforce)\.com$/.test(url.hostname)
 if(url.protocol!=='https:'||!valid||url.port||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new HTTPException(400,{message:'Use the provider HTTPS origin'})
 return url.origin
}
export class ProviderFailure extends Error {constructor(public code:string){super(code)}}
/** No redirects, retries, arbitrary returned URLs, raw provider errors or unbounded responses. */
export async function request(row:Connection,token:string,path:string,{method='GET',body,key,unmodifiedSince}:{method?:string;body?:unknown;key?:string;unmodifiedSince?:string}={}){
 const origin=host(row.provider,row.host),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000)
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
 try{
  if(!path.startsWith('/')||path.startsWith('//'))throw new ProviderFailure('invalid_path')
  const form=row.provider==='stripe'&&body!==undefined,encoded=body===undefined?undefined:form?new URLSearchParams(body as Record<string,string>).toString():JSON.stringify(body)
  if(encoded&&new TextEncoder().encode(encoded).length>1048576)throw new ProviderFailure('request_too_large')
  const response=await fetch(origin+path,{method,body:encoded,redirect:'manual',signal:controller.signal,headers:{Accept:'application/json',...(row.provider==='stripe'?{'Stripe-Version':'2024-06-20'}:{}),...(row.provider==='shopify'?{'X-Shopify-Access-Token':token}:{Authorization:'Bearer '+token}),...(body===undefined?{}:{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}),...(key?{'Idempotency-Key':key}:{}),...(unmodifiedSince?{'If-Unmodified-Since':unmodifiedSince}:{})}})
  if(!response.ok){await response.body?.cancel();throw new ProviderFailure(response.status===401||response.status===403?'grant_refused':response.status===409||response.status===412?'source_conflict':response.status>=500||response.status===429?'provider_uncertain':'provider_refused')}
  const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>65536)){await response.body?.cancel();throw new ProviderFailure('response_too_large')}
  reader=response.body?.getReader();const chunks:Uint8Array[]=[];let size=0
  if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw new ProviderFailure('response_too_large');chunks.push(value)}
  if(!size)return {}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  return JSON.parse(new TextDecoder().decode(bytes))
 }catch(error){if(error instanceof ProviderFailure)throw error;throw new ProviderFailure('provider_uncertain')}
 finally{clearTimeout(timer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
}
export const code=(error:unknown)=>error instanceof ProviderFailure?error.code:'provider_unavailable'
