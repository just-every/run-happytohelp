import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {applyMessageEffects} from '../../message-effects'
import {createNote} from '../collaboration/notes'
import {mutateTicket} from '../tickets/mutate'
import {ticketAuthority} from '../tickets/model'
import {frontierGuard,loadFrontier} from './frontier'
import {stillAuthorized,type MobileAuthority} from './authority'

export function objectBody(value:unknown):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))throw new HTTPException(400,{message:'Provide an object'});return value as Record<string,any>}
function commandId(value:unknown){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,80}$/.test(value))throw new HTTPException(400,{message:'Provide a stable localId of up to 80 letters, digits, underscores or hyphens'});return value}
export async function mobileReply(env:Env,a:MobileAuthority,ticketId:string,body:Record<string,any>){
 const localId=`mobile:${a.device.id}:${commandId(body.localId)}`,f=await loadFrontier(env,a,ticketId,body.frontier),fresh=frontierGuard(a,f)
 if(typeof body.content!=='string'||body.content.length>100000||body.resolve!==undefined&&typeof body.resolve!=='boolean'||body.mediaIds!==undefined&&(!Array.isArray(body.mediaIds)||body.mediaIds.length>20||body.mediaIds.some((id:unknown)=>typeof id!=='string')))throw new HTTPException(400,{message:'Invalid reply'})
 if(!body.content.trim()&&!body.mediaIds?.length)throw new HTTPException(400,{message:'Enter a reply or attach a file'})
 // Exact replay returns its existing receipt even after this reply advanced the
 // frontier. It never creates a second message or replays effects. A changed
 // command with the same ID is rejected by native admission's intent hash.
 const guard=await ticketAuthority(env,a.actor,{sessionHash:a.device.parent_session_hash,guard:a.guard},'conversations.reply')
 const result=await admitMessage(env,{actor:a.actor,projectId:a.actor.projectId,conversationId:ticketId,
  localId,content:body.content,mediaIds:body.mediaIds,resolve:body.resolve===true,
  expectedRevision:f.revision,expectedLastMessageId:f.last_message_id,sessionHash:a.device.parent_session_hash,
  requireAvailableRequester:true,
  authoring:body.authoring??{kind:'human'},
  [messageAuthority]:{sql:`EXISTS(${guard.sql}) AND ((${fresh.sql}) OR EXISTS(SELECT 1 FROM messages replay WHERE replay.conversation_id=? AND replay.project_id=? AND replay.local_id=? AND replay.actor_id=? AND replay.erased_at IS NULL))`,args:[...guard.params,...fresh.params,ticketId,a.actor.projectId,localId,a.actor.id]},
 })
 if(result.accepted&&!result.duplicate){
  // Native outbox recovery owns uncertain external effects; no automatic resend.
  try{await applyMessageEffects(env,result.message,a.actor)}catch{return {status:202 as const,data:{accepted:true,messageId:result.message.id,effects:'unconfirmed',replay:false}}}
 }
 await stillAuthorized(env,a)
 return {status:result.accepted?200 as const:409 as const,data:{accepted:result.accepted,duplicate:result.duplicate??false,messageId:result.message?.id,...(result.reason?{reason:result.reason}:{}),...(!result.accepted?{refresh:true}:{})}}
}

/** Notes and assignments claim a stable command before effects. An interrupted
 * claim stays uncertain and requires readback, never an automatic second attempt. */
export async function mobileChange(env:Env,a:MobileAuthority,ticketId:string,kind:'note'|'assign',body:Record<string,any>){
 const localId=commandId(body.localId),f=await loadFrontier(env,a,ticketId,body.frontier),guard=frontierGuard(a,f)
 const change=kind==='note'?{content:body.content,media_ids:body.mediaIds??[]}: {agent_id:body.assignee}
 if(kind==='note'&&(typeof body.content!=='string'||!body.content.trim()||body.content.length>50000)||kind==='assign'&&body.assignee!==null&&typeof body.assignee!=='string')throw new HTTPException(400,{message:'Invalid ticket change'})
 const intent=await hashToken(JSON.stringify({kind,ticketId,frontier:f.id,change}))
 const previous=await env.DB.prepare('SELECT * FROM mobile_commands WHERE device_id=? AND local_id=?').bind(a.device.id,localId).first<any>()
 if(previous){await stillAuthorized(env,a);if(previous.intent_hash!==intent)throw new HTTPException(409,{message:'This localId belongs to another command'});return {status:previous.state==='complete'?200 as const:409 as const,data:{state:previous.state,resourceId:previous.resource_id,duplicate:true,replay:false}}}
 const claim=await env.DB.prepare(`INSERT OR IGNORE INTO mobile_commands(device_id,local_id,conversation_id,intent_hash,state,created_at) SELECT ?,?,?,?,'uncertain',? WHERE ${guard.sql}`).bind(a.device.id,localId,ticketId,intent,Date.now(),...guard.params).run()
 if(!claim.meta.changes)throw new HTTPException(409,{message:'Ticket or authority changed. Refresh before continuing.'})
 const authority={sessionHash:a.device.parent_session_hash,guard,source:'api' as const}
 let resourceId:string
 try{
  if(kind==='note')resourceId=(await createNote(env,a.actor,ticketId,change,authority)).id
  else{await mutateTicket(env,a.actor,ticketId,{...change,expected_revision:f.revision,expected_ticket_version:f.ticket_version,expected_last_message_id:f.last_message_id},authority);resourceId=ticketId}
 }catch(error){
  // A native committed-but-refresh-failed outcome remains uncertain, as does a
  // lost D1 response; only explicit pre-commit input/authority refusals settle.
  if(error instanceof HTTPException&&[400,401,403,404,409].includes(error.status))await env.DB.prepare("UPDATE mobile_commands SET state='refused' WHERE device_id=? AND local_id=?").bind(a.device.id,localId).run()
  throw error
 }
 await env.DB.prepare("UPDATE mobile_commands SET state='complete',resource_id=? WHERE device_id=? AND local_id=?").bind(resourceId,a.device.id,localId).run()
 await stillAuthorized(env,a)
 return {status:201 as const,data:{state:'complete',resourceId,duplicate:false,replay:false}}
}
