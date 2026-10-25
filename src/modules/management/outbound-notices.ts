import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {ticketAuthority} from '../tickets/model'
import {outboundNoticeInputs} from './outbound-ticket-input'

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
/** The existing audit journal freezes the batch identity before the first ticket.
 * A changed recipient set cannot append new sends to a retried command. */
export async function confirmOutboundNotices(env:Env,actor:Actor,sessionHash:string,body:Record<string,unknown>){
 const inputs=outboundNoticeInputs(body),fingerprint=await hashToken(JSON.stringify(inputs))
 const guard=await ticketAuthority(env,actor,{sessionHash,source:'dashboard'},'conversations.reply')
 const id=`outbound-notice:${await hashToken(JSON.stringify([actor.projectId,actor.id,inputs[0].localId]))}`
 const recorded=await env.DB.prepare('SELECT detail_json FROM audit_events WHERE id=? AND project_id=?').bind(id,actor.projectId).first<{detail_json:string}>()
 if(recorded){
  if(JSON.parse(recorded.detail_json).fingerprint!==fingerprint)throw new HTTPException(409,{message:'Notice command conflicts with its earlier confirmation'})
 }else{
  // Only this pre-commit refusal certifies no creation. A lost response from a
  // previously confirmed batch must keep its immutable identity, even on relogin.
  try{
   const preview=await previewOutboundNotices(env,actor,sessionHash,body)
   if(body.confirmation!==preview.confirmation)throw new HTTPException(409,{message:'Preview these exact recipients and message before sending'})
  }catch(error){
   if(error instanceof HTTPException&&error.status<500)throw new HTTPException(error.status,{res:Response.json({error:error.message,code:'notice_not_created'},{status:error.status})})
   throw error
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
   SELECT ?,?,?,'data','ticket.notice_confirmed','succeeded','user',?,'dashboard','notice_batch',?,? WHERE EXISTS(${guard.sql})`).bind(id,actor.projectId,Date.now(),actor.id,id,JSON.stringify({fingerprint}),...guard.params).run()
  const saved=await env.DB.prepare('SELECT detail_json FROM audit_events WHERE id=? AND project_id=?').bind(id,actor.projectId).first<{detail_json:string}>()
  if(!saved||JSON.parse(saved.detail_json).fingerprint!==fingerprint)throw new HTTPException(409,{message:'Notice command conflicts with its earlier confirmation'})
 }
 return Promise.all(inputs.map(async input=>({...input,localId:`notice-${await hashToken(JSON.stringify([id,input.requesterEmail]))}`})))
}
