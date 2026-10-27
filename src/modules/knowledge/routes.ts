import {accessForKnowledgeConversation} from './access'
import {entitlementRoutes} from './entitlements'
import {memberAccess} from '../access/gate'
import {HTTPException} from 'hono/http-exception'
import {helpAuth} from './help-auth'
import {publicKnowledgeRoutes} from './public-routes'
import {experienceRoutes} from './experience-routes'
import {analyticsRoutes} from './analytics-routes'
import {writeCategory} from './category-write'
import {knowledgeEditorGuard} from './management-guard'
import {writeArticle} from './article-write'
import {authoring} from './authoring'
import { Hono } from 'hono'
import type { AppEnv } from '../../platform/env'
import { requireProject } from '../../platform/auth'
import { id,requiredString } from '../../platform/db'
import { crawlDataset,refreshDataset,searchKnowledge } from './service'
import { deleteSemantic } from './providers'
import { crawlInputError } from './crawl-limits'
import { presentArticle } from './article-presentation'
export const routes=new Hono<AppEnv>()
routes.use('/public/:projectId/*',async(c,next)=>{const project=await c.env.DB.prepare("SELECT id FROM projects WHERE id=? AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=projects.id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)").bind(c.req.param('projectId')).first();if(!project)return c.json({error:'Not found'},404);await next()})
routes.route('/',helpAuth)
routes.route('/',publicKnowledgeRoutes)
routes.route('/',experienceRoutes)
routes.route('/',entitlementRoutes)
routes.route('/',analyticsRoutes)
routes.route('/',authoring)
routes.use('/:projectId/*',async(c,next)=>{await requireProject(c,c.req.param('projectId'),true);await next()})
routes.get('/:projectId/datasets',async c=>c.json((await c.env.DB.prepare('SELECT d.*,(SELECT count(*) FROM knowledge_documents f WHERE f.version_id=d.published_version) page_count FROM knowledge_datasets d WHERE project_id=?').bind(c.req.param('projectId')).all()).results))
routes.post('/:projectId/datasets',async c=>{
 const body=await c.req.json();const datasetId=id();const projectId=c.req.param('projectId');
 const mode=body.refreshMode||'manual';
 if(!['manual','daily','weekly','monthly','adaptive'].includes(mode))return c.json({error:'Invalid refresh mode'},400);
 const inputError=crawlInputError(body);if(inputError)return c.json({error:inputError},400);
 await c.env.DB.prepare('INSERT INTO knowledge_datasets(id,project_id,name,refresh_mode,created_at,url,excluded_urls,max_crawl_depth,max_crawl_pages) VALUES(?,?,?,?,?,?,?,?,?)').bind(datasetId,projectId,requiredString(body.name||body.url,'name',200),mode,Date.now(),body.url||null,JSON.stringify(body.excluded_urls||[]),body.max_crawl_depth??3,body.max_crawl_pages??100).run();
 const refresh=body.url?await crawlDataset(c.env,projectId,datasetId,body.semantic===true):undefined;
 return c.json({id:datasetId,refresh},201)
})
routes.post('/:projectId/datasets/:datasetId/refresh',async c=>{try{return c.json(await refreshDataset(c.env,c.req.param('projectId'),c.req.param('datasetId'),await c.req.json()),202)}catch(e){return c.json({error:String(e)},409)}})
routes.delete('/:projectId/datasets/:datasetId',async c=>{const dataset=await c.env.DB.prepare('SELECT * FROM knowledge_datasets WHERE id=? AND project_id=?').bind(c.req.param('datasetId'),c.req.param('projectId')).first<any>();if(!dataset)return c.json({error:'Not found'},404);if(dataset.claim_token)return c.json({error:'Refresh active'},409);await c.env.DB.prepare("UPDATE knowledge_datasets SET published_version=NULL,status='deleting' WHERE id=? AND project_id=?").bind(dataset.id,c.req.param('projectId')).run();const versions=await c.env.DB.prepare('SELECT id,semantic FROM knowledge_versions WHERE dataset_id=?').bind(dataset.id).all<any>();for(const v of versions.results){if(v.semantic)await deleteSemantic(c.env,v.id);await c.env.FILES.delete(`knowledge/corpus/${v.id}.json`);await c.env.FILES.delete(`knowledge/jobs/${v.id}.json`);await c.env.FILES.delete(`knowledge/sources/${v.id}.json`);await c.env.FILES.delete(`knowledge/crawl/${v.id}.json`);let cursor:string|undefined;do{const page=await c.env.FILES.list({prefix:`knowledge/pages/${v.id}/`,cursor});if(page.objects.length)await c.env.FILES.delete(page.objects.map(o=>o.key));cursor=page.truncated?page.cursor:undefined}while(cursor)}await c.env.DB.prepare('DELETE FROM knowledge_datasets WHERE id=? AND project_id=?').bind(dataset.id,c.req.param('projectId')).run();return c.json({deleted:true})})
routes.get('/:projectId/search',async c=>{const mode=c.req.query('mode')||'lexical';if(!['lexical','semantic'].includes(mode))return c.json({error:'Invalid search mode'},400);try{return c.json({mode,citations:await searchKnowledge({...c.env,APP_ORIGIN:c.env.APP_ORIGIN||new URL(c.req.url).origin},c.req.param('projectId'),requiredString(c.req.query('q'),'query',2000),mode as 'lexical'|'semantic',c.req.query('conversationId')?await accessForKnowledgeConversation(c.env,c.req.param('projectId'),c.req.query('conversationId')!):undefined)})}catch(e){return c.json({error:String(e)},503)}})
routes.get('/:projectId/categories',async c=>c.json((await c.env.DB.prepare('SELECT *,name title,parent_id parentId FROM knowledge_categories WHERE project_id=?').bind(c.req.param('projectId')).all<any>()).results.map(row=>({...row,allowedDomains:JSON.parse(row.allowed_domains)}))))
routes.post('/:projectId/categories',async c=>c.json(await writeCategory(c.env,c.req.param('projectId'),id(),await c.req.json(),await knowledgeEditorGuard(c),true),201))
routes.get('/:projectId/articles',async c=>{
 const projectId=c.req.param('projectId')
 const access=await memberAccess(c.env.DB,projectId,c.get('actor').id)
 if(!access?.permissions.has('knowledge.read')&&!access?.permissions.has('knowledge.edit'))throw new HTTPException(403,{message:'Knowledge read permission required'})
 const query=c.req.query('q')?.trim()||''
 if(query)requiredString(query,'query',200)
 const selection=access.knowledgeArticleIds===null?'':' AND a.id IN (SELECT value FROM json_each(?))'
 const filter=query?' AND (a.title LIKE ? OR a.summary LIKE ? OR a.content LIKE ?)':''
 const bindings=[projectId,...(query?Array(3).fill(`%${query}%`):[]),...(access.knowledgeArticleIds===null?[]:[JSON.stringify(access.knowledgeArticleIds)])]
 const rows=await c.env.DB.prepare(`SELECT a.*,category_id categoryId,(SELECT json_group_array(category_id) FROM knowledge_article_categories WHERE article_id=a.id) categories FROM knowledge_articles a WHERE project_id=?${filter}${selection} ORDER BY position,updated_at DESC`).bind(...bindings).all<any>()
 return c.json(await Promise.all(rows.results.map(row=>presentArticle(c.env,projectId,row))))
})
routes.post('/:projectId/articles',async c=>c.json(await writeArticle(c.env,c.req.param('projectId'),await c.req.json(),await knowledgeEditorGuard(c),false,c.get('actor').id),201))
