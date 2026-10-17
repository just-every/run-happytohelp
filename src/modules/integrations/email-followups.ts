import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {auditStatement} from '../audit/record'

/** Closed tickets remain final. A sender already admitted to that parent gets a
 * linked fresh ticket; both its requester and current participants stay scoped
 * to the same workspace, and normal admission rechecks their live authority. */
export async function emailFollowup(env:Env,parent:any,messageId:string,contactId:string){
 const child=`followup-${await hashToken(parent.project_id+':'+messageId)}`,now=Date.now()
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,created_at,updated_at,subject,channel,mailbox_id,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source)
   SELECT ?,c.project_id,ct.id,?,?,c.subject,'email',c.mailbox_id,ct.id,'contact',ct.id,'contact','email' FROM conversations c JOIN contacts ct ON ct.id=? AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND c.status_category='closed' AND (ct.id=c.contact_id OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.contact_id=ct.id)) AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1`).bind(child,now,now,contactId,parent.id,parent.project_id),
  env.DB.prepare('INSERT OR IGNORE INTO email_followup_links SELECT project_id,?,?,? FROM conversations WHERE id=? AND project_id=?').bind(parent.id,child,now,child,parent.project_id),
  auditStatement(env.DB,{projectId:parent.project_id,category:'data',action:'email.followup_created',actor:{type:'system'},source:'email',target:{type:'conversation',id:child},detail:{parentId:parent.id}}),
 ])
 return env.DB.prepare('SELECT * FROM conversations WHERE id=? AND project_id=?').bind(child,parent.project_id).first<any>()
}
