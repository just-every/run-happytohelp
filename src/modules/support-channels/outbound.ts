import {HTTPException} from 'hono/http-exception'
import type {Env,Actor} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {httpsTransport} from '../api-integrations/transport'
import {auditStatement} from '../audit/record'
import {memberAccess} from '../access/gate'
import {thread,connection} from './model'
import {teamsToken,teamsReplyUrl} from './teams'
import {outboundMedia} from './media'
export interface Continuation {name:string;language:{code:string};components?:{type:string;parameters:{type:string;text:string}[]}[]}
export function blocker(t:any,now=Date.now(),continuation=false){
 if(t.revoked_at!==null||!t.token_cipher)return 'connection_revoked: reconnect in Settings → Support channels'
 if(t.opted_out)return 'customer_opted_out: no further contact is authorized'
 if(t.provider==='sms'&&!t.registered)return 'a2p_registration_required: complete provider registration before sending'
 if(continuation&&(t.provider!=='whatsapp'||!t.template_consent))return 'template_consent_required: the customer must explicitly agree to WhatsApp support updates; STOP cannot be overridden'
 if(['whatsapp','instagram','messenger'].includes(t.provider)&&now-t.last_inbound_at>86400000&&!continuation)return t.provider==='whatsapp'?'reply_window_expired: choose an approved continuation template with customer consent, or wait for a new customer message':'reply_window_expired: wait for a new customer message; do not contact another channel'
 return null
}
/** A durable claim precedes every provider request. Unknown outcomes are never replayed. */
export async function channelMessage(env:Env,message:Record<string,unknown>,actor:Actor,continuation?:Continuation){
 const t=await thread(env,actor.projectId,String(message.conversation_id))
 if(!t)return !!await env.DB.prepare("SELECT 1 FROM conversations WHERE id=? AND project_id=? AND channel IN ('sms','whatsapp','instagram','messenger','slack','teams')").bind(message.conversation_id,actor.projectId).first()
 if(actor.role==='contact')return true
 if(await env.DB.prepare('SELECT 1 FROM support_channel_sends WHERE message_id=?').bind(message.id).first())return true
 const now=Date.now(),permission=await memberAccess(env.DB,actor.projectId,actor.id),reason=blocker(t,now,!!continuation)||(!permission?.permissions.has('conversations.reply')?'reply_permission_required':null)
 const claim=await env.DB.prepare('INSERT OR IGNORE INTO support_channel_sends VALUES(?,?,?,?,?,?,?,?,?)').bind(message.id,actor.projectId,message.conversation_id,t.connection_id,reason?'blocked':'sending',reason?.split(':')[0]??null,null,now,now).run()
 if(!claim.meta.changes)return true
 if(reason){await auditStatement(env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.send_blocked',outcome:'refused',actor:{type:'user',id:actor.id},source:'system',target:{type:'message',id:String(message.id)},detail:{provider:t.provider,reason:reason.split(':')[0]}}).run();return true}
 let state='uncertain',error:string|null='provider_outcome_unknown',providerId:string|null=null,requested=false
 try{
  const current=await connection(env,t.connection_id),token=await decryptToken(env,actor.projectId,current.token_cipher!),files=await outboundMedia(env,t,String(message.id))
  if(['whatsapp','instagram','messenger'].includes(t.provider)&&files.length>1)throw new HTTPException(422,{message:'one_attachment_per_social_message'})
  let url='',body='',headers:Record<string,string>={'Content-Type':'application/json','Authorization':'Bearer '+token}
  const content=String(message.content),file=files[0]
  if(t.provider==='sms'){
   url=`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.account)}/Messages.json`;headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+btoa(t.account+':'+token)}
   const form=new URLSearchParams({From:t.sender,To:t.recipient,Body:content});for(const f of files)form.append('MediaUrl',f.url)
   if(env.APP_ORIGIN)form.set('StatusCallback',new URL('/api/support-channels/webhooks/'+t.connection_id,String(env.APP_ORIGIN)).href)
   body=form.toString()
  }else if(t.provider==='teams'){
   url=teamsReplyUrl(t);headers.Authorization='Bearer '+await teamsToken(env,current);body=JSON.stringify({type:'message',text:content,textFormat:'plain',attachments:files.map(f=>({contentType:f.content_type,contentUrl:f.url,name:f.filename}))})
  }else if(t.provider==='slack'){
   url='https://slack.com/api/chat.postMessage';body=JSON.stringify({channel:t.channel_id,thread_ts:t.thread_key,text:content||'Support attachment',attachments:files.map(f=>({fallback:f.filename,title:f.filename,title_link:f.url})),mrkdwn:false,unfurl_links:false,unfurl_media:false,parse:'none'})
  }else if(t.provider==='whatsapp'){
   url=`https://graph.facebook.com/v23.0/${encodeURIComponent(t.sender)}/messages`
   const type=continuation?'template':file?(file.content_type.startsWith('image/')?'image':file.content_type.startsWith('audio/')?'audio':file.content_type.startsWith('video/')?'video':'document'):'text'
   if(type==='audio'&&content.trim())throw new HTTPException(422,{message:'send_audio_without_caption'})
   body=JSON.stringify({messaging_product:'whatsapp',to:t.recipient,type,[type]:continuation??(file?{link:file.url,...(type==='document'?{filename:file.filename}:{}),...(content.trim()?{caption:content}:{})}:{body:content})})
  }else{
   url=`https://graph.facebook.com/v23.0/${encodeURIComponent(t.sender)}/messages`
   // Messenger/Instagram do not allow text and attachment in the same message envelope.
   if(file&&content.trim())throw new HTTPException(422,{message:'send_social_attachment_separately_from_text'})
   body=JSON.stringify({recipient:{id:t.recipient},message:file?{attachment:{type:file.content_type.startsWith('image/')?'image':file.content_type.startsWith('audio/')?'audio':file.content_type.startsWith('video/')?'video':'file',payload:{url:file.url,is_reusable:false}}}:{text:content},messaging_type:'RESPONSE'})
  }
  const live=await thread(env,actor.projectId,String(message.conversation_id)),fresh=await connection(env,t.connection_id)
  if(!live||blocker(live,Date.now(),!!continuation)||fresh.token_cipher!==current.token_cipher||(['slack','teams'].includes(live.provider)&&!JSON.parse(fresh.channels_json).includes(live.channel_id))||!(await memberAccess(env.DB,actor.projectId,actor.id))?.permissions.has('conversations.reply')){state='blocked';error='channel_authority_changed'}
  else{
   requested=true
   const response=await httpsTransport.send({url,headers,body}),data=(()=>{try{return JSON.parse(response.body)}catch{return null}})()
   if(response.status>=200&&response.status<300&&data&&(t.provider!=='slack'||data.ok===true)){
    providerId=data.sid??data.ts??data.id??data.messages?.[0]?.id??data.message_id??null
    if(providerId){state='accepted';error=null}
   }else if(response.status>=400&&response.status<500||(t.provider==='slack'&&data?.ok===false)){state='failed';error='provider_rejected'}
  }
 }catch(cause){if(!requested&&cause instanceof HTTPException){state='blocked';error=cause.status===410?'connection_revoked':cause.message||'attachment_unavailable'}}
 await env.DB.batch([env.DB.prepare("UPDATE support_channel_sends SET state=?,error_code=?,provider_id=?,updated_at=? WHERE message_id=? AND error_code IS NOT 'contact_erased'").bind(state,error,providerId,Date.now(),message.id),auditStatement(env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.send_'+state,outcome:state==='accepted'?'succeeded':'failed',actor:{type:'user',id:actor.id},source:'system',target:{type:'message',id:String(message.id)},detail:{provider:t.provider}})])
 return true
}
