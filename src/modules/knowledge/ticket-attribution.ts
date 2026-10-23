import type {Env} from '../../platform/env'
import {accessParams,articleAccessSql} from './access'
import {portalSessionGuard,type PortalIdentity} from '../portal/identity'
import {knowledgeVisitorHash} from './feedback'
import {activeSourceProjectSql} from './public-sources'

/** An explicit article-to-request link, never an inferred identity or a caller-supplied article.
 * A receipt lasts 30 minutes. Revalidate both the reader and the publication at admission.
 * Analytics failure must not turn an admitted support request into a failed customer command.
 */
export async function attributeKnowledgeTicket(env:Env,input:{projectId:string;conversationId:string;contactId:string;request:Request;viewId:unknown;identity:PortalIdentity}){
 if(typeof input.viewId!=='string'||!/^[a-f0-9-]{36}$/.test(input.viewId))return
 try{
  const {projectId,contactId,conversationId,request,viewId,identity}=input,proof=portalSessionGuard(identity)
  const contact=await env.DB.prepare(`SELECT email FROM contacts WHERE id=? AND project_id=? AND ${proof.sql}`).bind(contactId,projectId,...proof.args).first<{email:string}>()
  if(!contact)return
  const access={verified:true as const,contactId,email:contact.email.trim().toLowerCase()}
  const anonymous=await knowledgeVisitorHash(projectId,request),identified=await knowledgeVisitorHash(projectId,request,access),now=Date.now()
  // Only a successfully admitted customer message qualifies. The deterministic event ID deduplicates retries.
  await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_events(id,project_id,article_id,locale,brand,kind,query,result_count,visitor_hash,contact_id,created_at)
   SELECT ?,v.project_id,v.article_id,v.locale,v.brand,'ticket','',NULL,v.visitor_hash,?,?
   FROM knowledge_events v JOIN knowledge_articles a ON a.id=v.article_id AND a.project_id=v.project_id
   WHERE v.id=? AND v.project_id=? AND v.kind='view' AND v.created_at BETWEEN ? AND ?
   AND (v.visitor_hash IN (?,?) OR v.contact_id=?) AND a.status='published'
   AND ${proof.sql} AND ${activeSourceProjectSql('a.project_id')} AND ${articleAccessSql('a','?','?')}
   AND EXISTS(SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id=c.id AND m.project_id=c.project_id
     WHERE c.id=? AND c.project_id=v.project_id AND c.contact_id=? AND m.actor_role='contact' AND v.created_at<=c.created_at)`)
   .bind(`knowledge-ticket:${conversationId}`,contactId,now,viewId,projectId,now-1800000,now,anonymous,identified,contactId,...proof.args,...accessParams(access),conversationId,contactId).run()
 }catch{console.warn('Knowledge ticket attribution unavailable')}
}
