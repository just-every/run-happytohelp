import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {canonical} from './rer-mail-contract'
import {headerBlockEntries} from './email-classification'
import {headerFromAddress} from './inbound-sender'
import type {RerInboundMetadata} from './rer-inbound-signature'

/** Original MIME can contain a live reply recipient. Keep it encrypted with the
 * installation's stable data key; archives carry ciphertext, never that key.
 * Relay/ingress credential rotation does not change this data key. */
export async function privateRerMime(env:Env,raw:Uint8Array,m:RerInboundMetadata){
 let secret:Uint8Array
 try{secret=Uint8Array.from(atob(String(env.INTEGRATION_ENCRYPTION_KEY||'')),c=>c.charCodeAt(0));if(secret.length!==32)throw new Error()}catch{throw new HTTPException(503,{message:'Private email storage is unavailable'})}
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(secret).buffer,'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12))
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(canonical([m.workspaceId,m.mailboxId,m.deliveryId,m.bodySha256]))},key,Uint8Array.from(raw).buffer)
 const stored=new Uint8Array(12+encrypted.byteLength);stored.set(iv);stored.set(new Uint8Array(encrypted),12);return stored
}
/** A suspended review copy never exposes a live reply grant. Preserve all other
 * bytes, including non-UTF8 MIME, and retain the exact original privately above. */
export function redactedMime(raw:Uint8Array){
 const safe=Uint8Array.from(raw)
 for(let index=0;index+35<=safe.length;index++)if(safe[index]===43&&safe[index+1]===114&&safe[index+2]===46){
  const token=safe.slice(index+3,index+35)
  if(token.every(v=>v>=48&&v<=57||v>=97&&v<=102))safe.fill(120,index+3,index+35)
 }
 return safe
}

/** Capture custody before the admission claim, including interrupted originals.
 * This is erasure metadata only; it never establishes sender authentication. */
export function mimeHeaderFrom(raw:Uint8Array){
 const headers=new TextDecoder().decode(raw.subarray(0,65536)).split(/\r?\n\r?\n/,1)[0]
 return headerFromAddress(headerBlockEntries(headers))
}
