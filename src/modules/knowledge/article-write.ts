import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {SqlGuard} from '../../platform/integration-authority'
import {requiredString} from '../../platform/db'
/** Shared dashboard/API publication path. Category links follow the same guarded
 * receipt as the article; current category ownership is rechecked in the batch. */
export async function writeArticle(env:Env,projectId:string,b:any,guard?:SqlGuard,preserveCategories=false,editorId?:string){
 const articleId=b.id||crypto.randomUUID(),status=b.status||(b.is_published?'published':'draft')
 const existing=await env.DB.prepare('SELECT project_id,slug FROM knowledge_articles WHERE id=?').bind(articleId).first<{project_id:string;slug:string}>()
 // Omitted category fields are a content-only edit. Preserve the current fence
 // inside the write transaction rather than reconstructing it from an earlier read.
 preserveCategories=preserveCategories||Boolean(existing&&!['categoryIds','categories','categoryId'].some(key=>Object.hasOwn(b,key)))
 const slug=b.slug||existing?.slug||`${String(b.title).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')||'article'}-${articleId.slice(0,8)}`
 if(slug!==existing?.slug&&(typeof slug!=='string'||!/^[\p{L}\p{N}][\p{L}\p{N}_-]*$/u.test(slug)))throw new HTTPException(400,{message:'Slug must be a single URL segment containing letters, numbers, hyphens or underscores'})
 if(!['draft','published'].includes(status))throw new HTTPException(400,{message:'Invalid status'})
 if(existing&&existing.project_id!==projectId)throw new HTTPException(404,{message:'Not found'})
 const categories=b.categoryIds||b.categories||(b.categoryId?[b.categoryId]:[])
 if(!Array.isArray(categories)||categories.length>100||categories.some((x:any)=>typeof x!=='string')||new Set(categories).size!==categories.length)throw new HTTPException(400,{message:'Invalid categories'})
 for(const category of categories)if(!await env.DB.prepare('SELECT id FROM knowledge_categories WHERE id=? AND project_id=?').bind(category,projectId).first())throw new HTTPException(400,{message:'Category not found'})
 const now=Date.now(),condition=guard?`EXISTS(${guard.sql})`:'1=1'
 const categoryGuard=categories.length?`AND (SELECT count(*) FROM knowledge_categories WHERE project_id=? AND id IN (${categories.map(()=>'?').join(',')}))=?`:''
 const args=[projectId,slug,articleId,projectId,slug,articleId,...(guard?.params||[]),...(categories.length?[projectId,...categories,categories.length]:[])]
 // All category operations repeat the same token/category predicate inside this
 // transaction, and are scoped to the article admitted by the first statement.
 const protectedCategories=preserveCategories?`EXISTS(SELECT 1 FROM knowledge_articles old WHERE old.id=p.article_id AND (old.category_id=p.category_id OR EXISTS(SELECT 1 FROM knowledge_article_categories ac WHERE ac.article_id=old.id AND ac.category_id=p.category_id)))`:`EXISTS(SELECT 1 FROM json_each(?) WHERE value=p.category_id)`
 args.push(articleId,...(preserveCategories?[]:[JSON.stringify(categories)]))
 const privacyPredicate=`NOT EXISTS(SELECT 1 FROM knowledge_proposals p WHERE p.article_id=? AND (NOT (${protectedCategories}) OR NOT EXISTS(SELECT 1 FROM knowledge_categories k WHERE k.id=p.category_id AND k.project_id=p.project_id AND k.audience='domains' AND json_array_length(k.allowed_domains)=1 AND json_extract(k.allowed_domains,'$[0]')=p.source_domain)))`
 const predicate=`NOT EXISTS(SELECT 1 FROM knowledge_articles WHERE project_id=? AND slug=? AND id<>?) AND NOT EXISTS(SELECT 1 FROM knowledge_slug_redirects WHERE project_id=? AND slug=? AND article_id<>?) AND ${condition} ${categoryGuard} AND ${privacyPredicate}`
 // An API edit without category fields leaves both the primary category and links
 // untouched at commit, including category changes made after its initial read.
 const statements=[env.DB.prepare(`INSERT INTO knowledge_articles(id,project_id,category_id,slug,title,content,summary,status,updated_at,editor_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${predicate} ON CONFLICT(id) DO UPDATE SET ${preserveCategories?'':'category_id=excluded.category_id,'}slug=excluded.slug,title=excluded.title,content=excluded.content,summary=excluded.summary,status=excluded.status,updated_at=excluded.updated_at,editor_id=excluded.editor_id WHERE knowledge_articles.project_id=excluded.project_id`).bind(articleId,projectId,categories[0]||null,requiredString(slug,'slug',200),requiredString(b.title,'title',500),requiredString(b.content,'content',100000),b.summary||'',status,now,editorId||null,...args)]
 if(!preserveCategories)statements.push(
  env.DB.prepare(`DELETE FROM knowledge_article_categories WHERE article_id=? AND EXISTS(SELECT 1 FROM knowledge_articles WHERE id=? AND project_id=?) AND ${predicate}`).bind(articleId,articleId,projectId,...args),
  ...categories.map((category:string)=>env.DB.prepare(`INSERT INTO knowledge_article_categories(article_id,category_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM knowledge_articles WHERE id=? AND project_id=?) AND ${predicate}`).bind(articleId,category,articleId,projectId,...args)))
 let result:D1Result[]
 try{result=await env.DB.batch(statements)}catch(error){if(String(error).includes('knowledge_article_id_retired'))throw new HTTPException(409,{message:'This article ID was retired. Create a new article with a new ID.'});throw error}
 if(!result[0].meta.changes)throw new HTTPException(409,{message:'Article or authority changed'})
 return {id:articleId}
}
