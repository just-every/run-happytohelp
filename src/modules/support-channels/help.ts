import type {Env} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {httpsTransport} from '../api-integrations/transport'
import {connection,type Connection} from './model'
/** A requested informational HELP answer is permitted during opt-out, once per inbound event. */
export async function answerHelp(env:Env,row:Connection,t:any,messageId:string){
 const id='help:'+messageId,now=Date.now()
 const claim=await env.DB.prepare("INSERT OR IGNORE INTO support_channel_sends VALUES(?,?,?,?,'sending',NULL,NULL,?,?)").bind(id,row.project_id,t.conversation_id,row.id,now,now).run()
 if(!claim.meta.changes)return
 let state='uncertain',providerId=null
 try{
  const live=await connection(env,row.id),token=await decryptToken(env,row.project_id,live.token_cipher!)
  const response=await httpsTransport.send({url:`https://graph.facebook.com/v23.0/${encodeURIComponent(row.sender)}/messages`,headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({messaging_product:'whatsapp',to:t.recipient,type:'text',text:{body:'For support, reply with your question. Send START to allow support replies or STOP to opt out.'}})})
  const data=JSON.parse(response.body);providerId=data.messages?.[0]?.id??null
  if(response.status>=200&&response.status<300&&providerId)state='accepted'
  else if(response.status>=400&&response.status<500)state='failed'
 }catch{}
 await env.DB.prepare('UPDATE support_channel_sends SET state=?,provider_id=?,error_code=?,updated_at=? WHERE message_id=?').bind(state,providerId,state==='accepted'?null:'help_reply_'+state,Date.now(),id).run()
}
