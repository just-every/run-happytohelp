import type {Env} from '../../platform/env'
import {decryptToken} from '../integrations/secrets'
import {httpsTransport} from '../api-integrations/transport'
import {thread,connection} from './model'
import {teamsToken,teamsReplyUrl} from './teams'
/** Only public status and whether a responsible teammate exists leave the canonical ticket. */
export async function syncSharedStatus(env:Env,projectId:string,id:string,requestId?:string){
 const ticket=await env.DB.prepare('SELECT channel,status_category,assigned_to,ticket_version FROM conversations WHERE id=? AND project_id=?').bind(id,projectId).first<any>()
 if(!ticket||!['slack','teams'].includes(ticket.channel))return
 const t=await thread(env,projectId,id);if(!t||t.revoked_at!==null||!t.token_cipher)return
 const receipt=requestId??'status:'+t.id+':'+ticket.ticket_version,claim=await env.DB.prepare("INSERT OR IGNORE INTO support_channel_actions VALUES(?,?,?,?,'sending',NULL,?)").bind(receipt,projectId,t.connection_id,id,Date.now()).run();if(!claim.meta.changes)return
 let state='uncertain',providerId=null
 try{
  const c=await connection(env,t.connection_id);if(!JSON.parse(c.channels_json).includes(t.channel_id))throw Error('channel_removed')
  const text='Support status: '+ticket.status_category.replaceAll('_',' ')+'. '+(ticket.assigned_to?'A teammate is responsible.':'Awaiting assignment.'),token=c.provider==='teams'?await teamsToken(env,c):await decryptToken(env,projectId,c.token_cipher!)
  const live=await thread(env,projectId,id),current=await connection(env,c.id);if(!live||current.token_cipher!==c.token_cipher||!JSON.parse(current.channels_json).includes(t.channel_id)){state='blocked'}else{
   const response=await httpsTransport.send({url:c.provider==='teams'?teamsReplyUrl(t):'https://slack.com/api/chat.postMessage',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(c.provider==='teams'?{type:'message',text,textFormat:'plain'}:{channel:t.channel_id,thread_ts:t.thread_key,text,mrkdwn:false,unfurl_links:false,unfurl_media:false,parse:'none'})})
   const data=JSON.parse(response.body);if(response.status>=200&&response.status<300&&(c.provider!=='slack'||data.ok===true)){providerId=data.id??data.ts??null;if(providerId)state='accepted'}else if(response.status>=400&&response.status<500||data.ok===false)state='failed'
  }
 }catch{}
 await env.DB.prepare('UPDATE support_channel_actions SET state=?,provider_id=? WHERE id=?').bind(state,providerId,receipt).run()
}
