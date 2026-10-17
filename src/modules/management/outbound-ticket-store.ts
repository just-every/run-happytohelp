import {HTTPException} from 'hono/http-exception'
import type {Actor,Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {apiContactIdentityGuard} from './contact-identity'
import {trackingStatement} from '../outcomes/state'
import {emailThreadingStatements} from '../integrations/email-threading'
import {emailAddress} from '../integrations/inbound-routing'
import type {OutboundTicketInput} from './outbound-ticket-input'
const writableContact=`COALESCE(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_deleted'),0)!=1 AND COALESCE(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1`
export function outboundTicketAuthority(actor:Actor,sessionHash:string,now:number){
 return {sql:`SELECT 1 FROM memberships member JOIN projects p ON p.id=member.project_id JOIN sessions s ON s.actor_id=member.user_id WHERE member.project_id=? AND member.user_id=? AND member.role=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND (s.project_id=member.project_id AND s.role=member.role OR s.project_id IS NULL AND s.role='operator') AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=member.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)`,params:[actor.projectId,actor.id,actor.role,sessionHash,now]}
}
/** Reserve one durable ticket per operator command. A lost response resumes the
 * same first-message admission; changed command content is always a conflict. */
export async function reserveOutboundTicket(env:Env,actor:Actor,sessionHash:string,input:OutboundTicketInput){
 const intentHash=await hashToken(JSON.stringify(input)),conversationId=`ticket-${await hashToken(JSON.stringify([actor.projectId,actor.id,input.localId]))}`,now=Date.now(),authority=outboundTicketAuthority(actor,sessionHash,now)
 const existing=await env.DB.prepare('SELECT * FROM operator_ticket_commands WHERE project_id=? AND actor_id=? AND local_id=?').bind(actor.projectId,actor.id,input.localId).first<{conversation_id:string;intent_hash:string;kind:string}>()
 if(existing){if(existing.intent_hash!==intentHash)throw new HTTPException(409,{message:'Ticket command conflicts with an earlier request'});return {conversationId:existing.conversation_id,duplicate:true}}
 const contacts=(await env.DB.prepare(`SELECT ct.id,ct.email,ct.metadata_json FROM contacts ct WHERE ct.project_id=? AND ${input.requesterId?'ct.id=?':'lower(ct.email)=?'} LIMIT 2`).bind(actor.projectId,input.requesterId??input.requesterEmail).all<{id:string;email:string|null;metadata_json:string}>()).results
 if(contacts.length>1)throw new HTTPException(409,{message:'Multiple contacts use this email; select the requester explicitly'})
 const selected=contacts[0],privacy=JSON.parse(selected?.metadata_json??'{}')
 if(selected&&['is_erasing','is_erased','is_deleted','is_blocked'].some(key=>privacy[key]))throw new HTTPException(409,{message:'Requester is unavailable'})
 if(input.requesterId&&!selected)throw new HTTPException(404,{message:'Requester not found'})
 if(selected&&input.requesterEmail&&selected.email?.toLowerCase()!==input.requesterEmail)throw new HTTPException(409,{message:'Requester email does not match the selected contact'})
 const toAddress=emailAddress(selected?.email??input.requesterEmail)
 if(input.kind==='email'&&!toAddress)throw new HTTPException(400,{message:'Requester needs an email address'})
 const contactId=selected?.id??`outbound-${await hashToken(JSON.stringify([actor.projectId,input.requesterEmail]))}`,statements:D1PreparedStatement[]=[]
 if(!selected){const guard=apiContactIdentityGuard(actor.projectId,{email:input.requesterEmail},authority)
  statements.push(env.DB.prepare(`INSERT OR IGNORE INTO contacts(id,project_id,name,email,created_at,is_verified) SELECT ?,?,?,?,?,0 WHERE EXISTS(${guard.sql}) AND NOT EXISTS(SELECT 1 FROM contacts WHERE project_id=? AND lower(email)=?)`).bind(contactId,actor.projectId,input.requesterName||input.requesterEmail,input.requesterEmail,now,...guard.params,actor.projectId,input.requesterEmail))
 }
 const mailboxGuard=input.kind==='email'?`AND EXISTS(SELECT 1 FROM mailbox_connections mailbox WHERE mailbox.id=? AND mailbox.project_id=ct.project_id AND mailbox.status='connected' AND (mailbox.provider='forwarding' OR mailbox.credential_cipher IS NOT NULL) AND (? IS NULL OR EXISTS(SELECT 1 FROM mailbox_addresses sender WHERE sender.mailbox_id=mailbox.id AND sender.project_id=ct.project_id AND lower(sender.address)=? AND sender.can_send=1)))`:''
 statements.push(env.DB.prepare(`INSERT OR IGNORE INTO conversations(id,project_id,contact_id,created_at,updated_at,submitter_id,submitter_type,ticket_actor_id,ticket_actor_type,ticket_source,subject,channel,assigned_to,mailbox_id) SELECT ?,ct.project_id,ct.id,?,?,?,'agent',?,'user','dashboard',?,?,?,? FROM contacts ct WHERE ct.id=? AND ct.project_id=? AND ${writableContact} AND ct.email IS ? AND EXISTS(${authority.sql}) ${mailboxGuard}`).bind(conversationId,now,now,actor.id,actor.id,input.subject,input.kind==='email'?'email':'phone',actor.id,input.mailboxId,contactId,actor.projectId,selected?.email??input.requesterEmail,...authority.params,...(input.kind==='email'?[input.mailboxId,input.fromAddress,input.fromAddress]:[])))
 statements.push(env.DB.prepare(`INSERT OR IGNORE INTO operator_ticket_commands(project_id,actor_id,local_id,conversation_id,intent_hash,kind,created_at) SELECT project_id,?,?,?,?,?,? FROM conversations WHERE id=? AND project_id=? AND contact_id=?`).bind(actor.id,input.localId,conversationId,intentHash,input.kind,now,conversationId,actor.projectId,contactId))
 if(input.kind==='email')statements.push(env.DB.prepare(`INSERT OR IGNORE INTO email_message_options(project_id,conversation_id,local_id,mailbox_id,agent_id,from_address,to_address,cc_json,bcc_json,created_at) SELECT project_id,conversation_id,?,?,?,?,?,?,?,? FROM operator_ticket_commands WHERE project_id=? AND conversation_id=? AND intent_hash=?`).bind(input.localId,input.mailboxId,actor.id,input.fromAddress,toAddress,JSON.stringify(input.cc),JSON.stringify(input.bcc),now,actor.projectId,conversationId,intentHash))
 statements.push(trackingStatement(env,conversationId,true))
 if(input.kind==='email')statements.push(...emailThreadingStatements(env,{projectId:actor.projectId,conversationId,createdAt:now,keys:[{kind:'subject_token',value:`h2h:${conversationId}`,source:'native',sourceRef:'operator_ticket'}]}))
 const results=await env.DB.batch(statements)
 const command=await env.DB.prepare('SELECT intent_hash FROM operator_ticket_commands WHERE project_id=? AND actor_id=? AND local_id=?').bind(actor.projectId,actor.id,input.localId).first<{intent_hash:string}>()
 if(!command)throw new HTTPException(409,{message:'Requester, mailbox or operator authority changed; reload before creating the ticket'})
 if(command.intent_hash!==intentHash)throw new HTTPException(409,{message:'Ticket command conflicts with an earlier request'})
 return {conversationId,duplicate:results[selected?0:1].meta.changes===0}
}
export async function logOutboundCall(env:Env,actor:Actor,sessionHash:string,conversationId:string,content:string){
 const noteId=`call-${conversationId}`,now=Date.now(),authority=outboundTicketAuthority(actor,sessionHash,now)
 await env.DB.prepare(`INSERT OR IGNORE INTO conversation_notes(id,conversation_id,user_id,content,created_at) SELECT ?,c.id,?,?,? FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND ${writableContact} AND EXISTS(${authority.sql})`).bind(noteId,actor.id,content,now,conversationId,actor.projectId,...authority.params).run()
 const note=await env.DB.prepare(`SELECT n.* FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE n.id=? AND c.project_id=? AND ${writableContact} AND EXISTS(${authority.sql})`).bind(noteId,actor.projectId,...authority.params).first()
 if(!note)throw new HTTPException(409,{message:'Call log admission denied'})
 return note
}
