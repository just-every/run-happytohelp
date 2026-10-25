import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {ticketAuthority} from '../tickets/model'
import {noticeCommand,outboundNoticeInputs} from './outbound-ticket-input'

/** Preview has no writes or mail effects. Its receipt is bound to this session,
 * exact command and current recipient eligibility, not a client-supplied list. */
export async function previewOutboundNotices(env:Env,actor:Actor,sessionHash:string,body:Record<string,unknown>){
 await ticketAuthority(env,actor,{sessionHash,source:'dashboard'},'conversations.reply')
 const inputs=outboundNoticeInputs(body)
 for(const input of inputs){
  const rows=(await env.DB.prepare('SELECT metadata_json FROM contacts WHERE project_id=? AND lower(email)=? LIMIT 2').bind(actor.projectId,input.requesterEmail).all<{metadata_json:string}>()).results
  if(rows.length>1)throw new HTTPException(409,{message:'A requester email matches several contacts; resolve their identity before previewing'})
  const flags=JSON.parse(rows[0]?.metadata_json??'{}')
  if(['is_erasing','is_erased','is_deleted','is_blocked'].some(key=>flags[key])||flags.portal_notification_emails===0)throw new HTTPException(409,{message:`Service notice refused for ${input.requesterEmail}: requester unavailable or email notices disabled`})
 }
 const fingerprint=await hashToken(JSON.stringify(inputs)),confirmation=await hashToken(JSON.stringify([sessionHash,actor.projectId,actor.id,fingerprint]))
 return {inputs,fingerprint,confirmation,recipients:inputs.map(input=>input.requesterEmail!)}
}
/** Reserve an immutable command independently of the disposable audit history.
 * Ticket and outbox admission update its recovery identities in their own batches. */
export async function confirmOutboundNotices(env:Env,actor:Actor,sessionHash:string,body:Record<string,unknown>){
 const inputs=outboundNoticeInputs(body),fingerprint=await hashToken(JSON.stringify(inputs)),intentKey=await hashToken(inputs[0].localId)
 const guard=await ticketAuthority(env,actor,{sessionHash,source:'dashboard'},'conversations.reply')
 const id=`outbound-notice:${await hashToken(JSON.stringify([actor.projectId,actor.id,inputs[0].localId]))}`
 const notCreated=(message:string)=>new HTTPException(409,{res:Response.json({error:message,code:'notice_not_created'},{status:409})})
 const recorded=await env.DB.prepare('SELECT detail_json,outcome,actor_id FROM outbound_notice_commands WHERE project_id=? AND (id=? OR intent_key=?)').bind(actor.projectId,id,intentKey).first<{detail_json:string;outcome:string;actor_id:string}>()
 if(recorded){
  if(recorded.actor_id!==actor.id||JSON.parse(recorded.detail_json).fingerprint!==fingerprint)throw new HTTPException(409,{message:'Notice command conflicts with its earlier confirmation'})
  if(recorded.outcome==='refused')throw notCreated(JSON.parse(recorded.detail_json).error||'This notice was refused before any tickets were created')
 }else{
  // Invalid/missing review tokens do not freeze a command. A valid confirmation
  // that loses eligibility records an immutable refusal against this same key.
  // Concurrent confirmation can win OR refusal can win, never both.
  const confirmation=await hashToken(JSON.stringify([sessionHash,actor.projectId,actor.id,fingerprint]))
  if(body.confirmation!==confirmation)throw new HTTPException(409,{message:'Preview these exact recipients and message before sending'})
  try{
   await previewOutboundNotices(env,actor,sessionHash,body)
  }catch(error){
   if(error instanceof HTTPException&&error.status<500){
    await env.DB.prepare(`INSERT OR IGNORE INTO outbound_notice_commands(id,project_id,created_at,outcome,actor_id,intent_key,detail_json)
     SELECT ?,?,?,'refused',?,?,? WHERE EXISTS(${guard.sql})`).bind(id,actor.projectId,Date.now(),actor.id,intentKey,JSON.stringify({fingerprint,error:'This notice was refused before any tickets were created'}),...guard.params).run()
    const refused=await env.DB.prepare('SELECT detail_json,outcome,actor_id FROM outbound_notice_commands WHERE project_id=? AND (id=? OR intent_key=?)').bind(actor.projectId,id,intentKey).first<{detail_json:string;outcome:string;actor_id:string}>()
    if(refused?.actor_id===actor.id&&refused.outcome==='refused'&&JSON.parse(refused.detail_json).fingerprint===fingerprint)throw notCreated(error.message)
   }
   throw error
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO outbound_notice_commands(id,project_id,created_at,outcome,actor_id,intent_key,detail_json)
   SELECT ?,?,?,'succeeded',?,?,? WHERE EXISTS(${guard.sql})`).bind(id,actor.projectId,Date.now(),actor.id,intentKey,JSON.stringify({fingerprint}),...guard.params).run()
  const saved=await env.DB.prepare('SELECT detail_json,outcome,actor_id FROM outbound_notice_commands WHERE project_id=? AND (id=? OR intent_key=?)').bind(actor.projectId,id,intentKey).first<{detail_json:string;outcome:string;actor_id:string}>()
  if(!saved||saved.actor_id!==actor.id||JSON.parse(saved.detail_json).fingerprint!==fingerprint)throw new HTTPException(409,{message:'Notice command conflicts with its earlier confirmation'})
  if(saved.outcome==='refused')throw notCreated(JSON.parse(saved.detail_json).error||'This notice was refused before any tickets were created')
 }
 return Promise.all(inputs.map(async input=>({...input,[noticeCommand]:id,localId:`notice-${await hashToken(JSON.stringify([id,input.requesterEmail]))}`})))
}
