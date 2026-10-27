import {writeCategory} from './category-write'
import {knowledgeEditorGuard} from './management-guard'
import {HTTPException} from 'hono/http-exception'
import {type ImportPlatform} from './importers'
import {queueImport} from './import-jobs'
import {ImportInputError,checkImportSecrets,importSecrets,missingImportSecrets} from './import-requirements'
import {installation} from '../management/installation'
import { Hono } from 'hono'
import type { AppEnv } from '../../platform/env'
import { requireProject } from '../../platform/auth'
import { requiredString } from '../../platform/db'
import { crawlDataset } from './service'
import { crawlInputError } from './crawl-limits'
import { crawlerSetupProblem,websiteReader } from './crawl'
import { BUILT_IN_PAGE_LIMIT } from './website-reader'
import {auditStatement,requestSource} from '../audit/record'
export const authoring=new Hono<AppEnv>()
authoring.use('/:projectId/*',async(c,next)=>{await requireProject(c,c.req.param('projectId'),true);await next()})
authoring.get('/:projectId/datasets/:datasetId',async c=>{const row=await c.env.DB.prepare('SELECT d.*,(SELECT count(*) FROM knowledge_documents f WHERE f.version_id=d.published_version) page_count FROM knowledge_datasets d WHERE project_id=? AND id=?').bind(c.req.param('projectId'),c.req.param('datasetId')).first();return row?c.json(row):c.json({error:'Not found'},404)})
authoring.get('/:projectId/datasets/:datasetId/pages',async c=>c.json((await c.env.DB.prepare('SELECT f.* FROM knowledge_documents f JOIN knowledge_datasets d ON d.published_version=f.version_id WHERE d.project_id=? AND d.id=?').bind(c.req.param('projectId'),c.req.param('datasetId')).all()).results))
authoring.put('/:projectId/datasets/:datasetId',async c=>{const b=await c.req.json();const limitError=crawlInputError(b);if(limitError)return c.json({error:limitError},400);const changed=await c.env.DB.prepare('UPDATE knowledge_datasets SET name=?,url=?,excluded_urls=?,max_crawl_depth=?,max_crawl_pages=?,refresh_mode=? WHERE project_id=? AND id=?').bind(requiredString(b.name,'name',200),b.url||null,JSON.stringify(b.excluded_urls||[]),b.max_crawl_depth??3,b.max_crawl_pages??100,b.refresh_mode||b.refreshMode||'manual',c.req.param('projectId'),c.req.param('datasetId')).run();return c.json({updated:!!changed.meta.changes})})
authoring.post('/:projectId/datasets/:datasetId/crawl',async c=>{const datasetId=c.req.param('datasetId');const projectId=c.req.param('projectId');if(!await c.env.DB.prepare('SELECT id FROM knowledge_datasets WHERE id=? AND project_id=?').bind(datasetId,projectId).first())return c.json({error:'Not found'},404);try{return c.json(await crawlDataset(c.env,projectId,datasetId,(await c.req.json().catch(()=>({}))).semantic===true),202)}catch(e){return c.json({error:String(e)},409)}})
authoring.put('/:projectId/categories/:categoryId',async c=>c.json(await writeCategory(c.env,c.req.param('projectId'),c.req.param('categoryId'),await c.req.json(),await knowledgeEditorGuard(c))))
authoring.delete('/:projectId/categories/:categoryId',async c=>{
 const cid=c.req.param('categoryId'),pid=c.req.param('projectId'),guard=await knowledgeEditorGuard(c)
 const category=await c.env.DB.prepare('SELECT audience,is_published,requires_entitlement FROM knowledge_categories WHERE id=? AND project_id=?').bind(cid,pid).first<any>()
 if(category&&(category.audience!=='public'||!category.is_published||category.requires_entitlement))throw new HTTPException(409,{message:'Publish the collection and set public access explicitly before deleting it'})
 const condition=`EXISTS(SELECT 1 FROM knowledge_categories WHERE id=? AND project_id=? AND audience='public' AND is_published=1 AND requires_entitlement=0) AND EXISTS(${guard.sql})`,args=[cid,pid,...guard.params]
 await c.env.DB.batch([c.env.DB.prepare(`UPDATE knowledge_categories SET parent_id=NULL WHERE parent_id=? AND project_id=? AND ${condition}`).bind(cid,pid,...args),c.env.DB.prepare(`UPDATE knowledge_articles SET category_id=NULL WHERE category_id=? AND project_id=? AND ${condition}`).bind(cid,pid,...args),c.env.DB.prepare(`DELETE FROM knowledge_categories WHERE id=? AND project_id=? AND ${condition}`).bind(cid,pid,...args)])
 return c.json({deleted:true})
})
authoring.delete('/:projectId/articles/:articleId',async c=>{await c.env.DB.prepare('DELETE FROM knowledge_articles WHERE id=? AND project_id=?').bind(c.req.param('articleId'),c.req.param('projectId')).run();return c.json({deleted:true})})
authoring.put('/:projectId/articles/:articleId/categories',async c=>{const b=await c.req.json();if(!Array.isArray(b.categoryIds))return c.json({error:'categoryIds required'},400);const pid=c.req.param('projectId');const aid=c.req.param('articleId');if(!await c.env.DB.prepare('SELECT id FROM knowledge_articles WHERE id=? AND project_id=?').bind(aid,pid).first())return c.json({error:'Not found'},404);for(const cid of b.categoryIds)if(!await c.env.DB.prepare('SELECT id FROM knowledge_categories WHERE id=? AND project_id=?').bind(cid,pid).first())return c.json({error:'Invalid category'},400);await c.env.DB.batch([c.env.DB.prepare('DELETE FROM knowledge_article_categories WHERE article_id=?').bind(aid),...b.categoryIds.map((cid:string)=>c.env.DB.prepare('INSERT INTO knowledge_article_categories(article_id,category_id) VALUES(?,?)').bind(aid,cid))]);return c.json({updated:true})})
authoring.put('/:projectId/articles/:articleId/order',async c=>{const b=await c.req.json();if(!Number.isInteger(b.position))return c.json({error:'Integer position required'},400);await c.env.DB.prepare('UPDATE knowledge_articles SET position=? WHERE id=? AND project_id=?').bind(b.position,c.req.param('articleId'),c.req.param('projectId')).run();return c.json({updated:true})})

// Which reader website sources use here and what the crawler service needs: names only, never values.
authoring.get('/:projectId/website-reader',c=>c.json({...websiteReader(c.env),problem:crawlerSetupProblem(c.env),builtInPageLimit:BUILT_IN_PAGE_LIMIT,installation:installation(c.env,c.req.url)}))

// What the import needs before it is submitted: names only, never values.
authoring.get('/:projectId/import/:platform',async c=>{const platform=c.req.param('platform') as ImportPlatform;if(!Object.hasOwn(importSecrets,platform))return c.json({error:'Not found'},404);const missing=missingImportSecrets(c.env,platform);return c.json({secrets:importSecrets[platform].map(name=>({name,set:!missing.includes(name)})),installation:installation(c.env,c.req.url)})})
authoring.post('/:projectId/import/:platform',async c=>{try{const b=await c.req.json(),platform=c.req.param('platform') as ImportPlatform;if(Object.hasOwn(importSecrets,platform))checkImportSecrets(c.env,platform);const queued=await queueImport(c.env,c.req.param('projectId'),c.req.param('platform') as ImportPlatform,b.subdomain);await auditStatement(c.env.DB,{projectId:c.req.param('projectId'),category:'data',action:'import.started',actor:{type:'user',id:c.get('actor').id},source:requestSource(c),detail:{kind:'articles',platform}}).run();return c.json(queued)}catch(e){if(e instanceof ImportInputError)return c.json({error:e.message,field:e.field},400);return c.json({error:e instanceof Error?e.message:String(e)},502)}})

authoring.get('/:projectId/imports/:importId',async c=>{const row=await c.env.DB.prepare('SELECT * FROM knowledge_imports WHERE id=? AND project_id=?').bind(c.req.param('importId'),c.req.param('projectId')).first();return row?c.json(row):c.json({error:'Not found'},404)})
