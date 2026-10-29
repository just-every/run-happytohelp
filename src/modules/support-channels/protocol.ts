import {HTTPException} from 'hono/http-exception'
import type {Connection} from './model'
import {teamsEvents} from './teams'
import type {Attachment} from './media'
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
export interface Inbound {at?:number;id:string;sender:string;channel:string;thread:string;text:string;optOut?:boolean;optIn?:boolean;help?:boolean;carrierHelp?:boolean;templateConsent?:boolean;media:Attachment[];status?:string;providerId?:string;watermark?:number;ignored?:string;serviceUrl?:string;providerConversation?:string;private?:boolean;providerMessageId?:string;editId?:string;attachmentChange?:boolean;deleted?:boolean;action?:{kind:string;target?:string}}
function timestamp(value:unknown,seconds=false){const time=Number(value)*(seconds?1000:1);if(!Number.isFinite(time)||time<=0||time>Date.now()+300000)throw new HTTPException(400,{message:'Invalid provider message timestamp'});return time}
export function events(row:Connection,raw:string):Inbound[]{
 if(row.provider==='teams')return teamsEvents(row,raw)
 if(row.provider==='sms'){
  const f=new URLSearchParams(raw);if(f.get('AccountSid')!==row.account)throw new HTTPException(403)
  if(f.get('MessageStatus')&&!f.has('Body')&&f.get('From')===row.sender)return [{id:'status:'+f.get('MessageSid')+':'+f.get('MessageStatus'),sender:'',channel:'',thread:'',text:'',media:[],status:f.get('MessageStatus')!,providerId:f.get('MessageSid')!}]
  if(f.get('To')!==row.sender)throw new HTTPException(403)
  const sender=f.get('From')||'';if(!/^\+1\d{10}$/.test(sender)||!f.get('MessageSid'))throw new HTTPException(400)
  const count=Number(f.get('NumMedia')||0);if(!Number.isInteger(count)||count<0||count>5)throw new HTTPException(413)
  const media=Array.from({length:count},(_,i)=>({url:f.get('MediaUrl'+i)||'',type:f.get('MediaContentType'+i)||''}))
  const text=f.get('Body')||'',opt=f.get('OptOutType');return [{id:f.get('MessageSid')!,sender,channel:row.sender,thread:sender,text,optOut:/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/i.test(text.trim())||opt==='STOP',optIn:/^(START|UNSTOP)$/i.test(text.trim())||opt==='START',help:/^HELP$/i.test(text.trim())||opt==='HELP',carrierHelp:opt==='HELP',media}]
 }
 let body:any;try{body=JSON.parse(raw)}catch{throw new HTTPException(400,{message:'Invalid provider JSON'})}
 if(row.provider==='slack'){
  if(body.team_id!==row.account)throw new HTTPException(403)
  const e=body.event;if(!e)return []
  if(!JSON.parse(row.channels_json).includes(e.channel)&&!(/^D/.test(e.channel)&&/^support link [a-f0-9-]{36}$/i.test(e.text||'')))throw new HTTPException(403,{message:'Customer channel is not installed and allowed'})
  if(e.bot_id||e.user===row.sender)return []
  if(['message_changed','message_deleted'].includes(e.subtype)){const m=e.message||e.previous_message;return [{id:body.event_id,sender:m?.user||'',channel:e.channel,thread:m?.thread_ts||m?.ts||e.deleted_ts,text:m?.text||'',media:[],attachmentChange:!e.subtype.includes('deleted')&&(Object.hasOwn(m||{},'files')||(e.previous_message?.files?.length??0)>0),editId:m?.ts||e.deleted_ts,deleted:e.subtype==='message_deleted',at:timestamp(e.event_ts||e.ts,true)}]}
  if(e.subtype)return [{id:body.event_id,sender:'',channel:e.channel,thread:'',text:'',media:[],ignored:e.subtype}]
  if(e.type!=='message'||!e.user||!e.ts||!body.event_id)return []
  return [{id:body.event_id,private:/^D/.test(e.channel),providerMessageId:e.ts,sender:e.user,channel:e.channel,thread:e.thread_ts||e.ts,text:e.text||'',media:(e.files||[]).map((f:any)=>({url:f.url_private_download||f.url_private,name:f.name,type:f.mimetype}))}]
 }
 const result:Inbound[]=[]
 for(const entry of body.entry||[]){
  if(String(entry.id)!==row.account)throw new HTTPException(403)
  if(row.provider==='whatsapp')for(const change of entry.changes||[]){const v=change.value;if(String(v?.metadata?.phone_number_id)!==row.sender)throw new HTTPException(403)
   for(const s of v.statuses||[])result.push({id:'status:'+s.id+':'+s.status,sender:'',channel:'',thread:'',text:'',media:[],status:s.status,providerId:s.id})
   for(const m of v.messages||[]){
    if(!m.id||!m.from)throw new HTTPException(400)
    if(!['text','image','audio','video','document','button','interactive'].includes(m.type))throw new HTTPException(422,{message:'Unsupported WhatsApp message type; retain the event for review'})
    const file=m[m.type],text=m.text?.body||file?.caption||m.button?.text||m.interactive?.button_reply?.title||''
    const consent=text.trim().toLowerCase()==='i agree to whatsapp support updates'
    result.push({at:timestamp(m.timestamp,true),id:m.id,sender:m.from,channel:row.sender,thread:m.from,text,media:['image','audio','video','document'].includes(m.type)?[{id:file?.id,type:file?.mime_type||'',name:file?.filename}]:[],templateConsent:consent,optIn:/^start$/i.test(text.trim()),help:/^help$/i.test(text.trim()),optOut:/^(stop|unsubscribe)$/i.test(text.trim())})
   }
  }else for(const e of entry.messaging||[]){
   if(String(e.recipient?.id)!==row.sender)throw new HTTPException(403)
   if(e.message?.is_echo)continue
   if(e.delivery?.mids)for(const id of e.delivery.mids)result.push({id:'delivery:'+id,sender:e.sender?.id,channel:row.sender,thread:'',text:'',media:[],status:'delivered',providerId:id})
   if(e.read?.watermark)result.push({id:'read:'+e.sender?.id+':'+e.read.watermark,sender:e.sender?.id,channel:row.sender,thread:'',text:'',media:[],status:'read',watermark:timestamp(e.read.watermark)})
   if(e.message?.mid&&e.sender?.id)result.push({at:timestamp(e.timestamp),id:e.message.mid,sender:e.sender.id,channel:row.sender,thread:e.sender.id,text:e.message.text||'',media:(e.message.attachments||[]).map((a:any)=>{if(!['image','audio','video','file'].includes(a.type))throw new HTTPException(422,{message:'Unsupported social attachment; retain the event for review'});return {url:a.payload?.url,type:''}})})
  }
 }
 if(result.length>30)throw new HTTPException(413)
 return result
}
