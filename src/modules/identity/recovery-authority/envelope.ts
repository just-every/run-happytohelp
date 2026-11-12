import type {Env} from '../../../platform/env'
import {b64url,fromB64url} from '../two-factor/webauthn'
import {generation,isRandom,keyValue,refuse,type RecoveryContext} from './common'
export interface Envelope {alg:'HS256';payload:string;signature:string}
type Scalar=string|number
export type Payload=Record<string,Scalar>
export function canonical(payload:Payload){return JSON.stringify(Object.fromEntries(Object.keys(payload).sort().map(key=>[key,payload[key]])))}
const common=['v','type','iss','aud','installation_id','app_id','environment','generation','nonce','iat','exp']
const scopes={
 'app-challenge':[...common,'app_origin','owner_id','workspace_id','challenge_id'],
 'platform-authorization':[...common,'app_origin','owner_id','workspace_id','challenge_id','platform_proof_id'],
 'custody-request':[...common,'op'],
 'custody-ack':[...common,'op','anchor','watermark','app_version'],
}
export type MessageType=keyof typeof scopes
function origin(value:unknown){try{const u=new URL(String(value));if(u.origin!==value||u.protocol!=='https:')return null;return u.origin}catch{return null}}
export function configuration(env:Env){
 const app=origin(env.APP_ORIGIN),platform=origin(env.RER_MANAGEMENT_ORIGIN),installation=String(env.RER_INSTALLATION_ID||'')
 if(!app||!platform||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(installation)||env.H2H_OWNER_RECOVERY_ENABLED!=='true'||!Number.isSafeInteger(Number(env.H2H_OWNER_RECOVERY_GENERATION))||generation(env)<1||!/^[a-f0-9]{64}$/.test(keyValue(env)))refuse(503)
 return {app,platform,installation,generation:generation(env)}
}
async function signingKey(env:Env){const value=keyValue(env);if(!/^[a-f0-9]{64}$/.test(value))refuse(503);return crypto.subtle.importKey('raw',Uint8Array.from(value.match(/../g)!,byte=>parseInt(byte,16)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
const message=(bytes:Uint8Array)=>{const prefix=new TextEncoder().encode('h2h-owner-recovery-v1\n'),out=new Uint8Array(prefix.length+bytes.length);out.set(prefix);out.set(bytes,prefix.length);return out}
export async function sign(env:Env,payload:Payload):Promise<Envelope>{const bytes=new TextEncoder().encode(canonical(payload));return {alg:'HS256',payload:b64url(bytes),signature:b64url(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),message(bytes))))}}
export async function verify(env:Env,input:unknown,type:MessageType):Promise<Payload>{
 if(!input||typeof input!=='object'||Array.isArray(input))refuse()
 const envelope=input as Envelope
 if(Object.keys(envelope).sort().join(',')!=='alg,payload,signature'||envelope.alg!=='HS256'||typeof envelope.payload!=='string'||!isRandom(envelope.signature))refuse()
 let bytes:Uint8Array,payload:Payload
 try{bytes=fromB64url(envelope.payload);if(b64url(bytes)!==envelope.payload)refuse();payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(!payload||Object.keys(payload).sort().join(',')!==scopes[type].sort().join(',')||canonical(payload)!==new TextDecoder().decode(bytes))refuse()}catch{refuse()}
 if(!await crypto.subtle.verify('HMAC',await signingKey(env),fromB64url(envelope.signature),message(bytes)))refuse()
 const now=Math.floor(Date.now()/1000),config=configuration(env)
 for(const [name,value] of Object.entries(payload)){
  if(['v','generation','iat','exp','watermark'].includes(name)){if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0)refuse()}
  else if(typeof value!=='string'||!value.length||!/^[\x21-\x7e]+$/.test(value)||value.length>(['iss','aud','app_origin'].includes(name)?2048:128))refuse()
 }
 if(payload.v!==1||payload.type!==type||payload.installation_id!==config.installation||payload.app_id!=='happytohelp'||payload.environment!=='production'||payload.generation!==config.generation||Number(payload.iat)>now+30||Number(payload.exp)<=now||Number(payload.exp)<=Number(payload.iat)||Number(payload.exp)-Number(payload.iat)>(type.startsWith('custody')?120:300))refuse()
 for(const field of ['nonce',...(!type.startsWith('custody')?['challenge_id']:[]),...(type==='platform-authorization'?['platform_proof_id']:[])])if(!isRandom(payload[field]))refuse()
 const endpoint=type==='custody-request'?'custody':'authorize'
 if(payload.iss!==config.platform||payload.aud!==`${config.app}/api/identity/owner-recovery/${endpoint}`||(!type.startsWith('custody')&&payload.app_origin!==config.app))refuse()
 if(type==='custody-request'&&!['bind','status','revoke'].includes(String(payload.op)))refuse()
 return payload
}
// No outer duplicate fields, including escaped field names. Payload duplicates
// are rejected by canonical byte equality above.
export function envelopeKeys(text:string){
 const keys=[...text.matchAll(/"((?:[^"\\]|\\.)*)"\s*:/g)].map(match=>{try{return JSON.parse('"'+match[1]+'"')}catch{return ''}})
 if(keys.length!==3||new Set(keys).size!==3)refuse()
}
