import {ticketAuthority} from '../tickets/model'
import {livePortalContact} from '../portal/identity'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {Actor,AppEnv,Env} from '../../platform/env'
import type {DeferEmailDelivery} from '../integrations/email'
import {requireProject} from '../../platform/auth'
import {admitMessage,messageAuthority} from '../conversations/admission'
import type {OutboundTicketInput} from './outbound-ticket-input'
import {serviceNoticeRoutes} from './service-notices'
import {outboundTicketInput} from './outbound-ticket-input'
import {logOutboundCall,reserveOutboundTicket} from './outbound-ticket-store'
export type OutboundTicketCommitted=(env:Env,message:Record<string,unknown>,actor:Actor,defer?:DeferEmailDelivery)=>Promise<unknown>
/** Mounted under the native management router. Caller identities never become
 * requester authority: only the current operator can create an outbound ticket. */
export function createOutboundTicketRoutes(onCommittedMessage?:OutboundTicketCommitted){
 const routes=new Hono<AppEnv>()
 routes.route('/',serviceNoticeRoutes(onCommittedMessage))
 routes.get('/projects/:projectId/tickets/requesters',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true);await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply')
  const search=c.req.query('search')??'';if(search.length>200)throw new HTTPException(400,{message:'Search is too long'})
  const rows=await c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email,json_extract(ct.metadata_json,'$.phone') phone FROM contacts ct WHERE ct.project_id=? AND ${livePortalContact()} AND (instr(lower(coalesce(ct.name,'')),lower(?))>0 OR instr(lower(coalesce(ct.email,'')),lower(?))>0 OR instr(coalesce(json_extract(ct.metadata_json,'$.phone'),''),?)>0) ORDER BY ct.name,ct.email,ct.id LIMIT 20`).bind(actor.projectId,search,search,search).all()
  return c.json({data:rows.results})
 })
 routes.post('/projects/:projectId/tickets',async c=>{
  const actor=await requireProject(c,c.req.param('projectId'),true),input=outboundTicketInput(await c.req.json()),sessionHash=c.get('sessionHash')
  const result=await createOutboundTicket(c.env,actor,sessionHash,input,onCommittedMessage,delivery=>c.executionCtx.waitUntil(delivery))
  return c.json(result,result.duplicate?200:201)
 })
 return routes
}

export async function createOutboundTicket(env:Env,actor:Actor,sessionHash:string,input:OutboundTicketInput,onCommittedMessage:OutboundTicketCommitted|undefined,waitUntil:DeferEmailDelivery,additional?:{sql:string;params:unknown[];noticeId:string}){
  if(input.kind==='email'&&!onCommittedMessage)throw new HTTPException(503,{message:'Outbound email delivery is unavailable'})
  if(input.kind==='call'||input.configuration?.internal)await ticketAuthority(env,actor,{sessionHash},'conversations.notes')
  const reservation=await reserveOutboundTicket(env,actor,sessionHash,input,additional),conversation=await env.DB.prepare(`SELECT c.* FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1`).bind(reservation.conversationId,actor.projectId).first()
  if(!conversation)throw new HTTPException(409,{message:'Requester is unavailable'})
  if(input.kind==='call'||input.configuration?.internal){
   const note=await logOutboundCall(env,actor,sessionHash,reservation.conversationId,input.content)
   return {accepted:true,duplicate:reservation.duplicate,conversation,note}
  }
  const result=await admitMessage(env,{requireAvailableRequester:true,projectId:actor.projectId,conversationId:reservation.conversationId,actor,sessionHash,localId:input.localId,content:input.content,expectedRevision:0,expectedLastMessageId:null,...(additional?{[messageAuthority]:{sql:additional.sql,args:additional.params}}:{})})
  if(!result.accepted)throw new HTTPException(409,{message:'First-message admission changed. Reload before retrying.'})
  let generationError:string|undefined
  if(!result.duplicate){
   const defer:DeferEmailDelivery=delivery=>waitUntil(delivery.catch(()=>{console.error('Outbound ticket email failed; durable delivery status retained')}))
   try{await onCommittedMessage!(env,result.message!,actor,defer)}catch(error){generationError=error instanceof Error?error.message:String(error)}
  }
  const current=await env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(reservation.conversationId,actor.projectId).first()
  return {...result,conversation:current,...(generationError?{generationError}:{})}
}
