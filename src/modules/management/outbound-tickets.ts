import {Hono,type Context} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv,Env} from '../../platform/env'
import type {DeferEmailDelivery} from '../integrations/email'
import {requireProject} from '../../platform/auth'
import {admitMessage} from '../conversations/admission'
import {outboundTicketInput,type OutboundTicketInput} from './outbound-ticket-input'
import {previewOutboundNotices,confirmOutboundNotices} from './outbound-notices'
import {logOutboundCall,reserveOutboundTicket} from './outbound-ticket-store'
export type OutboundTicketCommitted=(env:Env,message:Record<string,unknown>,actor:Actor,defer?:DeferEmailDelivery)=>Promise<unknown>
/** Mounted under the native management router. Caller identities never become
 * requester authority: only the current operator can create an outbound ticket. */
export function createOutboundTicketRoutes(onCommittedMessage?:OutboundTicketCommitted){
 const routes=new Hono<AppEnv>()
 async function create(c:Context<AppEnv>,actor:Actor,input:OutboundTicketInput){
  const sessionHash=c.get('sessionHash')
  if(input.kind==='email'&&!onCommittedMessage)throw new HTTPException(503,{message:'Outbound email delivery is unavailable'})
  const reservation=await reserveOutboundTicket(c.env,actor,sessionHash,input),conversation=await c.env.DB.prepare(`SELECT c.* FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1`).bind(reservation.conversationId,actor.projectId).first()
  if(!conversation)throw new HTTPException(409,{message:'Requester is unavailable'})
  if(input.kind==='call'){
   const note=await logOutboundCall(c.env,actor,sessionHash,reservation.conversationId,input.content)
   return {accepted:true,duplicate:reservation.duplicate,conversation,note}
  }
  const result=await admitMessage(c.env,{requireAvailableRequester:true,projectId:actor.projectId,conversationId:reservation.conversationId,actor,sessionHash,localId:input.localId,content:input.content,expectedRevision:0,expectedLastMessageId:null})
  if(!result.accepted)throw new HTTPException(409,{message:'First message admission refused'})
  let generationError:string|undefined
  if(!result.duplicate){
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
  return c.json(result,result.duplicate?200:201)
 })
 routes.post('/projects/:projectId/tickets/notices/preview',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true),preview=await previewOutboundNotices(c.env,actor,c.get('sessionHash'),await c.req.json())
  return c.json({recipients:preview.recipients,confirmation:preview.confirmation})
 })
 routes.post('/projects/:projectId/tickets/notices',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true),inputs=await confirmOutboundNotices(c.env,actor,c.get('sessionHash'),await c.req.json()),results=[]
  for(const input of inputs){
   try{results.push({recipient:input.requesterEmail,...await create(c,actor,input)})}
   catch(error){results.push({recipient:input.requesterEmail,accepted:false,error:error instanceof HTTPException?error.message:'Result unknown; check the same request before creating another batch'})}
  }
  return c.json({results})
 })
 return routes
}
