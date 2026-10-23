import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import type {Connection} from './model'
import type {Inbound} from './protocol'
import {providerJson,safeUrl} from './network'
const decoder=new TextDecoder()
function decode(value:string){try{return Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))}catch{throw new HTTPException(401)}}
export function serviceUrl(value:string){return safeUrl(value,u=>['smba.trafficmanager.net','smba.infra.teams.microsoft.com'].includes(u.hostname)&&u.pathname.endsWith('/'))}
export async function verifyTeams(row:Connection,raw:string,headers:Headers){
 const token=headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_.-]+)$/i)?.[1],parts=token?.split('.')
 if(!parts||parts.length!==3)throw new HTTPException(401)
 let header:any,claims:any,body:any;try{header=JSON.parse(decoder.decode(decode(parts[0])));claims=JSON.parse(decoder.decode(decode(parts[1])));body=JSON.parse(raw)}catch{throw new HTTPException(401)}
 const now=Math.floor(Date.now()/1000)
 if(header.alg!=='RS256'||typeof header.kid!=='string'||claims.iss!=='https://api.botframework.com'||claims.aud!==row.sender||!Number.isFinite(claims.exp)||claims.exp<=now||!Number.isFinite(claims.nbf)||claims.nbf>now+60||claims.serviceurl!==body.serviceUrl)throw new HTTPException(401,{message:'Teams bot token rejected'})
 serviceUrl(body.serviceUrl)
 const jwks=await providerJson('https://login.botframework.com/v1/.well-known/keys'),jwk=jwks.keys?.find((k:any)=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig'))
 if(!jwk)throw new HTTPException(401)
 let valid=false;try{const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);valid=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]))}catch{}
 if(!valid)throw new HTTPException(401)
 if(body.channelId!=='msteams'||body.channelData?.tenant?.id!==row.account)throw new HTTPException(403,{message:'Teams tenant mismatch'})
}
export function teamsEvents(row:Connection,raw:string):Inbound[]{
 const b=JSON.parse(raw),channel=b.channelData?.channel?.id||'',sender=b.from?.aadObjectId||b.from?.id
 if(!b.id||!sender||!b.conversation?.id)return []
 const text=typeof b.text==='string'?b.text.replace(/<at>[^<]*<\/at>/g,'').trim():''
 const link=/^support link ([a-f0-9-]{36})$/i.exec(text)
 if(!JSON.parse(row.channels_json).includes(channel)&&!(link&&b.conversation.conversationType==='personal'))throw new HTTPException(403,{message:'Teams customer channel is not installed and allowed'})
 if(!['message','messageUpdate','messageDelete'].includes(b.type))return [{id:b.id,sender,channel,thread:'',text:'',media:[],ignored:b.type}]
 const changing=b.type!=='message',attachments=(changing?[]:b.attachments||[]).map((a:any)=>{if(!a.contentUrl||!a.contentType?.startsWith('image/'))throw new HTTPException(422,{message:'Teams supports inline image attachments; retain unsupported files for review'});return {url:a.contentUrl,name:a.name,type:a.contentType}})
 return [{private:b.conversation.conversationType==='personal',id:b.id+(b.type==='message'?'':':'+b.type+':'+b.timestamp),sender,channel,thread:b.replyToId||b.id,text,media:attachments,serviceUrl:b.serviceUrl,providerConversation:b.conversation.id,...(b.type!=='message'?{editId:b.id,attachmentChange:b.type==='messageUpdate'&&Object.hasOwn(b,'attachments'),deleted:b.type==='messageDelete',at:Date.parse(b.timestamp)}:{})}]
}
export async function teamsToken(env:Env,row:Connection){
 const secret=await decryptToken(env,row.project_id,row.token_cipher!)
 const data=await providerJson('https://login.microsoftonline.com/'+encodeURIComponent(row.account)+'/oauth2/v2.0/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'client_credentials',client_id:row.sender,client_secret:secret,scope:'https://api.botframework.com/.default'}).toString()})
 if(typeof data.access_token!=='string'||!data.access_token)throw new HTTPException(502,{message:'Teams app credential refused'})
 return data.access_token as string
}
export function teamsReplyUrl(t:any){return new URL('v3/conversations/'+encodeURIComponent(t.provider_conversation)+'/activities/'+encodeURIComponent(t.thread_key),serviceUrl(t.service_url)).href}
