import {recordConsent} from './consent'
import {answerHelp} from './help'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {admitMessage,messageAuthority,sharedChannelParticipant} from '../conversations/admission'
import {auditStatement} from '../audit/record'
import {connection,digest,liveConnection,type Connection} from './model'
import {events,verify,type Inbound} from './protocol'
import {sharedEvent} from './shared'
import {verifyTeams} from './teams'
import {inboundMedia,discardMedia} from './media'
import {publishActivity} from '../conversations/activity'
export const inbound=new Hono<AppEnv>()
const webhook='/webhooks/:id'
inbound.get(webhook,async c=>{const row=await connection(c.env,c.req.param('id'));if(row.provider==='sms'||row.provider==='slack'||row.provider==='teams'||c.req.query('hub.mode')!=='subscribe'||await digest(c.req.query('hub.verify_token')||'')!==row.verify_hash)throw new HTTPException(403);return c.text(c.req.query('hub.challenge')||'')})
inbound.post(webhook,async c=>{
 const row=await connection(c.env,c.req.param('id'));if(Number(c.req.header('Content-Length')||0)>262144)throw new HTTPException(413)
 const reader=c.req.raw.body?.getReader();let raw='',size=0;const decoder=new TextDecoder();if(reader)try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144)throw new HTTPException(413);raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{await reader.cancel()}
 const secret=await decryptToken(c.env,row.project_id,row.signing_cipher!),url=new URL(c.req.url);if(c.env.APP_ORIGIN){const base=new URL(String(c.env.APP_ORIGIN));url.protocol=base.protocol;url.host=base.host}
 if(row.provider==='teams')await verifyTeams(row,raw,c.req.raw.headers);else await verify(row,secret,url.href,raw,c.req.raw.headers)
 if(row.provider==='slack'){const body=JSON.parse(raw);if(body.type==='url_verification')return c.json({challenge:body.challenge})}
 const receipts=[];for(const event of events(row,raw))receipts.push(await receive(c.env,row,event))
 return row.provider==='sms'?c.body(receipts.some(r=>'help' in r&&r.help)?'<Response><Message>For support, reply with your question. Send START to allow support replies or STOP to opt out.</Message></Response>':'<Response/>',200,{'Content-Type':'text/xml'}):c.json({received:true,data:receipts})
})
async function receive(env:Env,row:Connection,event:Inbound){
 const handled=await sharedEvent(env,row,event);if(handled)return handled
 const eventHash=await digest(event.id),now=Date.now(),at=Math.min(now,event.at??now)
 if(event.status){
  // A status never creates a ticket or downgrades a terminal delivered/read receipt.
  const state=['delivered','read'].includes(event.status)?'delivered':['failed','undelivered'].includes(event.status)?'failed':'accepted'
  await env.DB.prepare(`UPDATE support_channel_sends SET state=?,error_code=?,updated_at=? WHERE connection_id=? AND (provider_id=? OR (? IS NOT NULL AND created_at<=? AND conversation_id IN (SELECT conversation_id FROM support_channel_threads WHERE connection_id=? AND recipient=?))) AND state NOT IN ('delivered','failed') AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection})`).bind(state,state==='failed'?'provider_delivery_failed':null,now,row.id,event.providerId??null,event.watermark??null,event.watermark??null,row.id,event.sender,row.id).run();return {status:state}
 }
 if(event.ignored){await auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'support_channel.event_held',actor:{type:'system'},source:'system',target:{type:'support_channel',id:row.id},detail:{reason:'edited_deleted_or_noncustomer_event'}}).run();return {held:true}}
 if(!event.text.trim()&&!event.media.length)return {ignored:true}
 const identity=await digest(event.sender),threadId=await digest(row.id+'|'+event.channel+'|'+event.thread)
 if(await env.DB.prepare('SELECT 1 FROM support_channel_fences WHERE connection_id=? AND identity_hash=?').bind(row.id,identity).first())return {erased:true}
 let t=await env.DB.prepare('SELECT * FROM support_channel_threads WHERE id=?').bind(threadId).first<any>()
 const shared=['slack','teams'].includes(row.provider),contactId=shared?await digest(row.id+'|'+event.channel+'|contact|'+event.sender):t?.contact_id??await digest(row.id+'|contact|'+event.sender),conversationId=t?.conversation_id??threadId
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO contacts(id,project_id,name,created_at) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection}) AND NOT EXISTS(SELECT 1 FROM support_channel_fences WHERE connection_id=? AND identity_hash=?)`).bind(contactId,row.project_id,`${row.provider} customer`,now,row.id,row.id,identity),
  env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,channel,created_at,updated_at) SELECT ?,project_id,id,?,?,? FROM contacts WHERE id=? AND project_id=? AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)!=1 AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection})`).bind(conversationId,row.provider,now,now,contactId,row.project_id,row.id),
  env.DB.prepare(`INSERT OR IGNORE INTO support_channel_threads(id,project_id,connection_id,contact_id,conversation_id,identity_hash,recipient,channel_id,thread_key,last_inbound_at,opted_out) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations c WHERE c.id=? AND c.project_id=? AND c.contact_id=? AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection})) AND NOT EXISTS(SELECT 1 FROM support_channel_fences WHERE connection_id=? AND identity_hash=?)`).bind(threadId,row.project_id,row.id,contactId,conversationId,identity,event.sender,event.channel,event.thread,at,event.optOut?1:0,conversationId,row.project_id,contactId,row.id,row.id,identity),
 ])
 t=await env.DB.prepare('SELECT t.*,c.revision FROM support_channel_threads t JOIN conversations c ON c.id=t.conversation_id WHERE t.id=?').bind(threadId).first<any>()
 if(!t)throw new HTTPException(409)
 if(row.provider==='teams'){await env.DB.prepare('UPDATE support_channel_threads SET service_url=?,provider_conversation=? WHERE id=?').bind(event.serviceUrl!,event.providerConversation!,threadId).run();t.service_url=event.serviceUrl;t.provider_conversation=event.providerConversation}
 await recordConsent(env,row,event,identity,contactId,at)
 if(shared){await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO conversation_participants(id,conversation_id,contact_id,created_at,joined_via) SELECT ?,?,?,?,'self' WHERE EXISTS(SELECT 1 FROM contacts WHERE id=? AND project_id=? AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erased'),0)!=1) AND EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND "+liveConnection+")").bind(await digest(threadId+'|'+contactId),t.conversation_id,contactId,now,contactId,row.project_id,row.id),env.DB.prepare('INSERT OR IGNORE INTO contact_companies SELECT ?,?,a.company_id FROM support_channel_accounts a JOIN companies c ON c.id=a.company_id AND c.project_id=a.project_id AND c.merged_into IS NULL WHERE a.connection_id=? AND a.channel_id=?').bind(row.project_id,contactId,row.id,event.channel)])}
 const localId='channel:'+eventHash,prior=await env.DB.prepare('SELECT id FROM messages WHERE conversation_id=? AND local_id=?').bind(t.conversation_id,localId).first<{id:string}>()
 if(prior)return {duplicate:true,conversation_id:t.conversation_id}
 // Every provider is scoped to its installed identity and current connection at admission.
 const staged=await inboundMedia(env,row,{...t,contact_id:contactId},event.media)
 let result;try{result=await admitMessage(env,{projectId:row.project_id,conversationId:t.conversation_id,actor:{id:contactId,contactId:contactId,projectId:row.project_id,role:'contact'},[sharedChannelParticipant]:shared?true:undefined,localId,content:event.text,mediaIds:staged.map(f=>f.id),expectedRevision:t.revision,requireAvailableRequester:true,[messageAuthority]:{sql:`EXISTS(SELECT 1 FROM support_channel_connections WHERE id=? AND ${liveConnection}) AND NOT EXISTS(SELECT 1 FROM support_channel_fences WHERE connection_id=? AND identity_hash=?)`,args:[row.id,row.id,identity]}})}catch(error){await discardMedia(env,staged);throw error}
 if(!result.accepted){await discardMedia(env,staged);}
 if(!result.accepted)throw new HTTPException(409,{message:'Channel message not admitted; redeliver after reconciling the conversation'})
 const target=String(result.message.conversation_id)
 await env.DB.batch([env.DB.prepare('INSERT OR IGNORE INTO support_channel_events(connection_id,event_hash,thread_id,message_id,created_at,provider_message_id,sender_hash) VALUES(?,?,?,?,?,?,?)').bind(row.id,eventHash,threadId,result.message.id,now,event.providerMessageId??event.id,identity),env.DB.prepare('UPDATE support_channel_threads SET last_inbound_at=MAX(last_inbound_at,?),conversation_id=? WHERE id=?').bind(at,target,threadId),auditStatement(env.DB,{projectId:row.project_id,category:'integration',action:'support_channel.received',actor:{type:'system'},source:'system',target:{type:'conversation',id:target},detail:{provider:row.provider}})])
 await publishActivity(env,row.project_id,target,'message')
 if(event.help&&row.provider==='whatsapp')await answerHelp(env,row,t,String(result.message.id))
 return {conversation_id:target,message_id:result.message.id,help:!!event.help&&!event.carrierHelp}
}
