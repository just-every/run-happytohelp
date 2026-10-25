import type {Env,Actor} from '../../platform/env'
import {ticketAuthority} from '../tickets/model'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {trackingStatement} from '../outcomes/tracking'
import {ApiError} from './errors'
export async function releaseApiHold(env:Env,actor:Actor,sessionHash:string,row:any){
 const input=JSON.parse(row.input_json),api=input.api_request,guard=await ticketAuthority(env,actor,{sessionHash}),id=crypto.randomUUID(),message=crypto.randomUUID(),now=Date.now()
 const receipt=await env.DB.prepare('SELECT * FROM api_requests WHERE project_id=? AND held_id=? AND erased=0').bind(actor.projectId,row.id).first<any>();if(!receipt)throw new ApiError(409,'identity_erased')
 await env.DB.batch([
  env.DB.prepare(`INSERT INTO conversations(id,project_id,contact_id,created_at,updated_at,subject,channel,priority,mailbox_id,group_id,revision,last_message_id,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source) SELECT ?,project_id,id,?,?,?,?,?,?,?,1,?,?,'api',?,'api','api' FROM contacts WHERE project_id=? AND id=? AND coalesce(json_extract(metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(metadata_json,'$.is_erasing'),0)!=1 AND EXISTS(${guard.sql}) AND EXISTS(SELECT 1 FROM suspended_emails WHERE id=?)`).bind(id,now,now,row.subject,'api:'+api.product,api.priority,api.mailbox_id,api.group_id,message,api.credential_id,api.credential_id,actor.projectId,receipt.contact_id,...guard.params,row.id),
  env.DB.prepare('INSERT INTO api_conversations SELECT id,project_id,?,?,?,?,?,? FROM conversations WHERE id=?').bind(api.credential_id,api.family_id,api.name,api.product,api.ref,api.url,id),
  env.DB.prepare("INSERT INTO messages(id,project_id,conversation_id,local_id,actor_id,actor_role,content,revision,created_at) SELECT ?,project_id,id,?,contact_id,'contact',?,1,? FROM conversations WHERE id=?").bind(message,'api:release:'+row.id,row.text,now,id),
  ...input.attachments.map((file:any)=>env.DB.prepare('INSERT INTO media SELECT ?,project_id,id,contact_id,?,?,?,?,?,? FROM conversations WHERE id=?').bind(file.id,file.objectKey,file.filename,file.contentType,file.size,message,now,id)),
  trackingStatement(env,id,true),
  env.DB.prepare("INSERT INTO ticket_history SELECT ?,project_id,id,?,'api','api',?,? FROM conversations WHERE id=?").bind(crypto.randomUUID(),api.credential_id,now,JSON.stringify({action:'released',credential_name:api.name,source_product:api.product,source_ref:api.ref}),id),
  env.DB.prepare('UPDATE api_requests SET conversation_id=?,held_id=NULL WHERE project_id=? AND held_id=? AND EXISTS(SELECT 1 FROM conversations WHERE id=?)').bind(id,actor.projectId,row.id,id),
  env.DB.prepare('DELETE FROM suspended_emails WHERE id=? AND EXISTS(SELECT 1 FROM conversations WHERE id=?)').bind(row.id,id)
 ])
 if(!await env.DB.prepare('SELECT id FROM conversations WHERE id=?').bind(id).first())throw new ApiError(409,'conflict')
 return {recovered:true,conversationId:id,asNote:false}
}
