import type {Env} from '../../../platform/env'
import {assertCustody} from './authority'
import {registerKey,renewCustody,custodyKey,type KeyKind} from './registry'
import {CustodyError,type CustodyHandle,type CustodyPrincipal} from './types'
const checksum=(object:R2Object)=>object.checksums.sha256?Array.from(new Uint8Array(object.checksums.sha256),b=>b.toString(16).padStart(2,'0')).join(''):null
export interface PutSource {kind:KeyKind;ordinal?:number;body:Uint8Array;sha256:string;bytes:number;takeover?:boolean}
/** Bounded verified bytes only. Registers before any R2 I/O; reserves with a unique nonce,
 * then replaces only that nonce's ETag. A loser never deletes a winner's source. */
export async function putCustody(env:Pick<Env,'DB'|'FILES'>,h:CustodyHandle,p:CustodyPrincipal,input:PutSource){
 const max=input.kind==='manifest'?2097152:input.kind==='object'?16777216:4194304
 if(!Number.isSafeInteger(input.bytes)||input.bytes<0||input.bytes>max||input.body.byteLength!==input.bytes||!/^[0-9a-f]{64}$/.test(input.sha256))throw new CustodyError('invalid_request',400)
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',input.body as Uint8Array<ArrayBuffer>)),b=>b.toString(16).padStart(2,'0')).join('')
 if(digest!==input.sha256||input.kind==='manifest'&&digest!==h.sha)throw new CustodyError('digest_mismatch',422)
 const key=await registerKey(env,h,p,input.kind,input.ordinal??0)
 const accepted=(object:R2Object)=>object.size===input.bytes&&checksum(object)===input.sha256&&object.customMetadata?.manifestSha256===h.sha&&object.customMetadata?.custodyProjectId===p.projectId&&object.customMetadata?.custodyGeneration===String(h.generation)&&object.customMetadata?.custodyBody==='accepted'
 const prior=await env.FILES.head(key)
 if(prior&&accepted(prior)){await renewCustody(env,h,p,'upload');return {key,alreadyPresent:true}}
 if(prior&&prior.customMetadata?.custodyBody!=='reservation')throw new CustodyError('file_conflict')
 if(prior&&!input.takeover)throw new CustodyError('source_reservation_pending')
 const reservation=await env.FILES.put(key,crypto.randomUUID(),{onlyIf:prior?{etagMatches:prior.etag}:{etagDoesNotMatch:'*'},customMetadata:{custodyBody:'reservation'}})
 if(!reservation)throw new CustodyError('source_reservation_pending')
 await assertCustody(env,h,p)
 const stored=await env.FILES.put(key,input.body,{onlyIf:{etagMatches:reservation.etag},sha256:input.sha256,customMetadata:{custodyBody:'accepted',manifestSha256:h.sha,custodyProjectId:p.projectId,custodyGeneration:String(h.generation)}})
 if(!stored)throw new CustodyError('source_invalidated')
 await renewCustody(env,h,p,'upload')
 return {key,alreadyPresent:false}
}
/** A reservation is never a readable/ready source. C calls this before consuming any body. */
export async function sourceReady(env:Pick<Env,'DB'|'FILES'>,h:CustodyHandle,p:CustodyPrincipal,kind:KeyKind,ordinal:number,sha256:string,bytes:number){
 await assertCustody(env,h,p)
 const key=custodyKey(h.sha,kind,ordinal)
 const registered=await env.DB.prepare('SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=? AND key=? AND generation=? AND cleanup_state=0').bind(h.sha,key,h.generation).first()
 if(!registered)return false
 const object=await env.FILES.head(key)
 const ready=!!object&&object.size===bytes&&checksum(object)===sha256&&object.customMetadata?.custodyBody==='accepted'&&object.customMetadata?.manifestSha256===h.sha&&object.customMetadata?.custodyProjectId===p.projectId&&object.customMetadata?.custodyGeneration===String(h.generation)
 await assertCustody(env,h,p)
 return ready
}
