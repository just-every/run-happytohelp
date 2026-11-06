import type {Env} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {teamsToken,teamsReplyUrl} from './teams'
import type {outboundMedia} from './media'
import type {Continuation} from './outbound'
import type {Connection} from './model'
/** Shared provider envelope for native replies and system survey invitations. */
export async function channelRequest(env:Env,t:any,current:Connection,token:string,content:string,files:Awaited<ReturnType<typeof outboundMedia>>=[],continuation?:Continuation){
  let url='',body='',headers:Record<string,string>={'Content-Type':'application/json','Authorization':'Bearer '+token}
  const file=files[0]
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
 return {url,headers,body}
}
