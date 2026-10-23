import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject,hashToken} from '../../platform/auth'
import {ticketAuthority,object} from '../tickets/model'
import {livePortalContact} from '../portal/identity'
import {enforceRateLimits} from '../../platform/rate-limits'
import {outboundTicketInput,type OutboundTicketInput} from './outbound-ticket-input'
import {outboundConfiguration} from './outbound-ticket-configuration'
import {createOutboundTicket,type OutboundTicketCommitted} from './outbound-tickets'

const base='/projects/:projectId/service-notices'
export function serviceNoticeRoutes(onCommittedMessage?:OutboundTicketCommitted){
 const routes=new Hono<AppEnv>()
 routes.post(base+'/preview',async c=>{
  const actor=await requireProject(c,c.req.param('projectId')!,true),authority=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply'),body=object(await c.req.json()),ids=body.requesterIds
  if(body.purpose!=='service')throw new HTTPException(400,{message:'Service notices are only for existing customer support, never marketing'})
  if(!Array.isArray(ids)||!ids.length||ids.length>10||ids.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(ids).size!==ids.length)throw new HTTPException(400,{message:'Select one to ten unique requesters'})
  const ticket=outboundTicketInput({...object(body.ticket),kind:'email',localId:body.localId,requesterId:'preview'})
  if(ticket.cc.length||ticket.bcc.length||ticket.configuration?.internal)throw new HTTPException(400,{message:'Service notices send one public ticket per requester without copies'})
  await outboundConfiguration(c.env,actor,ticket,authority.access)
  const intent=await hashToken(JSON.stringify({ticket,ids:[...ids].sort()})),prior=await c.env.DB.prepare('SELECT * FROM operator_service_notices WHERE project_id=? AND actor_id=? AND local_id=?').bind(actor.projectId,actor.id,ticket.localId).first<any>()
  if(prior){if(prior.intent_hash!==intent)throw new HTTPException(409,{message:'Notice command conflicts with its earlier preview'});return c.json({data:{id:prior.id,...JSON.parse(prior.plan_json)}})}
  const recipients=[]
  for(const id of ids){
   const contact=await c.env.DB.prepare(`SELECT ct.id,ct.name,ct.email,ct.metadata_json FROM contacts ct WHERE ct.project_id=? AND ct.id=? AND ${livePortalContact()}`).bind(actor.projectId,id).first<any>()
   if(!contact)throw new HTTPException(400,{message:'A selected requester is unavailable'})
   const metadata=JSON.parse(contact.metadata_json),status=metadata.portal_notification_emails===1&&!!contact.email?'ready':'blocked'
   recipients.push({...contact,status,...(status==='blocked'?{reason:'Requester must explicitly enable update emails in their portal preferences'}:{})})
  }
  const id=crypto.randomUUID(),now=Date.now(),plan={ticket,recipients,expiresAt:now+15*60000}
  const written=await c.env.DB.prepare(`INSERT INTO operator_service_notices(id,project_id,actor_id,local_id,intent_hash,plan_json,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(${authority.sql})`).bind(id,actor.projectId,actor.id,ticket.localId,intent,JSON.stringify(plan),now,...authority.params).run()
  if(!written.meta.changes)throw new HTTPException(409,{message:'Operator authority changed'})
  return c.json({data:{id,...plan}},201)
 })
 routes.post(base+'/:noticeId/apply',async c=>{
  const actor=await requireProject(c,c.req.param('projectId')!,true),authority=await ticketAuthority(c.env,actor,{sessionHash:c.get('sessionHash')},'conversations.reply'),id=c.req.param('noticeId')!
  const notice=await c.env.DB.prepare('SELECT * FROM operator_service_notices WHERE id=? AND project_id=? AND actor_id=?').bind(id,actor.projectId,actor.id).first<any>()
  if(!notice)throw new HTTPException(404,{message:'Service notice preview is unavailable'})
  const plan=JSON.parse(notice.plan_json),results=[]
  for(const contact of plan.recipients){
   const localId=`service-${id}-${contact.id}`,existing=await c.env.DB.prepare('SELECT conversation_id FROM operator_ticket_commands WHERE project_id=? AND actor_id=? AND local_id=?').bind(actor.projectId,actor.id,localId).first<{conversation_id:string}>()
   if(!existing){
    if(contact.status!=='ready'||Date.now()>plan.expiresAt){results.push({requesterId:contact.id,state:'blocked',reason:contact.reason??'Preview expired; review a new notice'});continue}
    const current=await c.env.DB.prepare(`SELECT 1 FROM contacts ct WHERE ct.project_id=? AND ct.id=? AND ct.email IS ? AND ct.metadata_json=? AND ${livePortalContact()} AND json_extract(ct.metadata_json,'$.portal_notification_emails')=1`).bind(actor.projectId,contact.id,contact.email,contact.metadata_json).first()
    if(!current){results.push({requesterId:contact.id,state:'blocked',reason:'Requester or consent changed since preview'});continue}
    try{await enforceRateLimits(c.env,[['conversationsPerProjectHour',actor.projectId],['conversationsPerContactHour',contact.id]])}catch(error){results.push({requesterId:contact.id,state:'blocked',reason:error instanceof Error?error.message:'Rate limit exceeded'});continue}
   }
   try{
    const input:OutboundTicketInput={...plan.ticket,localId,requesterId:contact.id,requesterEmail:null}
    const extra={noticeId:id,sql:`EXISTS(SELECT 1 FROM operator_service_notices WHERE id=? AND project_id=? AND actor_id=? AND created_at>?) AND EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=? AND ct.id=? AND ct.email IS ? AND ct.metadata_json=? AND ${livePortalContact()} AND json_extract(ct.metadata_json,'$.portal_notification_emails')=1)`,params:[id,actor.projectId,actor.id,Date.now()-15*60000,actor.projectId,contact.id,contact.email,contact.metadata_json]}
    const created=await createOutboundTicket(c.env,actor,c.get('sessionHash'),input,onCommittedMessage,delivery=>c.executionCtx.waitUntil(delivery),extra)
    const conversation=created.conversation as {id:string}
    const delivery=await c.env.DB.prepare("SELECT state,error FROM email_deliveries WHERE id IN (SELECT 'message:'||id||':notification' FROM messages WHERE conversation_id=? AND local_id=?)").bind(conversation.id,localId).first<{state:string;error:string|null}>()
    results.push({requesterId:contact.id,ticketId:conversation.id,state:delivery?.state??('generationError' in created?'blocked':'pending'),...(delivery?.error?{reason:delivery.error}:'generationError' in created?{reason:created.generationError}:{})})
   }catch(error){results.push({requesterId:contact.id,...(existing?{ticketId:existing.conversation_id}:{}),state:'blocked',reason:error instanceof Error?error.message:'Ticket creation could not be confirmed; check this same notice'})}
  }
  return c.json({data:{id,results}})
 })
 return routes
}
