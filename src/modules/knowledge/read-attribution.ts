import type {Env} from '../../platform/env'
import {articleAccessSql,accessParams,type HelpAccess} from './access'
import {portalSessionGuard,type PortalIdentity} from '../portal/identity'
/** Only the deliberate article request link can connect a read to a ticket.
 * One receipt counts at most one admitted ticket, including command retries. */
export async function createReadReceipt(env:Env,projectId:string,articleId:string,locale:string,brand:string,access?:HelpAccess){
 const token=crypto.randomUUID()+crypto.randomUUID(),now=Date.now()
 await env.DB.batch([
  env.DB.prepare('DELETE FROM knowledge_read_receipts WHERE expires_at<? AND conversation_id IS NULL').bind(now),
  env.DB.prepare('INSERT INTO knowledge_read_receipts VALUES(?,?,?,?,?,?,?,NULL)').bind(token,projectId,articleId,locale,brand,access?.contactId||null,now+1800000)
 ])
 return token
}
export async function attributeReadTicket(env:Env,projectId:string,conversationId:string,messageId:string,token:unknown,identity:PortalIdentity){
 if(typeof token!=='string'||token.length!==72)return
 const proof=portalSessionGuard(identity),contactId=identity.actor.contactId||identity.actor.id
 // A portal proves this contact independently of an email-domain gate. An
 // entitlement still needs the explicit grant at the moment attribution commits.
 const row=await env.DB.prepare('SELECT email FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<{email:string}>()
 const access:HelpAccess={verified:true,contactId,email:row?.email}
 await env.DB.batch([
  env.DB.prepare(`UPDATE knowledge_read_receipts SET conversation_id=?,contact_id=? WHERE token=? AND project_id=? AND expires_at>? AND (contact_id IS NULL OR contact_id=?) AND (conversation_id IS NULL OR conversation_id=?) AND ${proof.sql} AND EXISTS(SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.id=? AND c.id=? AND c.project_id=? AND c.contact_id=?) AND EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=knowledge_read_receipts.article_id AND a.project_id=knowledge_read_receipts.project_id AND a.status='published' AND ${articleAccessSql('a','?','?','?')})`).bind(conversationId,contactId,token,projectId,Date.now(),contactId,conversationId,...proof.args,messageId,conversationId,projectId,contactId,...accessParams(access)),
  env.DB.prepare(`INSERT OR IGNORE INTO knowledge_events SELECT ?,project_id,article_id,locale,brand,'ticket','',NULL,'',?,? FROM knowledge_read_receipts WHERE token=? AND project_id=? AND conversation_id=? AND ${proof.sql}`).bind(`ticket:${conversationId}`,contactId,Date.now(),token,projectId,conversationId,...proof.args)
 ])
}
