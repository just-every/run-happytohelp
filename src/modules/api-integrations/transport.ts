import {validateDestination} from '../../vendor/base/modules/integrations/core/destination.ts'
import {hmac} from '../../vendor/base/modules/integrations/core/crypto.ts'
import type {DeliveryProtocol,Envelope,TrustedTransport,WireRequest,WireResponse} from '../../vendor/base/modules/integrations/core/types.ts'
import type {Env} from '../../platform/env'
import type {NativeDeliveryRepository} from './delivery-repository'
import {renderConnectedBody} from '../knowledge/connected-door'

/** Edition override, owner decision 2026-10-09: ordinary platform HTTPS fetch.
 * This implements Base's wire shape, not its DNS-pinning security guarantee.
 * CONTRACT.md defines the narrower destination, redirect and resource policy. */
export const httpsTransport={
 async send(wire:WireRequest):Promise<WireResponse>{
  validateDestination(wire.url)
  if(new TextEncoder().encode(wire.body).byteLength>1048576)throw Error('request_size_exceeded')
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000)
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined
  try{
   const response=await fetch(wire.url,{method:'POST',headers:wire.headers,body:wire.body,redirect:'manual',signal:controller.signal})
   if(response.status>=300&&response.status<400){await response.body?.cancel();throw Error('redirect_refused')}
   const length=response.headers.get('content-length')
   if(length!==null&&Number(length)>65536){await response.body?.cancel();throw Error('response_size_exceeded')}
   reader=response.body?.getReader()
   const chunks:Uint8Array[]=[];let size=0
   if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('response_size_exceeded');chunks.push(value)}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
   return {status:response.status,headers:Object.fromEntries(response.headers),body:new TextDecoder().decode(bytes)}
  }finally{clearTimeout(timer);if(reader){await reader.cancel().catch(()=>{});reader.releaseLock()}}
 }
}

/** Base validates and retains the immutable reference envelope. Rendering occurs
 * only after its claim/preflight, immediately before the real transport. The
 * weak association carries identity without adding headers or storing bytes. */
export function connectedTransport(env:Env,projectId:string,repo:NativeDeliveryRepository,readDestination:(id:string)=>Promise<any>,transport:TrustedTransport){
 const envelopes=new WeakMap<WireRequest,Envelope>()
 const protocol=(base:DeliveryProtocol):DeliveryProtocol=>({...base,async prepare(envelope,now){
  const wire=await base.prepare(envelope,now)
  envelopes.set(wire,{...envelope})
  return wire
 }})
 return {protocol,transport:{async send(wire:WireRequest):Promise<WireResponse>{
  const envelope=envelopes.get(wire)
  if(!envelope||envelope.tenant!==projectId||wire.body!==envelope.body)throw Error('Connected envelope unavailable')
  const target=await readDestination(envelope.destinationId),delivery=await repo.get(envelope.id)
  if(!delivery||delivery.state!=='sending'||!delivery.claim||delivery.claimUntil!<=Date.now()||delivery.body!==envelope.body||delivery.protocol!==envelope.protocol)throw Error('Connected delivery unavailable')
  const event=await env.DB.prepare('SELECT e.conversation_id FROM native_integration_intents i JOIN native_integration_events e ON e.id=i.event_id AND e.project_id=i.project_id WHERE i.id=? AND i.project_id=? AND e.erased_at IS NULL AND i.error_code IS NULL').bind(envelope.id,projectId).first<{conversation_id:string|null}>()
  if(!event)throw Error('Connected event unavailable')
  const body=await renderConnectedBody(env,projectId,event.conversation_id||undefined,wire.body,envelope.protocol),headers={...wire.headers}
  if(envelope.protocol==='webhook'){
   if(target.kind!=='webhook'||target.secret.url!==wire.url||typeof target.secret.key!=='string'||!/^[a-f0-9]{64}$/.test(target.secret.key))throw Error('Connected destination unavailable')
   const key=Uint8Array.from((target.secret.key as string).match(/../g)!,part=>parseInt(part,16)),timestamp=headers['webhook-timestamp']
   headers['webhook-signature']='v1='+await hmac(key,JSON.stringify(['integrations.webhook.v1',envelope.tenant,envelope.destinationId,envelope.event,envelope.id,timestamp,body]))
  }else if(target.kind!=='slack'||envelope.protocol!==`slack.${target.mode}.v1`)throw Error('Connected destination unavailable')
  // Rendering and signing yield. Keep the existing exact-destination, erasure
  // and still-live Base claim checks after those operations as well.
  const current=await repo.get(envelope.id)
  if(!current||current.state!=='sending'||current.claim!==delivery.claim||current.claimUntil!<=Date.now())throw Error('Connected claim unavailable')
  return transport.send({...wire,headers,body})
 }} }
}
