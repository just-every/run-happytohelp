import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv,Env} from '../../platform/env'
import type {DeferEmailDelivery} from '../integrations/email'
import {requestRoom} from '../integrations/notification-budget'
import {requireProject} from '../../platform/auth'
import {admitMessage,messageCommitStatements} from '../conversations/admission'
import {noticeCommand,outboundTicketInput,type OutboundTicketInput} from './outbound-ticket-input'
import {previewOutboundNotices,confirmOutboundNotices} from './outbound-notices'
import {logOutboundCall,reserveOutboundTicket} from './outbound-ticket-store'
export type OutboundTicketCommitted=(env:Env,message:Record<string,unknown>,actor:Actor,defer?:DeferEmailDelivery)=>Promise<unknown>
/** Mounted under the native management router. Caller identities never become
 * requester authority: only the current operator can create an outbound ticket. */
export function createOutboundTicketRoutes(onCommittedMessage?:OutboundTicketCommitted){
 const routes=new Hono<AppEnv>()
 async function create(c:Context<AppEnv>,actor:Actor,input:OutboundTicketInput,notice=false){
  const sessionHash=c.get('sessionHash')
  if(input.kind==='email'&&!onCommittedMessage)throw new HTTPException(503,{message:'Outbound email delivery is unavailable'})
  const reservation=await reserveOutboundTicket(c.env,actor,sessionHash,input),conversation=await c.env.DB.prepare(`SELECT c.* FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1`).bind(reservation.conversationId,actor.projectId).first()
  if(!conversation)throw new HTTPException(409,{message:'Requester is unavailable'})
  if(input.kind==='call'){
   const note=await logOutboundCall(c.env,actor,sessionHash,reservation.conversationId,input.content)
   return {accepted:true,duplicate:reservation.duplicate,conversation,note}
  }
  const result=await admitMessage(c.env,{requireAvailableRequester:true,projectId:actor.projectId,conversationId:reservation.conversationId,actor,sessionHash,localId:input.localId,content:input.content,expectedRevision:0,expectedLastMessageId:null,...(input[noticeCommand]?{[messageCommitStatements]:(messageId:string)=>[c.env.DB.prepare(`UPDATE outbound_notice_commands SET receipts_json=json_set(receipts_json,?,?) WHERE project_id=? AND id=? AND outcome='succeeded' AND EXISTS(SELECT 1 FROM conversation_outbox WHERE project_id=? AND conversation_id=? AND message_id=?)`).bind(`$."${input.localId}".messageId`,messageId,actor.projectId,input[noticeCommand],actor.projectId,reservation.conversationId,messageId)]}:{})})
  if(!result.accepted)return {...result,conversation}
  let generationError:string|undefined
  if(notice){
   // Admission and outbox are atomic. Provider work gets its own invocation,
   // never the dwindling capacity of a multi-requester HTTP request.
   const outbox=await c.env.DB.prepare('SELECT id FROM conversation_outbox WHERE project_id=? AND conversation_id=? AND message_id=?').bind(actor.projectId,reservation.conversationId,result.message!.id).first<{id:number}>()
   if(outbox)try{await c.env.JOBS.send({type:'outbox.recover',id:String(result.message!.id),projectId:actor.projectId,conversationId:reservation.conversationId,outboxId:outbox.id})}catch{console.error('Notice remains on durable outbox for scheduled recovery')}
  }else if(!result.duplicate){
   const defer:DeferEmailDelivery=delivery=>c.executionCtx.waitUntil(delivery.catch(()=>{console.error('Outbound ticket email failed; durable delivery status retained')}))
   try{await onCommittedMessage!(c.env,result.message!,actor,defer)}catch(error){generationError=error instanceof Error?error.message:String(error)}
  }
  const current=await c.env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(reservation.conversationId,actor.projectId).first()
  return {...result,conversation:current,...(generationError?{generationError}:{})}
 }
 routes.post('/projects/:projectId/tickets',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true),body=await c.req.json()
  if(body.requesters!==undefined)throw new HTTPException(400,{message:'Use the service notice preview before sending to several requesters'})
  const result=await create(c,actor,outboundTicketInput(body))
  return c.json(result,!result.accepted?409:result.duplicate?200:201)
 })
 routes.post('/projects/:projectId/tickets/notices/preview',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true),preview=await previewOutboundNotices(c.env,actor,c.get('sessionHash'),await c.req.json())
  return c.json({recipients:preview.recipients,confirmation:preview.confirmation})
 })
 routes.post('/projects/:projectId/tickets/notices',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true),inputs=await confirmOutboundNotices(c.env,actor,c.get('sessionHash'),await c.req.json()),results=[]
  // Read completed admissions once. Replaying a long prefix must never starve
  // its remaining rows; every retry still rechecks the current route authority.
  const saved=(await c.env.DB.prepare(`SELECT cmd.local_id,m.id AS admitted_message_id,c.* FROM operator_ticket_commands cmd JOIN conversations c ON c.id=cmd.conversation_id AND c.project_id=cmd.project_id LEFT JOIN messages m ON m.conversation_id=c.id AND m.project_id=c.project_id AND m.local_id=cmd.local_id WHERE EXISTS(SELECT 1 FROM contacts ct WHERE ct.id=c.contact_id AND ct.project_id=c.project_id AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1) AND cmd.project_id=? AND cmd.actor_id=? AND cmd.local_id IN (SELECT value FROM json_each(?))`).bind(actor.projectId,actor.id,JSON.stringify(inputs.map(input=>input.localId))).all<any>()).results
  const reserved=new Map(saved.map(({local_id,admitted_message_id,...conversation})=>[local_id,conversation]))
  const completed=new Map(saved.filter(row=>row.admitted_message_id).map(({local_id,admitted_message_id,...conversation})=>[local_id,conversation]))
  for(const input of inputs){
   if(completed.has(input.localId)){results.push({recipient:input.requesterEmail,accepted:true,duplicate:true,conversation:completed.get(input.localId)});continue}
   // One admission (no workflow/provider effects) plus queue dispatch and receipt
   // fits 128 statements. The shared meter includes auth, preview and response.
   if(requestRoom(c.env)<128){results.push({recipient:input.requesterEmail,accepted:false,code:'request_capacity',error:'Not created yet. Continue this same request to create the remaining tickets.'});continue}
   try{results.push({recipient:input.requesterEmail,...await create(c,actor,input,true)})}
   catch(error){results.push({recipient:input.requesterEmail,accepted:false,...(reserved.has(input.localId)?{conversation:reserved.get(input.localId)}:{}),error:error instanceof HTTPException?error.message:'Result unknown; check the same request before creating another batch'})}
  }
  return c.json({results})
 })
 return routes
}
