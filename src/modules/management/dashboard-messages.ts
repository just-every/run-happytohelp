import type {Env} from '../../platform/env'
import {emailConfigured} from '../integrations/email-provider'
import {localMailOrigin} from '../../edition/local-mail/configuration'
import {messageNotificationRecipients,type NotificationContact} from '../integrations/notification-recipients'
import {notificationContactsSql} from '../integrations/notification-contacts'
import {iso,person} from './dashboard-data'

/** Hydrate an already authorized set. One JSON bind keeps large transcripts
 * within D1's parameter limit without a query for each message or author. */
export async function messagesData(env:Env,rows:any[]){
 if(!rows.length)return []
 const ids=JSON.stringify(rows.map(row=>row.id))
 const selected='SELECT value FROM json_each(?)'
 const mailRows=rows.filter(row=>!['contact','system'].includes(row.actor_role)&&!row.erased_at),mailIds=JSON.stringify(mailRows.map(row=>row.id))
 const suppressed=!!localMailOrigin(env),configured=emailConfigured(env),resolveRecipients=!!mailRows.length&&configured&&!suppressed
 const data=await env.DB.batch<any>([
  env.DB.prepare(`SELECT s.* FROM move_in_message_sources s JOIN messages m ON m.id=s.message_id AND m.project_id=s.project_id WHERE m.id IN (${selected})`).bind(ids),
  env.DB.prepare(`SELECT u.id,u.name,s.avatar_url FROM users u LEFT JOIN user_settings s ON s.user_id=u.id WHERE u.id IN (SELECT actor_id FROM messages WHERE id IN (${selected}) AND actor_role<>'contact')`).bind(ids),
  env.DB.prepare(`SELECT id,name,email,json_extract(metadata_json,'$.is_erased') is_erased FROM contacts WHERE id IN (SELECT actor_id FROM messages WHERE id IN (${selected}) AND actor_role='contact')`).bind(ids),
  env.DB.prepare(`SELECT id,message_id,filename,content_type,size FROM media WHERE message_id IN (${selected})`).bind(ids),
  env.DB.prepare(`SELECT m.id message_id,json_extract(e.payload,'$.reader_id') reader_id,json_extract(e.payload,'$.reader_role') reader_role,e.created_at read_at FROM messages m JOIN context_tracked_events e ON e.project_id=m.project_id AND json_valid(e.payload) AND json_extract(e.payload,'$.message_id')=m.id WHERE m.id IN (${selected}) AND e.type='MESSAGE_READ' ORDER BY e.rowid`).bind(ids),
  ...(mailRows.length?[
   env.DB.prepare(`SELECT m.id,d.state,d.error,d.updated_at,s.is_enabled,u.email sender_email FROM messages m LEFT JOIN email_deliveries d ON d.id>='message:'||m.id||':notification' AND d.id<'message:'||m.id||':notification;' AND (d.id='message:'||m.id||':notification' OR substr(d.id,1,length('message:'||m.id||':notification:'))='message:'||m.id||':notification:') AND d.project_id=m.project_id LEFT JOIN email_settings s ON s.project_id=m.project_id LEFT JOIN users u ON u.id=m.actor_id WHERE m.id IN (${selected})`).bind(mailIds),
   ...(resolveRecipients?[env.DB.prepare(`SELECT m.id message_id,ct.* FROM messages m JOIN (${notificationContactsSql}) ct ON ct.conversation_id=m.conversation_id AND ct.notification_project_id=m.project_id WHERE m.id IN (${selected})`).bind(mailIds)]:[])
  ]:[]),
 ])
 const byId=(values:any[])=>new Map(values.map(row=>[String(row.id),row]))
 const origins=new Map(data[0].results.map(row=>[String(row.message_id),row])),agents=byId(data[1].results),contacts=byId(data[2].results)
 const mail=new Map<string,any>(),reads=new Map<string,{read_by_contacts:Record<string,string>;read_by_agents:Record<string,string>}>()
 const recipients=new Map<string,NotificationContact[]>()
 for(const {message_id,...contact} of resolveRecipients?data[6].results:[]){const key=String(message_id);if(!recipients.has(key))recipients.set(key,[]);recipients.get(key)!.push(contact)}
 const precedence=['uncertain','sending','rate_limited','failed']
 for(const attempt of mailRows.length?data[5].results:[]){
  if(attempt.state==='failed'&&attempt.error?.startsWith('Outbound notice rate limit'))attempt.state='rate_limited'
  const key=String(attempt.id),prior=mail.get(key)
  if(!prior)mail.set(key,attempt)
  else{
   const states=[prior.state,attempt.state]
   mail.set(key,{...prior,state:precedence.find(state=>states.includes(state))||prior.state||attempt.state,updated_at:Math.max(prior.updated_at||0,attempt.updated_at||0)})
  }
 }
 for(const receipt of data[4].results){
  const key=String(receipt.message_id)
  if(!reads.has(key))reads.set(key,{read_by_contacts:{},read_by_agents:{}})
  const role=receipt.reader_role==='contact'?'read_by_contacts':receipt.reader_role==='operator'?'read_by_agents':null
  if(role)reads.get(key)![role][String(receipt.reader_id)]=new Date(Number(receipt.read_at)).toISOString()
 }
 const media=new Map<string,any[]>()
 for(const {message_id,...item} of data[3].results){const key=String(message_id);if(!media.has(key))media.set(key,[]);media.get(key)!.push(item)}
 return rows.map(row=>{
  const origin:any=origins.get(String(row.id)),sourceAuthor=origin?JSON.parse(origin.author_json):null
  // The workspace's away reply (away-reply.ts) has no teammate author and is never emailed.
  const agent=row.actor_role==='contact'?null:row.actor_role==='system'?person({id:row.actor_id,name:'Away reply'}):person(agents.get(String(row.actor_id)))
  const attempt:any=mail.get(String(row.id))
  // Keep the durable mail-status precedence, including suppressed development
  // mail and unknown delivery. Reads never ask the provider to do work.
  const emailStatus=origin||row.actor_role==='contact'||row.actor_role==='system'||row.erased_at?null:suppressed?{state:'suppressed'}:attempt?.state?{state:attempt.state,updatedAt:attempt.updated_at}:!configured?{state:'not_configured'}:attempt?.is_enabled===0?{state:'disabled'}:{state:messageNotificationRecipients(recipients.get(String(row.id))||[],attempt?.sender_email?{id:row.actor_id,email:attempt.sender_email}:undefined,row.actor_role).state}
  return {...row,...(reads.get(String(row.id))||{read_by_contacts:{},read_by_agents:{}}),email_status:emailStatus,created_at:iso(row.created_at),source_time_provenance:origin?.time_provenance,source_author:sourceAuthor,bucket_id:row.bucket_id||row.conversation_id,agent:sourceAuthor&&sourceAuthor.role!=='contact'?person({id:row.actor_id,name:sourceAuthor.name||'Imported author'}):agent,agent_id:sourceAuthor&&sourceAuthor.role!=='contact'?row.actor_id:agent?.id,contact_id:row.actor_role==='contact'?row.actor_id:null,contact:row.actor_role==='contact'?person(contacts.get(String(row.actor_id))):null,media:(media.get(String(row.id))||[]).map(m=>({...m,filename_original:m.filename,url:`/api/conversations/${row.conversation_id}/media/${m.id}`,preview_url:`/api/conversations/${row.conversation_id}/media/${m.id}`,aggregate_type:m.content_type.startsWith('image/')?'image':'file'}))}
 })
}
