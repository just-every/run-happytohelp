import type {Env} from '../../platform/env'
import {livePortalContact} from '../portal/identity'
import {noticeParticipantProofSql} from '../integrations/notification-contacts'
import {fieldError} from './validation'

// Reuse the existing independently proven CC policy. A form cannot create an
// identity, assert mailbox proof, invite a stranger, or grant portal access.
export async function formCcAdmission(env:Env,projectId:string,requesterId:string,addresses:string[]){
 const available=`NOT EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=ct.project_id AND lower(u.email)=lower(ct.email)) AND NOT EXISTS(SELECT 1 FROM mailbox_addresses ma WHERE ma.project_id=ct.project_id AND lower(ma.address)=lower(ct.email)) AND NOT EXISTS(SELECT 1 FROM email_settings es WHERE es.project_id=ct.project_id AND (lower(es.from_address)=lower(ct.email) OR lower(es.inbound_address)=lower(ct.email)))`
 const eligible=`${available} AND ct.project_id=? AND ct.id<>? AND ${livePortalContact()} AND coalesce(json_extract(ct.metadata_json,'$.unverified_sender'),0)!=1 AND ${noticeParticipantProofSql('ct',"candidate")}`
 const source=`contacts ct CROSS JOIN (SELECT 'cc_header' joined_via, '' conversation_id) candidate`
 const contacts:string[]=[]
 for(const address of addresses){
  const rows=(await env.DB.prepare(`SELECT ct.id FROM ${source} WHERE lower(trim(ct.email))=? AND ${eligible} LIMIT 2`).bind(address,projectId,requesterId).all<{id:string}>()).results
  if(rows.length!==1)fieldError('cc','unavailable','A CC recipient is unavailable or has no independent mailbox proof. Ask the support team to add them.')
  contacts.push(rows[0].id)
 }
 const snapshot=JSON.stringify(contacts.map((id,index)=>({id,email:addresses[index]})))
 const sql=`NOT EXISTS(SELECT 1 FROM json_each(?) expected WHERE NOT EXISTS(SELECT 1 FROM ${source} WHERE ct.id=json_extract(expected.value,'$.id') AND lower(trim(ct.email))=json_extract(expected.value,'$.email') AND ${eligible} AND (SELECT count(*) FROM contacts other WHERE other.project_id=ct.project_id AND lower(trim(other.email))=lower(trim(ct.email)))=1))`,args=[snapshot,projectId,requesterId]
 return {sql,args,statements:(conversationId:string,guard:{sql:string;args:unknown[]},now:number)=>contacts.map(contactId=>env.DB.prepare(`INSERT OR IGNORE INTO conversation_participants(id,conversation_id,contact_id,created_at,joined_via) SELECT ?,?,?,?,'cc_header' WHERE EXISTS(SELECT 1 FROM request_form_submissions WHERE project_id=? AND conversation_id=?) AND ${guard.sql} AND ${sql}`).bind(`form-cc:${conversationId}:${contactId}`,conversationId,contactId,now,projectId,conversationId,...guard.args,...args))}
}
