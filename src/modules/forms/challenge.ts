import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {fieldError} from './validation'
const unavailable=()=>new HTTPException(503,{message:'Request verification is unavailable',res:Response.json({error:'Request verification is unavailable',code:'verification_unavailable'},{status:503})})
/** Fixed host, no redirect, bounded request/response and timeout; configuration never bypasses verification. */
export async function verifyFormChallenge(env:Env,request:Request,token:unknown){
 const secret=env.FORMS_TURNSTILE_SECRET_KEY,siteKey=env.FORMS_TURNSTILE_SITE_KEY
 if(typeof secret!=='string'||!secret.trim()||typeof siteKey!=='string'||!siteKey.trim())throw unavailable()
 if(typeof token!=='string'||!token.trim()||token.length>2048)fieldError('turnstileToken','challenge_required','Complete the verification challenge')
 const body=new URLSearchParams({secret,response:token as string}),remote=request.headers.get('CF-Connecting-IP');if(remote)body.set('remoteip',remote)
 let response:Response
 try{response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body,redirect:'manual',signal:AbortSignal.timeout(10000)})}catch(error){console.error('Turnstile request failed',error instanceof Error?error.name:'unknown');throw unavailable()}
 if(!response.ok){await response.body?.cancel();throw unavailable()}
 const reader=response.body?.getReader();if(!reader)throw unavailable()
 const chunks:Uint8Array[]=[];let size=0
 try{while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>16384){await reader.cancel();throw unavailable()}chunks.push(chunk.value)}}catch{throw unavailable()}
 let result:any;try{const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}result=JSON.parse(new TextDecoder().decode(bytes))}catch{throw unavailable()}
 if(result?.success!==true)fieldError('turnstileToken','challenge_failed','Verification failed. Complete a new challenge')
 // The token must be for the origin serving this form, not a different installation.
 if(result.hostname!==new URL(request.url).hostname)fieldError('turnstileToken','challenge_failed','Verification was issued for another site')
}
