import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {emailAddress,mailbox} from './inbound-routing'
import {receivingState} from './inbound-capability'

/** Stable per-recipient possession proof. Gateway authentication alone proves
 * which service posted a message, not ownership of an SMTP envelope address.
 * None is issued for a mailbox that cannot receive mail: a reply there would be lost. */
export async function recipientReplyAddress(env:Env,address:unknown,projectId:string,conversationId:string,recipient:string,allowUnscoped=false){
 const base=mailbox(address),email=emailAddress(recipient),secret=env.INBOUND_EMAIL_TOKEN||env.INTEGRATION_ENCRYPTION_KEY
 if(!base||!email||typeof secret!=='string'||!secret||!(await receivingState(env,base)).ready)return undefined
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign'])
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['reply-v1',projectId,conversationId,email])))
 const token=Array.from(new Uint8Array(signature)).map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,32)
 const digest=await hashToken(token)
 await env.DB.prepare(`INSERT OR IGNORE INTO email_reply_grants(token_hash,project_id,conversation_id,recipient,created_at)
  SELECT ?,c.project_id,c.id,?,? FROM conversations c JOIN contacts primary_contact ON primary_contact.id=c.contact_id AND primary_contact.project_id=c.project_id
  WHERE c.id=? AND c.project_id=? AND coalesce(json_extract(primary_contact.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(primary_contact.metadata_json,'$.is_erased'),0)!=1
  AND (? OR EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id WHERE m.project_id=c.project_id AND lower(u.email)=?)
   OR EXISTS(SELECT 1 FROM contacts ct WHERE ct.project_id=c.project_id AND (ct.id=c.contact_id OR EXISTS(SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id=c.id AND cp.contact_id=ct.id))
    AND (lower(ct.email)=? OR lower(json_extract(ct.metadata_json,'$.provided_email'))=?) AND coalesce(json_extract(ct.metadata_json,'$.is_erasing'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_erased'),0)!=1 AND coalesce(json_extract(ct.metadata_json,'$.is_blocked'),0)!=1))`)
  .bind(digest,email,Date.now(),conversationId,projectId,allowUnscoped?1:0,email,email,email).run()
 if(!await env.DB.prepare('SELECT 1 FROM email_reply_grants WHERE token_hash=? AND project_id=? AND conversation_id=? AND recipient=?').bind(digest,projectId,conversationId,email).first())return undefined
 return `${base.slice(0,base.indexOf('@'))}+r.${token}@${base.slice(base.indexOf('@')+1)}`
}

/** The thread and recipient a reply address was issued for. Whether the sender may
 * use it is decided against that recipient by the inbound policy. */
export async function replyGrant(env:Env,projectId:string,token:string){
 return env.DB.prepare('SELECT conversation_id,lower(recipient) recipient FROM email_reply_grants WHERE token_hash=? AND project_id=?').bind(await hashToken(token),projectId).first<{conversation_id:string;recipient:string}>()
}
