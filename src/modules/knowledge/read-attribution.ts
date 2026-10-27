import {visibleArticleSql,accessReaders} from './door'
import type {Env} from '../../platform/env'
import {helpAccessWriteGuard,type HelpAccess} from './access'
import {activeSourceProjectSql} from './public-sources'
import {portalSessionGuard,type PortalIdentity} from '../portal/identity'

/** Only the deliberate article request link connects a read to one admitted ticket. */
export async function createReadReceipt(env:Env,projectId:string,articleId:string,locale:string,brand:string,access?:HelpAccess){
 const token=crypto.randomUUID()+crypto.randomUUID(),now=Date.now(),proof=helpAccessWriteGuard(projectId,access)
 const results=await env.DB.batch([
  env.DB.prepare('DELETE FROM knowledge_read_receipts WHERE expires_at<? AND conversation_id IS NULL').bind(now),
  env.DB.prepare(`INSERT INTO knowledge_read_receipts SELECT ?,?,?,?,?,?,?,NULL WHERE ${proof.sql} AND EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.project_id=? AND a.id=? AND a.status='published' AND ${activeSourceProjectSql('a.project_id')} AND ${visibleArticleSql('a',accessReaders(access))}) RETURNING token`).bind(token,projectId,articleId,locale,brand,access?.contactId||null,now+1800000,...proof.args,projectId,articleId)
 ])
 return results[1].results.length?token:null
}
export async function attributeReadTicket(env:Env,projectId:string,conversationId:string,messageId:string,token:unknown,identity:PortalIdentity,context:{brand:string;locale:string}){
 if(typeof token!=='string'||token.length!==72)return
 const proof=portalSessionGuard(identity),contactId=identity.actor.contactId||identity.actor.id
 const row=await env.DB.prepare('SELECT email FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<{email:string}>()
 const access:HelpAccess={verified:true,contactId,email:row?.email,portalIdentity:identity}
 const scope=`token=? AND project_id=? AND brand=? AND locale=? AND expires_at>? AND (contact_id IS NULL OR contact_id=?) AND (conversation_id IS NULL OR conversation_id=?) AND ${proof.sql} AND EXISTS(SELECT 1 FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id WHERE m.id=? AND c.id=? AND c.project_id=? AND c.contact_id=?) AND EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=knowledge_read_receipts.article_id AND a.project_id=knowledge_read_receipts.project_id AND a.status='published' AND ${activeSourceProjectSql('a.project_id')} AND ${visibleArticleSql('a',accessReaders(access))} AND (knowledge_read_receipts.locale=coalesce((SELECT default_locale FROM knowledge_experience WHERE project_id=a.project_id),'en') OR EXISTS(SELECT 1 FROM knowledge_translations tr WHERE tr.article_id=a.id AND tr.locale=knowledge_read_receipts.locale AND tr.published_json IS NOT NULL AND tr.published_source_version=a.publication_version)))`
 const args=[token,projectId,context.brand,context.locale,Date.now(),contactId,conversationId,...proof.args,messageId,conversationId,projectId,contactId]
 // Anonymous possession remains linkage. Never overwrite it with the submitter's identity.
 await env.DB.batch([
  env.DB.prepare(`UPDATE knowledge_read_receipts SET conversation_id=? WHERE ${scope}`).bind(conversationId,...args),
  env.DB.prepare(`INSERT OR IGNORE INTO knowledge_events SELECT ?,project_id,article_id,locale,brand,'ticket','',NULL,'',contact_id,? FROM knowledge_read_receipts WHERE ${scope} AND conversation_id=?`).bind(`ticket:${conversationId}`,Date.now(),...args,conversationId)
 ])
}
