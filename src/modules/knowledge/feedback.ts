import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import {hashToken} from '../../platform/auth'
import {type HelpAccess,helpAccessWriteGuard,articleAccessSql,accessParams} from './access'
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
 const proof=helpAccessWriteGuard(projectId,input.access),articleGuard=article?`EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND a.status='published' AND a.publication_version=? AND ${articleAccessSql('a','?', '?')})`:'1=1'
 const result=await env.DB.prepare(`INSERT INTO knowledge_events SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${activeSourceProjectSql('?')} AND ${proof.sql} AND ${articleGuard} RETURNING id`).bind(crypto.randomUUID(),projectId,article?.article.id||null,locale,(input.brand||'').slice(0,200),input.kind,(input.query||'').slice(0,200),Number.isInteger(input.resultCount)?Math.max(0,input.resultCount!):null,input.visitorHash,input.access?.contactId||null,Date.now(),projectId,...proof.args,...(article?[article.article.id,projectId,article.article.publication_version,...accessParams(input.access)]:[])).all()
 if(!result.results.length)throw new HTTPException(409,{message:'Knowledge access changed'})
 return {recorded:true,eventId:String(result.results[0].id)}
}
export async function recordHelpfulVote(env:Env,projectId:string,slug:string,input:{helpful:boolean;comment?:string;locale?:string;brand?:string;visitorHash:string;access?:HelpAccess}){
 if(typeof input.helpful!=='boolean'||typeof (input.comment||'')!=='string'||(input.comment||'').length>2000)throw new HTTPException(400,{message:'Invalid feedback'})
 const found=await lookupAccessibleArticle(env,projectId,slug,{access:input.access,locale:input.locale});if(!found)throw new HTTPException(404,{message:'Not found'})
 const proof=helpAccessWriteGuard(projectId,input.access)
 const result=await env.DB.prepare(`INSERT INTO knowledge_feedback SELECT ?,?,?,?,?,?,?,?,? WHERE ${proof.sql} AND EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND a.status='published' AND a.publication_version=? AND ${activeSourceProjectSql('a.project_id')} AND ${articleAccessSql('a','?', '?')}) ON CONFLICT(project_id,article_id,locale,visitor_hash) DO UPDATE SET helpful=excluded.helpful,comment=excluded.comment,updated_at=excluded.updated_at RETURNING article_id`).bind(projectId,found.article.id,found.article.locale,(input.brand||'').slice(0,200),input.visitorHash,input.access?.contactId||null,input.helpful?1:0,input.comment||'',Date.now(),...proof.args,found.article.id,projectId,found.article.publication_version,...accessParams(input.access)).all()
 if(!result.results.length)throw new HTTPException(409,{message:'Knowledge access changed'})
 return {recorded:true}
}
/** Root erasure/export adapters call these before deleting the contact itself. */
export async function exportKnowledgeContact(env:Env,projectId:string,contactId:string){
 const contact=await env.DB.prepare('SELECT email FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<{email:string}>()
 const visitorHash=await hashToken(`${projectId}:${contact?.email?.trim().toLowerCase()||''}`)
 const [feedback,events,sessions]=await Promise.all([env.DB.prepare('SELECT article_id,locale,brand,helpful,comment,updated_at FROM knowledge_feedback WHERE project_id=? AND (contact_id=? OR visitor_hash=?)').bind(projectId,contactId,visitorHash).all(),env.DB.prepare('SELECT article_id,locale,brand,kind,query,result_count,created_at FROM knowledge_events WHERE project_id=? AND (contact_id=? OR visitor_hash=?)').bind(projectId,contactId,visitorHash).all(),env.DB.prepare('SELECT email,expires_at FROM knowledge_help_sessions WHERE project_id=? AND (contact_id=? OR email=?)').bind(projectId,contactId,contact?.email?.toLowerCase()||'').all()])
 return {feedback:feedback.results,events:events.results,sessions:sessions.results}
}
export async function knowledgeErasureStatements(env:Env,projectId:string,contactId:string,emails:string[]){
 const normalized=[...new Set(emails.map(email=>email.trim().toLowerCase()).filter(Boolean))],hashes=await Promise.all(normalized.map(email=>hashToken(`${projectId}:${email}`)))
 const marks=normalized.map(()=>'?').join(',')||'NULL',hashMarks=hashes.map(()=>'?').join(',')||'NULL'
 return [env.DB.prepare(`DELETE FROM knowledge_help_links WHERE project_id=? AND email IN (${marks})`).bind(projectId,...normalized),env.DB.prepare(`DELETE FROM knowledge_help_sessions WHERE project_id=? AND (contact_id=? OR email IN (${marks}))`).bind(projectId,contactId,...normalized),env.DB.prepare(`DELETE FROM knowledge_feedback WHERE project_id=? AND (contact_id=? OR visitor_hash IN (${hashMarks}))`).bind(projectId,contactId,...hashes),env.DB.prepare(`DELETE FROM knowledge_events WHERE project_id=? AND (contact_id=? OR visitor_hash IN (${hashMarks}))`).bind(projectId,contactId,...hashes)]
}
export async function eraseKnowledgeContact(env:Env,projectId:string,contactId:string){
 const row=await env.DB.prepare('SELECT email FROM contacts WHERE id=? AND project_id=?').bind(contactId,projectId).first<{email:string}>()
 await env.DB.batch(await knowledgeErasureStatements(env,projectId,contactId,row?.email?[row.email]:[]))
}
