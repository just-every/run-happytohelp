import {notificationContactsSql} from './modules/integrations/notification-contacts'
import type {Actor,Env} from './platform/env'
import {cronRoom,cronRequire,CronDeferred,inCron} from './platform/cron-budget'
import {isProjectActive} from './platform/project-status'
import {applyMessageEffects} from './message-effects'
const RETRY_MS=60*60*1000
/** Effects can fan out to many recipients. The persisted outbox is the queue's
 * replay fence. Small effects use available cron room; a conversation whose
 * fanout does not fit gets a queue invocation. A failed queue send leaves it
 * pending for the next tick. */
export async function dispatchOutbox(env:Env){
 if(!cronRoom(env,2))return
 const pending=await env.DB.prepare("SELECT project_id,conversation_id,MAX(id) last_id FROM conversation_outbox WHERE delivered_at IS NULL AND EXISTS(SELECT 1 FROM projects p WHERE p.id=conversation_outbox.project_id) AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=conversation_outbox.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL) GROUP BY project_id,conversation_id ORDER BY MIN(created_at),conversation_id LIMIT 100").all<{project_id:string;conversation_id:string;last_id:number}>()
 for(const row of pending.results){
  let more=true
  for(let count=0;count<90&&cronRoom(env,130);count++){
   try{more=await recoverOutbox(env,row.project_id,row.conversation_id,row.last_id)}catch(error){if(!(error instanceof CronDeferred))console.error('Outbox effect pending');break}
   if(!more)break
  }
  if(more)try{await env.JOBS.send({type:'outbox.recover',projectId:row.project_id,id:row.conversation_id,until:row.last_id})}catch{console.error('Outbox queue dispatch pending')}
 }
}
export async function recoverOutbox(env:Env,projectId:string,conversationId:string,until?:number){
 if(!await isProjectActive(env,projectId))return false
 const messages=await env.DB.prepare('SELECT o.id outbox_id,m.* FROM conversation_outbox o JOIN messages m ON m.id=o.message_id WHERE o.project_id=? AND o.conversation_id=? AND o.delivered_at IS NULL AND (? IS NULL OR o.id<=?) ORDER BY o.id LIMIT 1').bind(projectId,conversationId,until??null,until??null).all<Record<string,unknown>>()
 for(const message of messages.results){
  const actor:Actor={id:String(message.actor_id),projectId,role:message.actor_role==='contact'?'contact':'operator',...(message.actor_role==='contact'?{contactId:String(message.actor_id)}:{})}
  let statements=0
  if(inCron(env)){
   const audience=await env.DB.prepare(`SELECT
    (SELECT count(*) FROM (${notificationContactsSql} WHERE c.id=? AND c.project_id=?) recipient
     WHERE notice_eligible=1 OR (? AND EXISTS(SELECT 1 FROM users WHERE id=?))) contacts,
    (SELECT count(*) FROM conversation_followers WHERE conversation_id=t.id)+
    (SELECT count(*) FROM ticket_group_members WHERE project_id=t.project_id AND group_id=t.group_id)+
    CASE WHEN t.assigned_to IS NOT NULL THEN 1 ELSE 0 END teammates
    FROM conversations t WHERE t.id=? AND t.project_id=?`).bind(conversationId,projectId,['owner','admin','operator'].includes(String(message.actor_role))?1:0,message.actor_id,conversationId,projectId).first<{contacts:number;teammates:number}>()
   // One requester/relay and the fixed follow-ups fit 120; each additional
   // customer can earn a notice and a relay (80), each teammate one notice (30).
   // Automatic effects use R4's proven audience, never arbitrary Cc headers.
   statements=120+80*Math.max(0,Number(audience?.contacts??0)-1)+30*Number(audience?.teammates??0)
   cronRequire(env,statements+3)
  }
  try{await applyMessageEffects(env,message,actor,undefined,{statements})}catch(error){
   // Running out of invocation room is always a deferral, even for an old row.
   if(error instanceof CronDeferred||error instanceof Error&&error.message==='WORKER_D1_STATEMENT_LIMIT'||Date.now()-Number(message.created_at)<=RETRY_MS)throw error
   console.error('Message follow-up abandoned',String(message.id))
  }
  if(!cronRoom(env,3))throw new CronDeferred()
  const sent=await Promise.all([conversationId,`project:${projectId}`].map(key=>env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(key)).fetch('https://conversation.internal/broadcast',{method:'POST'})))
  if(!sent.every(result=>result.ok))throw new Error('Message broadcast pending')
  await env.DB.prepare('UPDATE conversation_outbox SET delivered_at=? WHERE id=? AND project_id=? AND conversation_id=? AND delivered_at IS NULL').bind(Date.now(),message.outbox_id,projectId,conversationId).run()
  if(!inCron(env)&&await env.DB.prepare('SELECT 1 FROM conversation_outbox WHERE project_id=? AND conversation_id=? AND delivered_at IS NULL AND (? IS NULL OR id<=?) LIMIT 1').bind(projectId,conversationId,until??null,until??null).first())await env.JOBS.send({type:'outbox.recover',projectId,id:conversationId,until})
 }
 return messages.results.length>0
}
