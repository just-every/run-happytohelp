import type {Env,Actor} from '../../platform/env'
import {credentialGuard} from '../../platform/integration-authority'
import {ticketAuthority} from '../tickets/model'
import {auditStatement} from '../audit/record'
import {ApiError} from './errors'
import {credentialById} from './credentials'
import {contactKeys,requesterAdmission,assertAdmission} from './requester-admission'
import {createInput} from './create-input'
import {ticketStatements,type TicketPlan} from './ticket-plan'
export async function releaseApiHold(env:Env,actor:Actor,sessionHash:string,row:any){
 const p=actor.projectId,plan:TicketPlan=JSON.parse(row.input_json).api_request.plan
 const guard=await ticketAuthority(env,actor,{sessionHash}),receipt=await env.DB.prepare('SELECT * FROM api_requests WHERE project_id=? AND held_id=? AND erased=0').bind(p,row.id).first<any>()
 if(!receipt)throw new ApiError(409,'identity_erased')
 const credential=await credentialById(env,p,plan.credentialId)
 if(!credential||credential.revoked_at!==null||credential.expires_at!==null&&credential.expires_at<=Date.now())throw new ApiError(409,'credential_inactive')
 const current=credentialGuard(p,credential.id,credential.policy_revision),input=await createInput(env,p,credential,plan.body),admission=requesterAdmission(p,await contactKeys(env,p,plan.contactId),plan.contactId)
 await assertAdmission(env,admission)
 const allowed=admission.guard(),id=crypto.randomUUID(),messageId=crypto.randomUUID(),now=Date.now()
 const collision=async()=>{if(input.ref){const existing=await env.DB.prepare('SELECT conversation_id FROM api_conversations WHERE project_id=? AND source_product=? AND source_ref=?').bind(p,credential.source_product,input.ref).first<any>();if(existing)throw new ApiError(409,'source_ref_exists','Append to the existing conversation',{conversation_id:existing.conversation_id})}}
 await collision()
 try{await env.DB.batch([
  env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(${guard.sql}) AND EXISTS(${current.sql}) AND (${allowed.sql}) AND EXISTS(SELECT 1 FROM suspended_emails WHERE project_id=? AND id=? AND expires_at>?) THEN 1 ELSE 0 END`).bind(...guard.params,...current.params,...allowed.params,p,row.id,now),
  ...ticketStatements(env,p,credential,plan,input,{id,messageId,now,localId:'api:release:'+row.id,actorId:actor.id,actorType:'user',history:{action:'released',hold_id:row.id,request_id:receipt.claim,idempotency_digest:receipt.key_digest}}),
  auditStatement(env.DB,{projectId:p,category:'integration',action:'api.suspended_recovered',actor:{type:'user',id:actor.id},source:'dashboard',target:{type:'conversation',id},detail:{hold_id:row.id,conversation_id:id,credential_id:credential.id}},now),
  env.DB.prepare('UPDATE api_requests SET conversation_id=?,held_id=NULL WHERE project_id=? AND held_id=?').bind(id,p,row.id),
  env.DB.prepare('DELETE FROM suspended_emails WHERE project_id=? AND id=?').bind(p,row.id),
  env.DB.prepare('DELETE FROM ik_d1_assertions')
 ])}catch(error){await collision();await assertAdmission(env,admission);throw new ApiError(409,'conflict','The hold or its authority changed; reload before releasing')}
 return {recovered:true,conversationId:id,asNote:false}
}
