import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {SqlGuard} from '../../platform/integration-authority'
import {requiredString} from '../../platform/db'
export function categoryAudience(body:any,existing?:any){
 const audience=body.audience??existing?.audience??'public',domains=body.allowedDomains??(existing?.allowed_domains?JSON.parse(existing.allowed_domains):[])
 if(!['public','signed-in','domains'].includes(audience)||!Array.isArray(domains)||domains.length>100||domains.some((d:any)=>typeof d!=='string'||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d)))throw new HTTPException(400,{message:'Invalid collection audience or email domains'})
 if(audience==='domains'&&!domains.length)throw new HTTPException(400,{message:'At least one email domain is required'})
 return {audience,domains:JSON.stringify([...new Set(domains.map((d:string)=>d.toLowerCase()))])}
}
export async function writeCategory(env:Env,projectId:string,categoryId:string,body:any,guard:SqlGuard,create=false){
 const existing=await env.DB.prepare('SELECT * FROM knowledge_categories WHERE id=? AND project_id=?').bind(categoryId,projectId).first<any>()
 if(!create&&!existing)throw new HTTPException(404,{message:'Not found'})
 const parent=body.parent_id??body.parentId??existing?.parent_id??null,{audience,domains}=categoryAudience(body,existing)
 const parentPredicate=`(? IS NULL OR EXISTS(SELECT 1 FROM knowledge_categories WHERE id=? AND project_id=? AND id NOT IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT k.id FROM knowledge_categories k JOIN descendants d ON k.parent_id=d.id WHERE k.project_id=?) SELECT id FROM descendants)))`
 if(parent){const valid=await env.DB.prepare(`SELECT id FROM knowledge_categories WHERE id=? AND project_id=? AND id NOT IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT k.id FROM knowledge_categories k JOIN descendants d ON k.parent_id=d.id WHERE k.project_id=?) SELECT id FROM descendants)`).bind(parent,projectId,categoryId,projectId).first();if(!valid)throw new HTTPException(400,{message:'Invalid parent or category cycle'})}
 const currentPredicate=existing?'EXISTS(SELECT 1 FROM knowledge_categories WHERE id=? AND project_id=? AND parent_id IS ? AND name=? AND slug=? AND summary=? AND is_published=? AND position=? AND audience=? AND allowed_domains=?)':'NOT EXISTS(SELECT 1 FROM knowledge_categories WHERE id=?)'
 const currentArgs=existing?[categoryId,projectId,existing.parent_id,existing.name,existing.slug,existing.summary,existing.is_published,existing.position,existing.audience,existing.allowed_domains]:[categoryId]
 const condition=`EXISTS(${guard.sql}) AND ${parentPredicate} AND ${currentPredicate} AND NOT EXISTS(SELECT 1 FROM knowledge_proposals p WHERE p.category_id=? AND (?<>'domains' OR json_array_length(?)<>1 OR json_extract(?,'$[0]')<>p.source_domain))`,args=[...guard.params,parent,parent,projectId,categoryId,projectId,...currentArgs,categoryId,audience,domains,domains]
 const title=requiredString(body.name??body.title??existing?.name,'title',200),slug=requiredString(body.slug||existing?.slug||`${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${categoryId.slice(0,8)}`,'slug',200)
 const result=await env.DB.prepare(`INSERT INTO knowledge_categories(id,project_id,parent_id,name,slug,summary,is_published,position,audience,allowed_domains) SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,slug=excluded.slug,summary=excluded.summary,is_published=excluded.is_published,position=excluded.position,audience=excluded.audience,allowed_domains=excluded.allowed_domains WHERE knowledge_categories.project_id=excluded.project_id RETURNING id`).bind(categoryId,projectId,parent,title,slug,body.summary??existing?.summary??'',body.is_published===undefined?(existing?.is_published??1):(body.is_published?1:0),body.position??existing?.position??0,audience,domains,...args).all()
 if(!result.results.length)throw new HTTPException(409,{message:'Category, parent or authority changed'})
 return {id:categoryId,updated:true}
}
