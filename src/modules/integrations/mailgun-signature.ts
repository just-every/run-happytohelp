import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'

/**
 * Mailgun signs every route forward: `timestamp` (seconds), `token` (50 random
 * characters) and `signature`, the hex HMAC-SHA256 of `timestamp + token` under the
 * account's HTTP webhook signing key. The route URL therefore carries no secret.
 *
 * A request is accepted once. Mailgun retries a forward that is not answered 200 for
 * 8 hours and does not say whether a retry is re-signed, so a timestamp up to nine
 * hours old is fresh, and a token is claimed atomically so a replay is refused. A
 * forward that ends in anything but 200 releases its token so the retry can succeed.
 */
export const MAILGUN_MAX_FUTURE_MS=5*60*1000
export const MAILGUN_MAX_AGE_MS=9*60*60*1000
/** A claim is needed only while a signed timestamp can still pass the freshness check. */
export const MAILGUN_CLAIM_RETENTION_MS=MAILGUN_MAX_FUTURE_MS+MAILGUN_MAX_AGE_MS+60*1000
export interface MailgunSignature {timestamp:string;token:string;signature:string}
const refuse=()=>new HTTPException(403,{message:'Mailgun signature refused'})

/** The signing key, or a refusal while it is unset or empty: nothing is accepted unsigned. */
export function mailgunSigningKey(env:Env){
 const key=env.MAILGUN_WEBHOOK_SIGNING_KEY
 if(typeof key!=='string'||!key)throw refuse()
 return key
}
const hexBytes=(value:string)=>Uint8Array.from(value.match(/../g)||[],pair=>parseInt(pair,16))
/** Verifies the signature and freshness, then claims the token. Returns a function that
 * frees the claim. Every refusal happens before anything is written; a refused replay
 * leaves the first claim in place. */
export async function verifyMailgunSignature(env:Env,input:MailgunSignature,now=Date.now()){
 const key=mailgunSigningKey(env),{timestamp,token,signature}=input
 if(!/^\d{1,12}$/.test(timestamp)||!/^[A-Za-z0-9]{16,100}$/.test(token)||!/^[0-9a-fA-F]{64}$/.test(signature))throw refuse()
 const signed=Number(timestamp)*1000
 if(signed>now+MAILGUN_MAX_FUTURE_MS||signed<now-MAILGUN_MAX_AGE_MS)throw refuse()
 const hmac=await crypto.subtle.importKey('raw',new TextEncoder().encode(key),{name:'HMAC',hash:'SHA-256'},false,['verify'])
 if(!await crypto.subtle.verify('HMAC',hmac,hexBytes(signature),new TextEncoder().encode(timestamp+token)))throw refuse()
 const hash=await hashToken(token)
 const claimed=await env.DB.prepare('INSERT INTO mailgun_inbound_tokens(token_hash,received_at) VALUES(?,?) ON CONFLICT(token_hash) DO NOTHING RETURNING token_hash').bind(hash,now).first()
 if(!claimed)throw refuse()
 return async()=>{await env.DB.prepare('DELETE FROM mailgun_inbound_tokens WHERE token_hash=?').bind(hash).run()}
}
