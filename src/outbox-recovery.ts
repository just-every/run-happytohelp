import type {Actor,Env,Job} from './platform/env'
import {cronRoom,CronDeferred} from './platform/cron-budget'
import {notificationContactsSql} from './modules/integrations/notification-contacts'
import {applyMessageEffects} from './message-effects'
import {openRerMailHold} from './modules/integrations/rer-mail-hold'
const RETRY_MS=60*60*1000
const liveProject="EXISTS(SELECT 1 FROM projects p WHERE p.id=o.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=o.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)"
// The estimate selects the same proven audience as R4. Human replies may honour
// all collected participant addresses; arbitrary inbound Cc headers cannot.
const audience=`(SELECT count(*) FROM (${notificationContactsSql} WHERE c.id=t.id AND c.project_id=t.project_id) recipient WHERE notice_eligible=1 OR (m.actor_role IN ('owner','admin','operator') AND EXISTS(SELECT 1 FROM users WHERE id=m.actor_id))) effect_contacts,
 (SELECT count(*) FROM conversation_followers WHERE conversation_id=t.id)+(SELECT count(*) FROM ticket_group_members WHERE project_id=t.project_id AND group_id=t.group_id)+CASE WHEN t.assigned_to IS NOT NULL THEN 1 ELSE 0 END effect_teammates`
type Message=Record<string,unknown>&{outbox_id:number;id:string;conversation_id:string;effect_contacts:number;effect_teammates:number;queue_only?:number}
type Page={project_id:string;conversation_id:string;last_id:number}
function job(projectId:string,message:Message):Job{return {type:'outbox.recover',id:message.id,projectId,conversationId:message.conversation_id,outboxId:message.outbox_id}}
async function effects(env:Env,projectId:string,message:Message){
 const actor:Actor={id:String(message.actor_id),projectId,role:message.actor_role==='contact'?'contact':'operator',...(message.actor_role==='contact'?{contactId:String(message.actor_id)}:{})}
 // Fixed effects and one requester fit 120; an additional customer can earn a
 // notice and a relay (80), each teammate one notice (30). Completion stays back.
 const statements=120+80*Math.max(0,Number(message.effect_contacts)-1)+30*Number(message.effect_teammates)
 if(!cronRoom(env,statements+1))throw new CronDeferred()
 // Journal recovery owns workflow credit; delivery jobs never add rule attempts.
 try{await applyMessageEffects(env,message,actor,undefined,{workflow:false})}catch(error){
  if(error instanceof CronDeferred||error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'||Date.now()-Number(message.created_at)<=RETRY_MS)throw error
  console.error('Message follow-up abandoned',message.id)
 }
}
async function complete(env:Env,projectId:string,conversationId:string,done:Message[]){
 if(!done.length)return true
 const sent=await Promise.all([conversationId,`project:${projectId}`].map(key=>env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'})))
 if(!sent.every(result=>result.ok))return false
 // A held managed notification keeps its message here until replay resends it.
 await env.DB.prepare(`UPDATE conversation_outbox SET delivered_at=? WHERE project_id=? AND conversation_id=? AND id IN (${done.map(()=>'?').join(',')}) AND delivered_at IS NULL AND NOT ${openRerMailHold}`).bind(Date.now(),projectId,conversationId,...done.map(m=>m.outbox_id)).run()
 return true
}
/** Small effects finish in cron. Every deferred message has its own durable job,
 * so a failing message cannot hold later messages in the same conversation. */
export async function dispatchOutbox(env:Env){
 const pending=await env.DB.prepare("SELECT project_id,conversation_id,MAX(id) last_id FROM conversation_outbox WHERE delivered_at IS NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=conversation_outbox.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=conversation_outbox.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) GROUP BY project_id,conversation_id ORDER BY MIN(created_at),conversation_id LIMIT 100").all<{project_id:string;conversation_id:string;last_id:number}>()
 for(const row of pending.results){
  // Every selected conversation gets a turn even when the read no longer fits.
  // The queue expands its durable page into independent message jobs.
  if(!cronRoom(env,2)){
   try{await env.JOBS.send({type:'outbox.page',id:row.conversation_id,projectId:row.project_id,lastId:row.last_id})}catch{console.error('Outbox page dispatch pending')}
   continue
  }
  const messages=(await env.DB.prepare(`SELECT o.id outbox_id,m.*,${audience},
   EXISTS(SELECT 1 FROM operator_ticket_commands command WHERE command.conversation_id=o.conversation_id AND command.project_id=o.project_id AND command.local_id=m.local_id) queue_only
   FROM conversation_outbox o JOIN messages m ON m.id=o.message_id JOIN conversations t ON t.id=o.conversation_id AND t.project_id=o.project_id WHERE o.project_id=? AND o.conversation_id=? AND o.id<=? AND o.delivered_at IS NULL AND ${liveProject} ORDER BY o.id LIMIT 90`).bind(row.project_id,row.conversation_id,row.last_id).all<Message>()).results
  const done:Message[]=[],queued:Message[]=[]
  for(const message of messages){
   // Operator-created first messages recover in their own queue invocations,
   // including lost notice enqueues. Cron must not execute sibling sends inline.
   if(message.queue_only){queued.push(message);continue}
   try{await effects(env,row.project_id,message);done.push(message)}catch(error){if(!(error instanceof CronDeferred))console.error('Message follow-up pending',message.id);queued.push(message)}
  }
  try{if(!await complete(env,row.project_id,row.conversation_id,done))queued.push(...done)}catch{queued.push(...done);console.error('Outbox completion pending')}
  if(queued.length)try{await env.JOBS.sendBatch(queued.map(message=>({body:job(row.project_id,message)})))}catch{console.error('Outbox queue dispatch pending')}
 }
}
export async function recoverOutboxPage(env:Env,row:Page){
 const messages=(await env.DB.prepare(`SELECT o.id outbox_id,m.id,m.conversation_id FROM conversation_outbox o JOIN messages m ON m.id=o.message_id WHERE o.project_id=? AND o.conversation_id=? AND o.id<=? AND o.delivered_at IS NULL AND ${liveProject} ORDER BY o.id LIMIT 90`).bind(row.project_id,row.conversation_id,row.last_id).all<Message>()).results
 if(messages.length)await env.JOBS.sendBatch(messages.map(message=>({body:job(row.project_id,message)})))
}
/** Queue invocations reconcile one exact persisted message, never a reconstructed
 * send. The outbox remains pending until effects and both broadcasts complete. */
export async function recoverOutbox(env:Env,projectId:string,conversationId:string,outboxId:number,messageId:string){
 const message=await env.DB.prepare(`SELECT o.id outbox_id,m.*,0 effect_contacts,0 effect_teammates FROM conversation_outbox o JOIN messages m ON m.id=o.message_id WHERE o.project_id=? AND o.conversation_id=? AND o.id=? AND o.message_id=? AND o.delivered_at IS NULL AND ${liveProject}`).bind(projectId,conversationId,outboxId,messageId).first<Message>()
 if(!message)return
 await effects(env,projectId,message)
 if(!await complete(env,projectId,conversationId,[message]))throw new Error('Message broadcast pending')
}
