import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {credentials,type VoiceNumber} from './model'
export async function boundedText(body:ReadableStream<Uint8Array>|null,limit=65536){
 if(!body)return '';const reader=body.getReader(),parts:Uint8Array[]=[];let size=0
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new HTTPException(413,{message:'Voice payload exceeds the limit'})}parts.push(value)}}finally{reader.releaseLock()}
 const joined=new Uint8Array(size);let at=0;for(const part of parts){joined.set(part,at);at+=part.length}return new TextDecoder().decode(joined)
}
/** Only provider-owned HTTPS endpoints; no redirects or automatic retries. */
export async function providerRequest(env:Env,n:VoiceNumber,path:string,body?:Record<string,string>,beforeSend?:()=>Promise<void>){
 const token=await credentials(env,n),base=n.provider==='twilio'?`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(n.account_id)}`:'https://api.aircall.io/v1'
 const headers:Record<string,string>={Authorization:'Basic '+btoa(n.account_id+':'+token)}
 if(body)headers['Content-Type']=n.provider==='twilio'?'application/x-www-form-urlencoded':'application/json'
 if(beforeSend)await beforeSend()
 const result=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?(n.provider==='twilio'?new URLSearchParams(body).toString():JSON.stringify(body)):undefined,redirect:'manual',signal:AbortSignal.timeout(10000)})
 const text=await boundedText(result.body);let data:any;try{data=JSON.parse(text)}catch{data=null}
 return {ok:result.ok,status:result.status,data}
}
export async function verifyWebhook(c:any,n:VoiceNumber){
 const raw=await boundedText(c.req.raw.body,32768)
 if(n.provider==='aircall'){
  let b:any;try{b=JSON.parse(raw)}catch{throw new HTTPException(400)}
  const {hashToken}=await import('../../platform/auth');if(typeof b.token!=='string'||await hashToken(b.token)!==n.webhook_hash)throw new HTTPException(401)
  return b
 }
 if(!c.req.header('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new HTTPException(415)
 const form=new URLSearchParams(raw);if(new Set(form.keys()).size!==[...form].length)throw new HTTPException(400)
 let signed=c.req.url;for(const key of [...form.keys()].sort())signed+=key+form.get(key)
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(await credentials(c.env,n)),{name:'HMAC',hash:'SHA-1'},false,['sign'])
 const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(signed)))))
 if(signature!==c.req.header('X-Twilio-Signature')||form.get('AccountSid')!==n.account_id)throw new HTTPException(401)
 return Object.fromEntries(form)
}
