import {failureCategory} from '../ai-support/tool-trace'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv,Env} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {memberAccess} from '../access/gate'
import {contactAvailableSql} from '../conversations/contact-privacy'
import {accessForContact,helpAccessWriteGuard} from './access'
import {knowledgeEditorGuard} from './management-guard'
import {validLocale,getKnowledgeExperience} from './experience'
import {writeArticle} from './article-write'
import {activeSourceProjectSql} from './public-sources'
const root='/:projectId/proposals'
/** Automated masking is deliberately conservative, followed by mandatory named
 * editorial review. It is not a guarantee of arbitrary free-text anonymization. */
export function redactKnowledgeDraft(value:string,name:string|null){
 let text=value.replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,'[redacted]')
 .replace(/\b(?:api[_-]?key|secret|password|access[_-]?token)\s*[:=]\s*\S+/gi,'[redacted]')
 .replace(/https?:\/\/\S+/gi,'[link redacted]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email redacted]')
 .replace(/\+?\d[\d ().-]{5,}\d/g,'[number redacted]').replace(/\b[A-Za-z0-9_-]{24,}\b/g,'[identifier redacted]')
 if(name?.trim())for(const part of [name,...name.split(/\s+/)].filter(s=>s.length>=3))text=text.replace(new RegExp(part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),'[name redacted]')
 return text
}
export const proposalRoutes=new Hono<AppEnv>()
for(const path of [root+'*','/:projectId/gaps'])proposalRoutes.use(path,async(c,next)=>{
 const pid=c.req.param('projectId')!,actor=await requireProject(c,pid,true)
 if(!(await memberAccess(c.env.DB,pid,actor.id))?.permissions.has('knowledge.edit'))throw new HTTPException(403)
 c.header('Cache-Control','private, no-store');await next()
})
proposalRoutes.get('/:projectId/gaps',async c=>{
 const pid=c.req.param('projectId')!,offset=Number(c.req.query('offset')||0)
 if(!Number.isSafeInteger(offset)||offset<0)throw new HTTPException(400)
 const searches=await c.env.DB.prepare("SELECT lower(trim(query)) topic,locale,brand,count(*) occurrences FROM knowledge_events WHERE project_id=? AND kind='search' AND result_count=0 AND query<>'' GROUP BY lower(trim(query)),locale,brand ORDER BY occurrences DESC,topic LIMIT 101 OFFSET ?").bind(pid,offset).all<any>()
 const cases=await c.env.DB.prepare("SELECT c.id conversationId,r.id resolutionId,r.reopened_at reopenedAt FROM conversations c JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id WHERE c.project_id=? AND r.reopened_at IS NOT NULL AND "+contactAvailableSql()+" ORDER BY r.reopened_at DESC,r.id LIMIT 101 OFFSET ?").bind(pid,offset).all()
 const failures=await c.env.DB.prepare(`SELECT g.id generationId,g.conversation_id conversationId,v.id versionId,v.procedure_key procedureKey,c.brand_id brand,g.state,g.error FROM ai_generations g JOIN procedure_generation pg ON pg.generation_id=g.id JOIN procedure_versions v ON v.id=pg.version_id AND v.project_id=g.project_id JOIN conversations c ON c.id=g.conversation_id AND c.project_id=g.project_id WHERE g.project_id=? AND g.state IN ('failed','uncertain') AND ${contactAvailableSql()} ORDER BY g.created_at DESC,g.id LIMIT 101 OFFSET ?`).bind(pid,offset).all<any>()
 return c.json({procedureFailures:failures.results.slice(0,100).map(({error,...row})=>({...row,category:failureCategory(error),locale:'unavailable'})),searchTopics:searches.results.slice(0,100).map(r=>({...r,topic:redactKnowledgeDraft(r.topic,null)})),reopenedCases:cases.results.slice(0,100),nextOffset:searches.results.length>100||cases.results.length>100||failures.results.length>100?offset+100:null,clustering:'Exact normalized no-result search topics, separated by locale and brand; reopened native resolution cycles are cited separately.'})
})
proposalRoutes.get(root,async c=>{
 const pid=c.req.param('projectId')!,rows=await c.env.DB.prepare(`SELECT p.*,r.reopened_at sourceReopenedAt FROM knowledge_proposals p JOIN conversations c ON c.id=p.conversation_id AND c.project_id=p.project_id JOIN conversation_resolutions r ON r.id=p.resolution_id WHERE p.project_id=? AND ${contactAvailableSql()} ORDER BY p.created_at,p.id`).bind(pid).all<any>()
 const proposals=[]
 for(const p of rows.results){
 const outcomes=await c.env.DB.prepare(`SELECT DISTINCT r.id resolutionId,r.reopened_at reopenedAt FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.project_id=m.project_id JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id WHERE m.project_id=? AND m.actor_role='ai' AND m.created_at>=? AND m.revision>=r.cycle_start_revision AND m.revision<=r.resolved_revision AND EXISTS(SELECT 1 FROM json_each(m.citations_json) ref WHERE json_extract(ref.value,'$.id')=?)`).bind(pid,p.created_at,'article:'+p.article_id).all<any>()
 const corrections=await c.env.DB.prepare('SELECT resolution_id resolutionId,created_at FROM knowledge_corrections WHERE proposal_id=? ORDER BY created_at,id').bind(p.id).all()
 const reviews=await c.env.DB.prepare('SELECT state,reason,reviewer_id,created_at FROM knowledge_proposal_reviews WHERE proposal_id=? ORDER BY created_at,rowid').bind(p.id).all()
 proposals.push({...p,reviews:reviews.results,outcomes:{citedResolutionCycles:outcomes.results.length,reopened:outcomes.results.filter(r=>r.reopenedAt).length,cases:outcomes.results,verifiedRecovery:'unavailable: citation and closure alone do not prove customer recovery'},correctionRequired:!!p.sourceReopenedAt||outcomes.results.some(r=>r.reopenedAt),corrections:corrections.results})
 }
 return c.json({proposals,publicationDefault:'Source-derived drafts can publish only into the source customer’s currently proven email-domain collection, after explicit redaction review. Public reuse is held.'})
})
proposalRoutes.post(root,async c=>c.json(await prepareKnowledgeProposal(c.env,c.req.param('projectId')!,await c.req.json()),201))
proposalRoutes.post(root+'/:id/reject',async c=>{
 const pid=c.req.param('projectId')!,id=c.req.param('id')!,b=await c.req.json(),guard=await knowledgeEditorGuard(c)
 if(typeof b.reason!=='string'||!b.reason.trim()||b.reason.length>2000)throw new HTTPException(400,{message:'A review reason is required'})
 const now=Date.now(),changed=await c.env.DB.batch([c.env.DB.prepare(`UPDATE knowledge_proposals SET state='rejected',reviewed_by=?,review_reason=?,updated_at=? WHERE id=? AND project_id=? AND NOT EXISTS(SELECT 1 FROM knowledge_articles WHERE id=knowledge_proposals.article_id AND status='published') AND EXISTS(${guard.sql})`).bind(c.get('actor').id,b.reason,now,id,pid,...guard.params),c.env.DB.prepare("INSERT INTO knowledge_proposal_reviews SELECT ?,id,'rejected',?,?,? FROM knowledge_proposals WHERE id=? AND project_id=? AND changes()>0").bind(crypto.randomUUID(),b.reason,c.get('actor').id,now,id,pid)])
 if(!changed[0].meta.changes)throw new HTTPException(409)
 return c.json({rejected:true})
})
proposalRoutes.post(root+'/:id/publish',async c=>{
 const pid=c.req.param('projectId')!,id=c.req.param('id')!,b=await c.req.json(),editor=await knowledgeEditorGuard(c)
 if(b.redactionReviewed!==true||typeof b.title!=='string'||typeof b.content!=='string'||!b.title.trim()||!b.content.trim())throw new HTTPException(400,{message:'Review and edit the draft, and explicitly confirm redaction review'})
 const p=await c.env.DB.prepare('SELECT p.*,c.contact_id,ct.name FROM knowledge_proposals p JOIN conversations c ON c.id=p.conversation_id AND c.project_id=p.project_id JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id WHERE p.id=? AND p.project_id=?').bind(id,pid).first<any>()
 if(!p)throw new HTTPException(404)
 const access=await accessForContact(c.env,pid,p.contact_id),identity=helpAccessWriteGuard(pid,access),domain=access?.email?.split('@')[1]
 if(!domain)throw new HTTPException(409,{message:'The source identity must still prove its domain'})
 const guard={sql:editor.sql+` AND ${identity.sql} AND EXISTS(SELECT 1 FROM knowledge_proposals p JOIN conversations c ON c.id=p.conversation_id AND c.project_id=p.project_id JOIN conversation_resolutions r ON r.id=p.resolution_id JOIN knowledge_categories k ON k.id=p.category_id AND k.project_id=p.project_id WHERE p.id=? AND p.project_id=? AND p.state IN ('draft','rejected','published') AND r.reopened_at IS NULL AND c.contact_id=? AND EXISTS(SELECT 1 FROM csat_responses f WHERE f.resolution_id=r.id AND (f.scale='thumbs' AND f.score=1 OR f.scale='five' AND f.score>=4)) AND ${contactAvailableSql()} AND ${activeSourceProjectSql('p.project_id')} AND p.source_domain=? AND k.audience='domains' AND json_array_length(k.allowed_domains)=1 AND json_extract(k.allowed_domains,'$[0]')=?)`,params:[...editor.params,...identity.args,id,pid,p.contact_id,domain,domain]}
 const result=await writeArticle(c.env,pid,{id:p.article_id,title:redactKnowledgeDraft(b.title,p.name),content:redactKnowledgeDraft(b.content,p.name),slug:b.slug,categoryIds:[p.category_id],status:'published'},guard,false,c.get('actor').id)
 const now=Date.now()
 await c.env.DB.batch([c.env.DB.prepare("UPDATE knowledge_proposals SET state='published',reviewed_by=?,title=?,content=?,review_reason='',updated_at=? WHERE id=? AND project_id=?").bind(c.get('actor').id,redactKnowledgeDraft(b.title,p.name),redactKnowledgeDraft(b.content,p.name),now,id,pid),c.env.DB.prepare("INSERT INTO knowledge_proposal_reviews SELECT ?,id,'approved','Redaction and private scope reviewed',?,? FROM knowledge_proposals WHERE id=? AND project_id=? AND changes()>0").bind(crypto.randomUUID(),c.get('actor').id,now,id,pid)])
 return c.json({...result,published:true,locale:p.locale})
})
proposalRoutes.post(root+'/:id/analyze-corrections',async c=>{
 const pid=c.req.param('projectId')!,id=c.req.param('id')!,p=await c.env.DB.prepare('SELECT * FROM knowledge_proposals WHERE id=? AND project_id=?').bind(id,pid).first<any>()
 if(!p)throw new HTTPException(404)
 await c.env.DB.prepare(`INSERT OR IGNORE INTO knowledge_corrections SELECT lower(hex(randomblob(16))),p.id,r.id,? FROM knowledge_proposals p JOIN conversation_resolutions r ON r.id=p.resolution_id WHERE p.id=? AND p.project_id=? AND r.reopened_at IS NOT NULL`).bind(Date.now(),id,pid).run()
 await c.env.DB.prepare(`INSERT OR IGNORE INTO knowledge_corrections SELECT lower(hex(randomblob(16))),p.id,r.id,? FROM knowledge_proposals p JOIN messages m ON m.project_id=p.project_id JOIN conversation_resolutions r ON r.conversation_id=m.conversation_id AND r.project_id=m.project_id WHERE p.id=? AND p.project_id=? AND m.actor_role='ai' AND m.created_at>=p.created_at AND m.revision>=r.cycle_start_revision AND m.revision<=r.resolved_revision AND r.reopened_at IS NOT NULL AND EXISTS(SELECT 1 FROM json_each(m.citations_json) ref WHERE json_extract(ref.value,'$.id')='article:'||p.article_id)`).bind(Date.now(),id,pid).run()
 return c.json({proposedCorrections:(await c.env.DB.prepare('SELECT resolution_id resolutionId,created_at FROM knowledge_corrections WHERE proposal_id=?').bind(id).all()).results,action:'Review the cited reopened resolution; no article is automatically changed or published.'})
})
export async function prepareKnowledgeProposal(env:Env,pid:string,b:any,guard:{sql:string;args:unknown[]}={sql:'1=1',args:[]}){
 const settings=await getKnowledgeExperience(env,pid),locale=validLocale(b.locale||settings.defaultLocale)
 if(locale!==settings.defaultLocale||!['conversationId','resolutionId','messageId','categoryId'].every(k=>typeof b[k]==='string'&&b[k].length>0)||!settings.locales.includes(locale)||typeof b.quote!=='string'||!b.quote.trim()||b.quote.length>10000||typeof b.title!=='string'||!b.title.trim()||b.title.length>500)throw new HTTPException(400,{message:'Choose a configured locale, title and exact resolution quote'})
 const source=await env.DB.prepare(`SELECT c.contact_id,c.brand_id,ct.name,m.content,r.id FROM conversations c JOIN contacts ct ON ct.id=c.contact_id AND ct.project_id=c.project_id JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id JOIN messages m ON m.conversation_id=c.id AND m.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND r.id=? AND r.reopened_at IS NULL AND c.resolved_at IS NOT NULL AND m.id=? AND m.revision>=r.cycle_start_revision AND m.revision<=r.resolved_revision AND ${contactAvailableSql()} AND EXISTS(SELECT 1 FROM csat_responses f WHERE f.resolution_id=r.id AND (f.scale='thumbs' AND f.score=1 OR f.scale='five' AND f.score>=4))`).bind(b.conversationId,pid,b.resolutionId,b.messageId).first<any>()
 if(!source||source.brand_id!==pid||!source.content.includes(b.quote))throw new HTTPException(409,{message:'A current resolved native case in this workspace’s brand with positive customer feedback and an exact source quote is required'})
 const access=await accessForContact(env,pid,source.contact_id),domain=access?.email?.split('@')[1]
 const category=await env.DB.prepare("SELECT 1 FROM knowledge_categories WHERE id=? AND project_id=? AND audience='domains' AND json_array_length(allowed_domains)=1 AND json_extract(allowed_domains,'$[0]')=?").bind(b.categoryId,pid,domain||'').first()
 if(!domain||!category)throw new HTTPException(409,{message:'Use a private collection restricted to the source customer’s proven email domain'})
 const prior=await env.DB.prepare('SELECT id,article_id articleId,title,content,state FROM knowledge_proposals WHERE project_id=? AND resolution_id=? AND message_id=? AND category_id=? AND locale=? ORDER BY created_at,id LIMIT 1').bind(pid,b.resolutionId,b.messageId,b.categoryId,locale).first<any>()
 if(prior)return {...prior,existing:true,requiresNamedEditor:true}
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([pid,b.resolutionId,b.messageId,b.categoryId,locale]))),id=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join(''),articleId=crypto.randomUUID(),now=Date.now(),title=redactKnowledgeDraft(b.title,source.name),content=redactKnowledgeDraft(b.quote,source.name)
 const identity=helpAccessWriteGuard(pid,access)
 const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO knowledge_proposals SELECT ?,?,?,?,?,?,?,?,?,?,?,'draft',NULL,'',?,? WHERE (${guard.sql}) AND (${identity.sql}) AND EXISTS(SELECT 1 FROM conversations c JOIN conversation_resolutions r ON r.conversation_id=c.id AND r.project_id=c.project_id WHERE c.id=? AND c.project_id=? AND c.brand_id=c.project_id AND c.resolved_at IS NOT NULL AND r.id=? AND r.reopened_at IS NULL AND ${contactAvailableSql()})`).bind(id,pid,b.conversationId,b.resolutionId,b.messageId,b.categoryId,locale,domain,title,content,articleId,now,now,...guard.args,...identity.args,b.conversationId,pid,b.resolutionId).run()
 if(!inserted.meta.changes){const existing=await env.DB.prepare('SELECT id,article_id articleId,title,content,state FROM knowledge_proposals WHERE id=? AND project_id=?').bind(id,pid).first<any>();if(existing)return {...existing,existing:true,requiresNamedEditor:true};throw new HTTPException(409,{message:'Source or draft authority changed'})}
 return {id,articleId,title,content,state:'draft',requiresNamedEditor:true}
}
