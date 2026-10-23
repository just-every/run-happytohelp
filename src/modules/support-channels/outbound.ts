import type {Env,Actor} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {httpsTransport} from '../api-integrations/transport'
import {auditStatement} from '../audit/record'
import {memberAccess} from '../access/gate'
import {thread,connection} from './model'
export function blocker(t:any,now=Date.now()){
 if(t.revoked_at!==null||!t.token_cipher)return 'connection_revoked: reconnect in Settings → Support channels'
 if(t.opted_out)return 'customer_opted_out: no further contact is authorized'
 if(t.provider==='sms'&&!t.registered)return 'a2p_registration_required: complete provider registration before sending'
 if(['whatsapp','instagram','messenger'].includes(t.provider)&&now-t.last_inbound_at>86400000)return t.provider==='whatsapp'?'reply_window_expired: approved WhatsApp continuation templates are not yet qualified; do not send free text':'reply_window_expired: wait for a new customer message; do not contact another channel'
 return null
}
/** Called for admitted public messages only. Notes are never messages and cannot reach this path.
 * A durable claim precedes the provider request. Sending/uncertain/failed rows are never automatically replayed. */
export async function channelMessage(env:Env,message:Record<string,unknown>,actor:Actor){
 const t=await thread(env,actor.projectId,String(message.conversation_id));
 // Erasure removes thread identities; the canonical channel still suppresses cross-channel effects.
 if(!t){return !!await env.DB.prepare("SELECT 1 FROM conversations WHERE id=? AND project_id=? AND channel IN ('sms','whatsapp','instagram','messenger','slack')").bind(message.conversation_id,actor.projectId).first()}
 if(actor.role==='contact')return true
 const prior=await env.DB.prepare('SELECT 1 FROM support_channel_sends WHERE message_id=?').bind(message.id).first();if(prior)return true
 const now=Date.now(),permission=await memberAccess(env.DB,actor.projectId,actor.id),reason=blocker(t)||(!permission?.permissions.has('conversations.reply')?'reply_permission_required':null)
 const claim=await env.DB.prepare(`INSERT OR IGNORE INTO support_channel_sends VALUES(?,?,?,?,?,?,?,?,?)`).bind(message.id,actor.projectId,message.conversation_id,t.connection_id,reason?'blocked':'sending',reason?.split(':')[0]??null,null,now,now).run()
 if(!claim.meta.changes)return true
 if(reason){await auditStatement(env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.send_blocked',outcome:'refused',actor:{type:'user',id:actor.id},source:'system',target:{type:'message',id:String(message.id)},detail:{provider:t.provider,reason:reason.split(':')[0]}}).run();return true}
 let state='uncertain',error:string|null='provider_outcome_unknown',providerId:string|null=null
 try{
  const current=await connection(env,t.connection_id),token=await decryptToken(env,actor.projectId,current.token_cipher!),live=await thread(env,actor.projectId,String(message.conversation_id))
  if(!live||blocker(live)||(live.provider==='slack'&&!JSON.parse(current.channels_json).includes(live.channel_id))||!(await memberAccess(env.DB,actor.projectId,actor.id))?.permissions.has('conversations.reply')){state='blocked';error='channel_authority_changed'}
  else{
   const media=await env.DB.prepare('SELECT 1 FROM media WHERE message_id=? LIMIT 1').bind(message.id).first()
   if(media){state='blocked';error='outbound_media_not_qualified'}else{
    let url='',body='',headers:Record<string,string>={'Content-Type':'application/json','Authorization':'Bearer '+token}
    if(t.provider==='sms'){url=`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.account)}/Messages.json`;headers={'Content-Type':'application/x-www-form-urlencoded','Authorization':'Basic '+btoa(t.account+':'+token)};body=new URLSearchParams({From:t.sender,To:t.recipient,Body:String(message.content)}).toString()}
    else if(t.provider==='slack'){url='https://slack.com/api/chat.postMessage';body=JSON.stringify({channel:t.channel_id,thread_ts:t.thread_key,text:String(message.content),mrkdwn:false,unfurl_links:false,unfurl_media:false,parse:'none'})}
    else if(t.provider==='whatsapp'){url=`https://graph.facebook.com/v23.0/${encodeURIComponent(t.sender)}/messages`;body=JSON.stringify({messaging_product:'whatsapp',to:t.recipient,type:'text',text:{body:String(message.content)}})}
    else{url=`https://graph.facebook.com/v23.0/${encodeURIComponent(t.sender)}/messages`;body=JSON.stringify({recipient:{id:t.recipient},message:{text:String(message.content)},messaging_type:'RESPONSE'})}
    const response=await httpsTransport.send({url,headers,body}),data=(()=>{try{return JSON.parse(response.body)}catch{return null}})()
    if(response.status>=200&&response.status<300&&data&&(t.provider!=='slack'||data.ok===true)){
     providerId=data.sid??data.ts??data.messages?.[0]?.id??data.message_id??null
     if(providerId){state='accepted';error=null}
    }else if(response.status>=400&&response.status<500){state='failed';error='provider_rejected'}
   }
  }
 }catch{/* A lost response may follow a real send. Preserve uncertainty without replay. */}
 await env.DB.batch([env.DB.prepare(`UPDATE support_channel_sends SET state=?,error_code=?,provider_id=?,updated_at=? WHERE message_id=? AND error_code IS NOT 'contact_erased'`).bind(state,error,providerId,Date.now(),message.id),auditStatement(env.DB,{projectId:actor.projectId,category:'integration',action:'support_channel.send_'+state,outcome:state==='accepted'?'succeeded':'failed',actor:{type:'user',id:actor.id},source:'system',target:{type:'message',id:String(message.id)},detail:{provider:t.provider}})])
 return true
}
