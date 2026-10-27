import {visibleArticleSql,accessReaders} from './door'
import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {type HelpAccess,helpAccessWriteGuard} from './access'
import {activeSourceProjectSql} from './public-sources'
import {lookupAccessibleArticle,selectKnowledgeLocale} from './experience'
export async function knowledgeRateLimit(env:Env,key:string,maximum:number){
 const now=Date.now(),digest=await hashToken(`knowledge:${key}`)
 const row=await env.DB.prepare('INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET failures=CASE WHEN window_start<? THEN 1 ELSE failures+1 END,window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END RETURNING failures').bind(digest,now,now-3600000,now-3600000).first<{failures:number}>()
 if(!row||row.failures>maximum)throw new HTTPException(429,{message:'Too many requests. Please try again later.'})
}
export async function knowledgeVisitorHash(projectId:string,request:Request,access?:HelpAccess){
 // A project salt prevents cross-center correlation; raw addresses are never retained.
 const address=request.headers.get('CF-Connecting-IP')||'unknown',agent=request.headers.get('User-Agent')||''
 return hashToken(`${projectId}:${access?.contactId||access?.email||`${address}:${agent}`}`)
}
export interface KnowledgeEventInput {kind:'view'|'search'|'click'|'ticket';slug?:string;query?:string;resultCount?:number;locale?:string;brand?:string;visitorHash:string;access?:HelpAccess}
export async function recordKnowledgeEvent(env:Env,projectId:string,input:KnowledgeEventInput){
 if((input.query!==undefined&&typeof input.query!=='string')||(input.brand!==undefined&&typeof input.brand!=='string'))throw new HTTPException(400,{message:'Invalid analytics metadata'})
 if(!['view','search','click','ticket'].includes(input.kind))throw new HTTPException(400,{message:'Invalid event'})
 const article=input.slug?await lookupAccessibleArticle(env,projectId,input.slug,{access:input.access,locale:input.locale}):null
 if(input.slug&&!article)throw new HTTPException(404,{message:'Not found'})
 if(input.kind!=='search'&&!article)throw new HTTPException(400,{message:'Article required'})
 const locale=await selectKnowledgeLocale(env,projectId,input.locale)
 const proof=helpAccessWriteGuard(projectId,input.access),articleGuard=article?`EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND a.status='published' AND a.publication_version=? AND ${visibleArticleSql('a',accessReaders(input.access))})`:'1=1'
 const result=await env.DB.prepare(`INSERT INTO knowledge_events SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${activeSourceProjectSql('?')} AND ${proof.sql} AND ${articleGuard} RETURNING id`).bind(crypto.randomUUID(),projectId,article?.article.id||null,locale,(input.brand||'').slice(0,200),input.kind,(input.query||'').slice(0,200),Number.isInteger(input.resultCount)?Math.max(0,input.resultCount!):null,input.visitorHash,input.access?.contactId||null,Date.now(),projectId,...proof.args,...(article?[article.article.id,projectId,article.article.publication_version]:[])).all()
 if(!result.results.length)throw new HTTPException(409,{message:'Knowledge access changed'})
 return {recorded:true}
}
export async function recordHelpfulVote(env:Env,projectId:string,slug:string,input:{helpful:boolean;comment?:string;locale?:string;brand?:string;visitorHash:string;access?:HelpAccess}){
 if(typeof input.helpful!=='boolean'||typeof (input.comment||'')!=='string'||(input.comment||'').length>2000)throw new HTTPException(400,{message:'Invalid feedback'})
 const found=await lookupAccessibleArticle(env,projectId,slug,{access:input.access,locale:input.locale});if(!found)throw new HTTPException(404,{message:'Not found'})
 const proof=helpAccessWriteGuard(projectId,input.access)
 const result=await env.DB.prepare(`INSERT INTO knowledge_feedback SELECT ?,?,?,?,?,?,?,?,? WHERE ${proof.sql} AND EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND a.status='published' AND a.publication_version=? AND ${activeSourceProjectSql('a.project_id')} AND ${visibleArticleSql('a',accessReaders(input.access))}) ON CONFLICT(project_id,article_id,locale,visitor_hash) DO UPDATE SET helpful=excluded.helpful,comment=excluded.comment,updated_at=excluded.updated_at RETURNING article_id`).bind(projectId,found.article.id,found.article.locale,(input.brand||'').slice(0,200),input.visitorHash,input.access?.contactId||null,input.helpful?1:0,input.comment||'',Date.now(),...proof.args,found.article.id,projectId,found.article.publication_version).all()
 if(!result.results.length)throw new HTTPException(409,{message:'Knowledge access changed'})
 return {recorded:true}
}
/** Root erasure/export adapters call these before deleting the contact itself. */
export async function exportKnowledgeContact(env:Env,projectId:string,contactId:string){
 const contact=await env.DB.prepare('SELECT email FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<{email:string}>()
 const email=contact?.email?.trim().toLowerCase()||'',visitorHash=await hashToken(`${projectId}:${email}`)
 const [feedback,events,sessions,entitlements,companyEntitlements,readReceipts,authoredReferences]=await Promise.all([
  env.DB.prepare('SELECT article_id,locale,brand,helpful,comment,updated_at FROM knowledge_feedback WHERE project_id=? AND (contact_id=? OR visitor_hash=?)').bind(projectId,contactId,visitorHash).all(),
  env.DB.prepare("SELECT article_id,locale,brand,kind,query,result_count,created_at FROM knowledge_events WHERE project_id=?1 AND (contact_id=?2 OR visitor_hash=?3 OR id IN (SELECT 'ticket:'||id FROM conversations WHERE project_id=?1 AND contact_id=?2))").bind(projectId,contactId,visitorHash).all(),
  env.DB.prepare('SELECT email,expires_at FROM knowledge_help_sessions WHERE project_id=? AND (contact_id=? OR email=?)').bind(projectId,contactId,email).all(),
  env.DB.prepare('SELECT category_id,created_at FROM knowledge_collection_entitlements WHERE project_id=? AND contact_id=?').bind(projectId,contactId).all(),
  env.DB.prepare('SELECT g.category_id,g.company_id,g.created_at FROM knowledge_company_entitlements g JOIN contact_companies member ON member.project_id=g.project_id AND member.company_id=g.company_id JOIN companies company ON company.id=g.company_id AND company.project_id=g.project_id AND company.merged_into IS NULL WHERE g.project_id=? AND member.contact_id=?').bind(projectId,contactId).all(),
  env.DB.prepare('SELECT article_id,locale,brand,expires_at,conversation_id FROM knowledge_read_receipts WHERE project_id=?1 AND (contact_id=?2 OR conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2))').bind(projectId,contactId).all(),
  // Export personal authorship metadata, never a live receipt token, knowledge
  // body or another customer's grant history.
  env.DB.prepare('SELECT id,kind,created_at FROM knowledge_reply_blocks WHERE project_id=? AND author_contact_id=?').bind(projectId,contactId).all(),
 ])
 return {feedback:feedback.results,events:events.results,sessions:sessions.results,entitlements:entitlements.results,companyEntitlements:companyEntitlements.results,readReceipts:readReceipts.results,authoredReferences:authoredReferences.results}
}
export async function knowledgeErasureStatements(env:Env,projectId:string,contactId:string,emails:string[]){
 const normalized=[...new Set(emails.map(email=>email.trim().toLowerCase()).filter(Boolean))],hashes=await Promise.all(normalized.map(email=>hashToken(`${projectId}:${email}`)))
 const marks=normalized.map(()=>'?').join(',')||'NULL',hashMarks=hashes.map(()=>'?').join(',')||'NULL'
 const conversations='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'
 const supportGenerations=`SELECT id FROM ai_generations WHERE project_id=?1 AND conversation_id IN (${conversations})`
 const modelGenerations=`${supportGenerations} UNION SELECT 'context:'||id FROM context_jobs WHERE project_id=?1 AND (subject_id=?2 OR subject_id IN (SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2)) UNION SELECT 'triage:'||id FROM triage_jobs WHERE project_id=?1 AND conversation_id IN (${conversations})`
 const generatedSources=`SELECT 'generation:'||id FROM (${modelGenerations})`
 const relatedKeys=`SELECT ?2 UNION ${conversations} UNION SELECT id FROM messages WHERE project_id=?1 AND (conversation_id IN (${conversations}) OR actor_role='contact' AND actor_id=?2) UNION SELECT id FROM media WHERE project_id=?1 AND (conversation_id IN (${conversations}) OR uploaded_by=?2) UNION SELECT token_hash FROM portal_session_proofs WHERE project_id=?1 AND contact_id=?2`
 return [
  env.DB.prepare('DELETE FROM knowledge_collection_entitlements WHERE project_id=? AND contact_id=?').bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_read_receipts WHERE project_id=?1 AND (contact_id=?2 OR conversation_id IN (${conversations}))`).bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_canonicalisation_receipts WHERE project_id=?1 AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(row_key) THEN row_key ELSE '[]' END) key WHERE key.value IN (${relatedKeys}))`).bind(projectId,contactId),
  // Run before engine rows are erased: answers can contain personal data even
  // without an author link. Copied answer spans share the generation source id.
  env.DB.prepare(`DELETE FROM knowledge_reply_blocks WHERE project_id=?1 AND (generation_id IN (${modelGenerations}) OR EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(sources_json) THEN sources_json ELSE '[]' END) source WHERE source.value IN (${generatedSources})))`).bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_shingles WHERE project_id=?1 AND source_id IN (${generatedSources})`).bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_source_index WHERE project_id=?1 AND source_id IN (${generatedSources})`).bind(projectId,contactId),
  // Remove the support mirror too: scrubbing output_json below must not enqueue
  // the erased generation for indexing or retain a second provenance ledger.
  env.DB.prepare(`DELETE FROM ai_generation_sources WHERE project_id=?1 AND generation_id IN (${supportGenerations})`).bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_index_dirty WHERE project_id=?1 AND source_id IN (${generatedSources})`).bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_generation_sources WHERE project_id=?1 AND generation_id IN (${modelGenerations})`).bind(projectId,contactId),
  // Authorship is a personal visibility exception. Erasure removes that link,
  // while surviving article-copy references keep their ordinary source policy.
  env.DB.prepare('UPDATE knowledge_reply_blocks SET author_contact_id=NULL WHERE project_id=? AND author_contact_id=?').bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM knowledge_help_links WHERE project_id=? AND email IN (${marks})`).bind(projectId,...normalized),
  env.DB.prepare(`DELETE FROM knowledge_help_sessions WHERE project_id=? AND (contact_id=? OR email IN (${marks}))`).bind(projectId,contactId,...normalized),
  env.DB.prepare(`DELETE FROM knowledge_feedback WHERE project_id=? AND (contact_id=? OR visitor_hash IN (${hashMarks}))`).bind(projectId,contactId,...hashes),
  env.DB.prepare(`DELETE FROM knowledge_events WHERE project_id=? AND (contact_id=? OR visitor_hash IN (${hashMarks}) OR id IN (SELECT 'ticket:'||id FROM conversations WHERE project_id=? AND contact_id=?))`).bind(projectId,contactId,...hashes,projectId,contactId),
 ]
}
export async function eraseKnowledgeContact(env:Env,projectId:string,contactId:string){
 const row=await env.DB.prepare('SELECT email FROM contacts WHERE id=? AND project_id=?').bind(contactId,projectId).first<{email:string}>()
 await env.DB.batch(await knowledgeErasureStatements(env,projectId,contactId,row?.email?[row.email]:[]))
}
