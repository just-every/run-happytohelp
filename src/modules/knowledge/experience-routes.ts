import {readableAccentOnWhite} from '../widget/appearance.js'
import {approvedHelpHosts} from './domains'
import {Hono} from 'hono'
import {HTTPException} from 'hono/http-exception'
import type {AppEnv} from '../../platform/env'
import {requireProject} from '../../platform/auth'
import {auditStatement,requestSource} from '../audit/record'
import {getKnowledgeExperience,validLocale,templateTypes} from './experience'
import {knowledgeEditorGuard} from './management-guard'
import {writeCategory} from './category-write'
import {writeArticle} from './article-write'
import {knowledgeUpgradeReport} from './upgrade-report'
export const experienceRoutes=new Hono<AppEnv>()
experienceRoutes.use('/:projectId/*',async(c,next)=>{await requireProject(c,c.req.param('projectId'),true);await next()})
experienceRoutes.get('/:projectId/upgrade-report',knowledgeUpgradeReport)
experienceRoutes.get('/:projectId/experience',async c=>c.json(await getKnowledgeExperience(c.env,c.req.param('projectId'))))
experienceRoutes.put('/:projectId/experience',async c=>{
 const guard=await knowledgeEditorGuard(c),body=await c.req.json(),projectId=c.req.param('projectId'),defaultLocale=validLocale(body.defaultLocale)
 if(!Array.isArray(body.locales)||body.locales.length>30||!body.locales.includes(defaultLocale))throw new HTTPException(400,{message:'Default locale must be included'})
 const locales=[...new Set(body.locales.map(validLocale))],templates=body.templates||{}
 if(typeof templates!=='object'||Array.isArray(templates)||Object.entries(templates).some(([key,value])=>!templateTypes.includes(key as any)||typeof value!=='string'||value.length>10000||/<[^>]*>/.test(value)))throw new HTTPException(400,{message:'Templates must be plain text, up to 10000 characters'})
 const publishedHost=body.publishedHost===undefined?(await getKnowledgeExperience(c.env,projectId)).publishedHost:body.publishedHost
 if(publishedHost!==null&&publishedHost!==''&&!(await approvedHelpHosts(c.env,projectId)).includes(publishedHost))throw new HTTPException(409,{message:'Choose an exact help host already configured for this workspace by your hosting administrator'})
 const linkColor=body.linkColor===undefined?(await getKnowledgeExperience(c.env,projectId)).linkColor:body.linkColor
 if(typeof linkColor!=='string'||linkColor!==''&&(!/^#[0-9a-f]{6}$/i.test(linkColor)||readableAccentOnWhite(linkColor.toLowerCase())!==linkColor.toLowerCase()))throw new HTTPException(400,{message:'Choose a link color with at least 4.5:1 contrast on white'})
 const now=Date.now(),result=await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO knowledge_experience(project_id,default_locale,locales_json,templates_json,updated_by,updated_at,published_host,link_color) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql}) ON CONFLICT(project_id) DO UPDATE SET default_locale=excluded.default_locale,locales_json=excluded.locales_json,templates_json=excluded.templates_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at,published_host=excluded.published_host,link_color=excluded.link_color RETURNING project_id`).bind(projectId,defaultLocale,JSON.stringify(locales),JSON.stringify(templates),c.get('actor').id,now,publishedHost,linkColor.toLowerCase(),...guard.params),auditStatement(c.env.DB,{projectId,category:'data',action:'knowledge.experience.updated',actor:{type:'user',id:c.get('actor').id},source:requestSource(c)})])
 if(!result[0].results.length)throw new HTTPException(409,{message:'Authority changed'})
 return c.json(await getKnowledgeExperience(c.env,projectId))
})
experienceRoutes.put('/:projectId/categories/:categoryId/audience',async c=>c.json(await writeCategory(c.env,c.req.param('projectId'),c.req.param('categoryId'),await c.req.json(),await knowledgeEditorGuard(c))))
experienceRoutes.get('/:projectId/articles/:articleId/translations/:locale',async c=>{
 const projectId=c.req.param('projectId'),articleId=c.req.param('articleId'),locale=validLocale(c.req.param('locale'))
 if(!await c.env.DB.prepare('SELECT 1 FROM knowledge_articles WHERE id=? AND project_id=?').bind(articleId,projectId).first())throw new HTTPException(404)
 const row=await c.env.DB.prepare('SELECT * FROM knowledge_translations WHERE article_id=? AND locale=?').bind(articleId,locale).first<any>()
 return c.json(row?{...row,reviewStatus:row.review_status,reviewedBy:row.reviewed_by}:{title:'',content:'',summary:'',reviewStatus:'draft'})
})
experienceRoutes.put('/:projectId/articles/:articleId/translations/:locale',async c=>{
 const guard=await knowledgeEditorGuard(c),projectId=c.req.param('projectId'),articleId=c.req.param('articleId'),locale=validLocale(c.req.param('locale')),body=await c.req.json(),settings=await getKnowledgeExperience(c.env,projectId),now=Date.now()
 if(!settings.locales.includes(locale)||locale===settings.defaultLocale)throw new HTTPException(400,{message:'Choose a configured translation locale'})
 if(!['draft','reviewed'].includes(body.reviewStatus)||typeof body.title!=='string'||!body.title.trim()||body.title.length>500||typeof body.content!=='string'||!body.content.trim()||body.content.length>100000||typeof (body.summary||'')!=='string'||(body.summary||'').length>2000)throw new HTTPException(400,{message:'Invalid translation'})
 const snapshot=JSON.stringify({title:body.title,content:body.content,summary:body.summary||''}),reviewed=body.reviewStatus==='reviewed',actor=c.get('actor').id,historyId=crypto.randomUUID()
 const result=await c.env.DB.batch([c.env.DB.prepare(`INSERT INTO knowledge_translations(article_id,locale,title,content,summary,review_status,reviewed_by,reviewed_at,source_version,updated_at,published_json,published_source_version) SELECT a.id,?,?,?,?,?,?,?,a.publication_version,?,?,CASE WHEN ?=1 THEN a.publication_version ELSE NULL END FROM knowledge_articles a WHERE a.id=? AND a.project_id=? AND EXISTS(${guard.sql}) ON CONFLICT(article_id,locale) DO UPDATE SET title=excluded.title,content=excluded.content,summary=excluded.summary,review_status=excluded.review_status,reviewed_by=CASE WHEN ?=1 THEN excluded.reviewed_by ELSE knowledge_translations.reviewed_by END,reviewed_at=CASE WHEN ?=1 THEN excluded.reviewed_at ELSE knowledge_translations.reviewed_at END,source_version=excluded.source_version,updated_at=excluded.updated_at,published_json=CASE WHEN ?=1 THEN excluded.published_json ELSE knowledge_translations.published_json END,published_source_version=CASE WHEN ?=1 THEN excluded.published_source_version ELSE knowledge_translations.published_source_version END RETURNING article_id`).bind(locale,body.title,body.content,body.summary||'',body.reviewStatus,reviewed?actor:null,reviewed?now:null,now,reviewed?snapshot:null,reviewed?1:0,articleId,projectId,...guard.params,...Array(4).fill(reviewed?1:0)),
 c.env.DB.prepare(`INSERT INTO knowledge_translation_history SELECT ?,?,?,?, ?,?,? WHERE EXISTS(SELECT 1 FROM knowledge_translations t JOIN knowledge_articles a ON a.id=t.article_id WHERE a.id=? AND a.project_id=? AND t.locale=? AND t.updated_at=? AND t.title=? AND t.content=? AND t.summary=? AND t.review_status=? AND EXISTS(${guard.sql}))`).bind(historyId,projectId,articleId,locale,snapshot,actor,now,articleId,projectId,locale,now,body.title,body.content,body.summary||'',body.reviewStatus,...guard.params),auditStatement(c.env.DB,{projectId,category:'data',action:reviewed?'knowledge.translation.reviewed':'knowledge.translation.drafted',actor:{type:'user',id:actor},source:requestSource(c),target:{type:'article',id:articleId},detail:{locale}},now,{sql:'EXISTS(SELECT 1 FROM knowledge_translation_history WHERE id=? AND project_id=?)',params:[historyId,projectId]})])
 if(!result[0].results.length)throw new HTTPException(409,{message:'Article or authority changed'})
 return c.json({saved:true,reviewStatus:body.reviewStatus})
})
experienceRoutes.get('/:projectId/articles/:articleId/history',async c=>{
 const pid=c.req.param('projectId'),aid=c.req.param('articleId')
 const [versions,redirects]=await Promise.all([c.env.DB.prepare('SELECT * FROM knowledge_article_history WHERE project_id=? AND article_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100').bind(pid,aid).all<any>(),c.env.DB.prepare('SELECT slug,created_at FROM knowledge_slug_redirects WHERE project_id=? AND article_id=? ORDER BY created_at DESC').bind(pid,aid).all()])
 return c.json({versions:versions.results.map(v=>({...v,snapshot:JSON.parse(v.snapshot_json),snapshot_json:undefined})),redirects:redirects.results})
})
experienceRoutes.post('/:projectId/articles/:articleId/rollback',async c=>{
 const guard=await knowledgeEditorGuard(c),pid=c.req.param('projectId'),aid=c.req.param('articleId'),body=await c.req.json(),version=await c.env.DB.prepare('SELECT snapshot_json FROM knowledge_article_history WHERE id=? AND article_id=? AND project_id=?').bind(body.versionId,aid,pid).first<{snapshot_json:string}>()
 if(!version)throw new HTTPException(404,{message:'Version not found'})
 const result=await writeArticle(c.env,pid,{...JSON.parse(version.snapshot_json),id:aid},guard,true,c.get('actor').id)
 await auditStatement(c.env.DB,{projectId:pid,category:'data',action:'knowledge.article.rolled_back',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),target:{type:'article',id:aid},detail:{versionId:body.versionId}}).run()
 return c.json(result)
})
