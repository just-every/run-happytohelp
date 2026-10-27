import {HTTPException} from 'hono/http-exception'
import type {Env} from '../../platform/env'
import type {SqlGuard} from '../../platform/integration-authority'
import {requiredString} from '../../platform/db'
/** Domains survive only as company suggestions; they never define an audience. */
export function categoryAudience(body:any,existing?:any){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new HTTPException(400,{message:'Provide collection settings'})
 const requested=body.audience??existing?.audience??'public'
 const domains=body.allowedDomains??body.allowed_domains??(existing?.allowed_domains?JSON.parse(existing.allowed_domains):[])
 const entitlement=body.requiresEntitlement??body.requires_entitlement
 if(!['public','signed-in','selected','domains'].includes(requested)||entitlement!==undefined&&typeof entitlement!=='boolean'&&entitlement!==0&&entitlement!==1||!Array.isArray(domains)||domains.length>100||domains.some((d:any)=>typeof d!=='string'||!/^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(d)))throw new HTTPException(400,{message:'Invalid collection audience or company domain hints'})
 if(requested==='public'&&Boolean(entitlement))throw new HTTPException(400,{message:'Public collections cannot require selected grants'})
 const audience=requested==='public'?'public':'signed-in'
 const requires_entitlement=audience==='public'?0:requested==='selected'||requested==='domains'?1:entitlement!==undefined?Number(Boolean(entitlement)):body.audience!==undefined?0:Number(Boolean(existing?.requires_entitlement))
 return {audience,requires_entitlement,domains:JSON.stringify([...new Set(domains.map((d:string)=>d.toLowerCase()))])}
}
export async function writeCategory(env:Env,projectId:string,categoryId:string,body:any,guard:SqlGuard,create=false){
 const existing=await env.DB.prepare('SELECT * FROM knowledge_categories WHERE id=? AND project_id=?').bind(categoryId,projectId).first<any>()
 if(!create&&!existing)throw new HTTPException(404,{message:'Not found'})
 const parent=body.parent_id??body.parentId??existing?.parent_id??null,{audience,domains,requires_entitlement}=categoryAudience(body,existing)
 const parentPredicate=`(? IS NULL OR EXISTS(SELECT 1 FROM knowledge_categories WHERE id=? AND project_id=? AND id NOT IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT k.id FROM knowledge_categories k JOIN descendants d ON k.parent_id=d.id WHERE k.project_id=?) SELECT id FROM descendants)))`
 if(parent){const valid=await env.DB.prepare(`SELECT id FROM knowledge_categories WHERE id=? AND project_id=? AND id NOT IN (WITH RECURSIVE descendants(id) AS (SELECT ? UNION SELECT k.id FROM knowledge_categories k JOIN descendants d ON k.parent_id=d.id WHERE k.project_id=?) SELECT id FROM descendants)`).bind(parent,projectId,categoryId,projectId).first();if(!valid)throw new HTTPException(400,{message:'Invalid parent or category cycle'})}
 const currentPredicate=existing?'EXISTS(SELECT 1 FROM knowledge_categories WHERE id=? AND project_id=? AND parent_id IS ? AND name=? AND slug=? AND summary=? AND is_published=? AND position=? AND audience=? AND allowed_domains=? AND requires_entitlement=?)':'NOT EXISTS(SELECT 1 FROM knowledge_categories WHERE id=?)'
 const currentArgs=existing?[categoryId,projectId,existing.parent_id,existing.name,existing.slug,existing.summary,existing.is_published,existing.position,existing.audience,existing.allowed_domains,existing.requires_entitlement]:[categoryId]
 const condition=`EXISTS(${guard.sql}) AND ${parentPredicate} AND ${currentPredicate}`,args=[...guard.params,parent,parent,projectId,categoryId,projectId,...currentArgs]
 const title=requiredString(body.name??body.title??existing?.name,'title',200),slug=requiredString(body.slug||existing?.slug||`${title.toLowerCase().replace(/[^a-z0-9]+/g,'-')}-${categoryId.slice(0,8)}`,'slug',200)
 const result=await env.DB.prepare(`INSERT INTO knowledge_categories(id,project_id,parent_id,name,slug,summary,is_published,position,audience,allowed_domains,requires_entitlement) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,name=excluded.name,slug=excluded.slug,summary=excluded.summary,is_published=excluded.is_published,position=excluded.position,audience=excluded.audience,allowed_domains=excluded.allowed_domains,requires_entitlement=excluded.requires_entitlement WHERE knowledge_categories.project_id=excluded.project_id RETURNING id`).bind(categoryId,projectId,parent,title,slug,body.summary??existing?.summary??'',body.is_published===undefined?(existing?.is_published??1):(body.is_published?1:0),body.position??existing?.position??0,audience,domains,requires_entitlement,...args).all()
 if(!result.results.length)throw new HTTPException(409,{message:'Category, parent or authority changed'})
 return {id:categoryId,updated:true}
}
