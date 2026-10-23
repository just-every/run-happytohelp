import {attributeKnowledgeTicket} from '../knowledge/ticket-attribution'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {clientAddress,enforceRateLimits} from '../../platform/rate-limits'
import {admitMessage,messageAuthority} from '../conversations/admission'
import {trackingStatement} from '../outcomes/state'
import {applyMessageEffects} from '../../message-effects'
import type {DeferEmailDelivery} from '../integrations/email'
import {resolvePortalActor,portalSessionGuard} from '../portal/index'
import {loadPublicForm} from './store'
import {validateSubmission,fieldError} from './validation'
import {formFieldGuard} from './field-guard'
import {verifyFormChallenge} from './challenge'
import type {FormIdentity} from './types'
export interface SubmitRequestInput {projectId:string;formId:string;body:unknown;request:Request;identity?:FormIdentity;channel?:'portal'|'widget'|'api'|'form';defer?:DeferEmailDelivery}
function publicMessage(row:any){return {id:row.id,project_id:row.project_id,conversation_id:row.conversation_id,local_id:row.local_id,content:row.content,actor_role:row.actor_role,revision:row.revision,created_at:row.created_at}}
function publicTicket(row:any){if(!row)return row;const status=['solved','closed'].includes(row.status_category)?'solved':'open';return {id:row.id,project_id:row.project_id,subject:row.subject,status,status_id:status,status_category:status,revision:row.revision,last_message_id:row.last_message_id,created_at:row.created_at,updated_at:row.updated_at,resolved_at:row.resolved_at}}
const verificationRequired=()=>new HTTPException(428,{message:'Verify your email address to submit this request',res:Response.json({error:'Verify your email address to submit this request',code:'email_verification_required'},{status:428})})
/** One shared customer submission door. A typed address or widget session never authorizes it. */
export async function submitRequest(env:Env,input:SubmitRequestInput){
 const {projectId,formId,request}=input
 if(typeof formId!=='string'||!formId||formId.length>200)fieldError('formId','required','Choose a request form')
 const body=input.body as Record<string,unknown>|null,requestedLocale=body&&typeof body.locale==='string'?body.locale:undefined,{form,catalogue}=await loadPublicForm(env,projectId,formId,requestedLocale),submission=validateSubmission(form,input.body)
 const address=clientAddress({header:name=>request.headers.get(name)??undefined})
 await enforceRateLimits(env,[['conversationsPerIpHour',`${projectId}|${address}`]])
 const identity=input.identity??await resolvePortalActor(env,projectId,request)
 if(identity&&(identity.actor.projectId!==projectId||identity.actor.role!=='contact'))throw verificationRequired()
 const contactId=identity?.actor.contactId??identity?.actor.id,intent=await hashToken(JSON.stringify({formId,subject:submission.subject,message:submission.message,fields:Object.entries(submission.fields).sort(([a],[b])=>a.localeCompare(b))})),guard=identity?portalSessionGuard(identity):undefined
 const existing=identity?await env.DB.prepare(`SELECT r.* FROM request_form_submissions r WHERE r.project_id=? AND r.contact_id=? AND r.local_id=? AND ${guard!.sql}`).bind(projectId,contactId!,submission.localId,...guard!.args).first<any>():null
 if(existing&&existing.intent_hash!==intent)throw new HTTPException(409,{message:'This submission ID was already used for a different request'})
 // A successful admitted command can be replayed with its live proof without reusing a single-use challenge.
 const admitted=existing?await env.DB.prepare(`SELECT * FROM messages WHERE project_id=? AND conversation_id=? AND local_id=? AND ${guard!.sql}`).bind(projectId,existing.conversation_id,submission.localId,...guard!.args).first<any>():null
 if(admitted){await attributeKnowledgeTicket(env,{projectId,conversationId:existing.conversation_id,contactId:contactId!,request,viewId:body?.afterReading,identity:identity!});const ticket=await env.DB.prepare('SELECT * FROM conversations WHERE project_id=? AND id=?').bind(projectId,existing.conversation_id).first();return {ticket:publicTicket(ticket),message:publicMessage(admitted),duplicate:true}}
 if(!identity){await verifyFormChallenge(env,request,body?.turnstileToken);throw verificationRequired()}
 if(!contactId||!guard)throw verificationRequired()
 if(!await env.DB.prepare(`SELECT 1 WHERE ${guard.sql}`).bind(...guard.args).first())throw verificationRequired()
 await enforceRateLimits(env,[['conversationsPerContactHour',contactId],['conversationsPerProjectHour',projectId]])
 const commandHash=await hashToken(JSON.stringify([projectId,contactId,submission.localId])),conversationId=existing?.conversation_id??`${commandHash.slice(0,8)}-${commandHash.slice(8,12)}-${commandHash.slice(12,16)}-${commandHash.slice(16,20)}-${commandHash.slice(20,32)}`,now=Date.now(),conditions=[guard.sql,'EXISTS(SELECT 1 FROM request_forms WHERE project_id=? AND id=? AND enabled=1 AND updated_at=?)'],params:unknown[]=[...guard.args,projectId,formId,form.updatedAt]
 const fieldsGuard=formFieldGuard(projectId,catalogue.filter(f=>form.fields.some(ref=>ref.id===f.id)));conditions.push(fieldsGuard.sql);params.push(...fieldsGuard.args)
 const statements=[env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,subject,channel,created_at,updated_at,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source) SELECT ?,?,?,?,?,?,?,?,'contact',?,'contact','form' WHERE ${conditions.join(' AND ')} AND NOT EXISTS(SELECT 1 FROM request_form_submissions WHERE project_id=? AND contact_id=? AND local_id=?)`).bind(conversationId,projectId,contactId,submission.subject,input.channel??'form',now,now,identity.actor.id,identity.actor.id,...params,projectId,contactId,submission.localId),env.DB.prepare(`INSERT OR IGNORE INTO request_form_submissions(project_id,contact_id,local_id,form_id,conversation_id,intent_hash,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM conversations WHERE project_id=? AND id=? AND contact_id=?) AND ${guard.sql}`).bind(projectId,contactId,submission.localId,formId,conversationId,intent,now,projectId,conversationId,contactId,...guard.args),trackingStatement(env,conversationId,true)]
 for(const [fieldId,value] of Object.entries(submission.fields))if(value!==null)statements.push(env.DB.prepare(`INSERT OR IGNORE INTO ticket_field_values(project_id,conversation_id,field_id,value_json) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM request_form_submissions WHERE project_id=? AND conversation_id=? AND intent_hash=?) AND ${guard.sql}`).bind(projectId,conversationId,fieldId,JSON.stringify(value),projectId,conversationId,intent,...guard.args))
 statements.push(env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','form.started','succeeded','system',?,'api','conversation',?,? WHERE EXISTS(SELECT 1 FROM request_form_submissions WHERE project_id=? AND conversation_id=? AND intent_hash=?) AND ${guard.sql}`).bind(`form-start:${conversationId}`,projectId,now,identity.actor.id,conversationId,JSON.stringify({formId}),projectId,conversationId,intent,...guard.args))
 await env.DB.batch(statements)
 const receipt=await env.DB.prepare(`SELECT r.* FROM request_form_submissions r WHERE r.project_id=? AND r.contact_id=? AND r.local_id=? AND ${guard.sql}`).bind(projectId,contactId,submission.localId,...guard.args).first<any>()
 if(!receipt)throw new HTTPException(409,{message:'Form or session changed. Reload before submitting.'})
 if(receipt.intent_hash!==intent)throw new HTTPException(409,{message:'This submission ID was already used for a different request'})
 const result=await admitMessage(env,{projectId,conversationId:receipt.conversation_id,actor:identity.actor,sessionHash:identity.sessionHash,localId:submission.localId,content:submission.message,expectedRevision:0,[messageAuthority]:{sql:conditions.join(' AND '),args:params}})
 if(!result.accepted)throw new HTTPException(409,{message:'Request changed or access expired. Reload before retrying.'})
 await env.DB.prepare(`INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) SELECT ?,?,?,'data','form.submitted','succeeded','system',?,'api','conversation',?,? WHERE EXISTS(SELECT 1 FROM messages WHERE id=?)`).bind(`form:${receipt.conversation_id}`,projectId,now,identity.actor.id,receipt.conversation_id,JSON.stringify({formId,fieldCount:Object.keys(submission.fields).length}),result.message!.id).run()
 await attributeKnowledgeTicket(env,{projectId,conversationId:receipt.conversation_id,contactId,request,viewId:body?.afterReading,identity:identity!})
 let effectsPending=false
 if(!result.duplicate)try{await applyMessageEffects(env,result.message!,identity.actor,input.defer)}catch{effectsPending=true}
 const ticket=await env.DB.prepare('SELECT * FROM conversations WHERE project_id=? AND id=?').bind(projectId,receipt.conversation_id).first()
 return {ticket:publicTicket(ticket),message:publicMessage(result.message!),duplicate:!!result.duplicate,...(effectsPending?{effectsPending:true}:{})}
}
