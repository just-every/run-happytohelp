import type {Env,Actor} from '../../platform/env'
import {HTTPException} from 'hono/http-exception'
import {emailContact} from './inbound-authority'

/** A human may create an ordinary ticket retaining unproven mail as a private
 * note. The requester remains explicitly unproven: no sender authority is minted
 * by the recovery action, and the original message never speaks as a customer. */
export async function newRecoveryTicket(env:Env,actor:Actor,row:any,asNote:boolean){
 const contact=asNote?null:await emailContact(env,actor.projectId,row.from_address)
 if(!asNote&&!contact)throw new HTTPException(409,{message:'Requester is unavailable'})
 const contactId=contact?.id||`recovered-${row.id}`,conversationId=`recovered-${row.id}`,now=Date.now()
 await env.DB.batch([
  ...(contact?[]:[env.DB.prepare(`INSERT OR IGNORE INTO contacts(id,project_id,email,metadata_json,created_at) SELECT ?,?,?,'{"email_unproven":1}',? WHERE EXISTS(SELECT 1 FROM memberships WHERE project_id=? AND user_id=?)`).bind(contactId,actor.projectId,row.from_address,now,actor.projectId,actor.id)]),
  env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,created_at,updated_at,subject,channel,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source)
   SELECT ?,ct.project_id,ct.id,?,?,?,'email',?,'agent',?,'user','email_review' FROM contacts ct WHERE ct.id=? AND ct.project_id=? AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND EXISTS(SELECT 1 FROM memberships WHERE project_id=ct.project_id AND user_id=?) AND EXISTS(SELECT 1 FROM suspended_emails WHERE id=? AND project_id=ct.project_id)`).bind(conversationId,now,now,row.subject,actor.id,actor.id,contactId,actor.projectId,actor.id,row.id),
 ])
 return env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(conversationId,actor.projectId).first<any>()
}
