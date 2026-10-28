import {HTTPException} from 'hono/http-exception'
import type {Connection} from './model'
const bytes=new TextEncoder()
export async function mac(secret:string,value:string,algorithm='SHA-256',base64=false){const key=await crypto.subtle.importKey('raw',bytes.encode(secret),{name:'HMAC',hash:algorithm},false,['sign']);const data=new Uint8Array(await crypto.subtle.sign('HMAC',key,bytes.encode(value)));return base64?btoa(String.fromCharCode(...data)):Array.from(data,x=>x.toString(16).padStart(2,'0')).join('')}
function equal(a:string,b:string){let diff=a.length^b.length;for(let n=0;n<Math.max(a.length,b.length);n++)diff|=(a.charCodeAt(n)||0)^(b.charCodeAt(n)||0);return diff===0}
export async function verify(row:Connection,secret:string,url:string,raw:string,headers:Headers){
 let expected='',received=''
 if(row.provider==='sms'){
  const form=new URLSearchParams(raw),keys=[...new Set(form.keys())].sort();if(keys.some(k=>form.getAll(k).length!==1))throw new HTTPException(400)
  expected=await mac(secret,url+keys.map(k=>k+form.get(k)).join(''),'SHA-1',true);received=headers.get('x-twilio-signature')||''
 }else if(row.provider==='slack'){
  const time=headers.get('x-slack-request-timestamp')||'';if(!/^\d+$/.test(time)||Math.abs(Date.now()/1000-Number(time))>300)throw new HTTPException(401)
  expected='v0='+await mac(secret,`v0:${time}:${raw}`);received=headers.get('x-slack-signature')||''
 }else{expected='sha256='+await mac(secret,raw);received=headers.get('x-hub-signature-256')||''}
 if(!equal(expected,received))throw new HTTPException(401,{message:'Provider signature rejected'})
}
export interface Inbound {id:string;sender:string;channel:string;thread:string;text:string;optOut?:boolean;media:boolean;status?:string;providerId?:string;ignored?:string}
export function events(row:Connection,raw:string):Inbound[]{
 if(row.provider==='sms'){
  const f=new URLSearchParams(raw);if(f.get('AccountSid')!==row.account)throw new HTTPException(403)
  if(f.get('MessageStatus')&&!f.has('Body')&&f.get('From')===row.sender)return [{id:'status:'+f.get('MessageSid')+':'+f.get('MessageStatus'),sender:'',channel:'',thread:'',text:'',media:false,status:f.get('MessageStatus')!,providerId:f.get('MessageSid')!}]
  if(f.get('To')!==row.sender)throw new HTTPException(403)
  const sender=f.get('From')||'';if(!/^\+1\d{10}$/.test(sender)||!f.get('MessageSid'))throw new HTTPException(400)
  const text=f.get('Body')||'';return [{id:f.get('MessageSid')!,sender,channel:row.sender,thread:sender,text,optOut:/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(text.trim())||f.get('OptOutType')==='STOP',media:Number(f.get('NumMedia')||0)>0}]
 }
 const body=JSON.parse(raw)
 if(row.provider==='slack'){
  if(body.team_id!==row.account)throw new HTTPException(403)
  const e=body.event;if(!e)return []
  if(!JSON.parse(row.channels_json).includes(e.channel))throw new HTTPException(403,{message:'Customer channel is not installed and allowed'})
  if(e.bot_id||e.user===row.sender)return []
  if(e.subtype)return [{id:body.event_id,sender:'',channel:e.channel,thread:'',text:'',media:false,ignored:e.subtype}]
  if(e.type!=='message'||!e.user||!e.ts||!body.event_id)return []
  return [{id:body.event_id,sender:e.user,channel:e.channel,thread:e.thread_ts||e.ts,text:e.text||'',media:!!e.files?.length}]
 }
 const result:Inbound[]=[]
 for(const entry of body.entry||[]){
  if(String(entry.id)!==row.account)throw new HTTPException(403)
  if(row.provider==='whatsapp')for(const change of entry.changes||[]){const v=change.value;if(String(v?.metadata?.phone_number_id)!==row.sender)throw new HTTPException(403)
   for(const s of v.statuses||[])result.push({id:'status:'+s.id+':'+s.status,sender:'',channel:'',thread:'',text:'',media:false,status:s.status,providerId:s.id})
   for(const m of v.messages||[]){if(!m.id||!m.from)throw new HTTPException(400);result.push({id:m.id,sender:m.from,channel:row.sender,thread:m.from,text:m.text?.body||'',media:m.type!=='text',optOut:/^(stop|unsubscribe)$/i.test(m.text?.body?.trim()||'')})}
  }else for(const e of entry.messaging||[]){if(String(e.recipient?.id)!==row.sender)throw new HTTPException(403);if(e.message?.is_echo)continue;if(e.message?.mid&&e.sender?.id)result.push({id:e.message.mid,sender:e.sender.id,channel:row.sender,thread:e.sender.id,text:e.message.text||'',media:!!e.message.attachments?.length})}
 }
 if(result.length>30)throw new HTTPException(413)
 return result
}
