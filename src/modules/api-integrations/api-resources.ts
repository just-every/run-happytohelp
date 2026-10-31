import {HTTPException} from 'hono/http-exception'
import type {Hono} from 'hono'
import {type ApiEnv,requireScope,iso,page,jsonBody} from './http'
import {tokenGuard} from '../../platform/integration-authority'
import {createContactResource} from '../management/contact-create'
import {updateContactResource} from '../management/contact-update'
import {writeArticle} from '../knowledge/article-write'
export function resourceApi(app:Hono<ApiEnv>){
 for(const resource of ['contacts','articles'] as const){
  const table=resource==='contacts'?'contacts':'knowledge_articles',column=resource==='contacts'?'created_at':'updated_at',read=requireScope(`${resource}:read`),write=requireScope(`${resource}:write`)
  async function get(c:any){const a=c.get('authority'),row=await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? AND id=? ${resource==='contacts'?"AND COALESCE(json_extract(metadata_json,'$.is_deleted'),0)!=1":''}`).bind(a.projectId,c.req.param('id')).first();if(!row)throw new HTTPException(404,{message:'Not found'});return row}
  app.get(`/${resource}`,read,async c=>{const a=c.get('authority'),email=resource==='contacts'?c.req.query('email')??null:null,p=page(c.req.query(),{project:a.projectId,resource,email}),args:any[]=[a.projectId];if(email){if(email.length>320)throw new HTTPException(400);args.push(email)};if(p.cursor)args.push(p.cursor.time,p.cursor.time,p.cursor.id);const rows=await c.env.DB.prepare(`SELECT * FROM ${table} WHERE project_id=? ${resource==='contacts'?"AND COALESCE(json_extract(metadata_json,'$.is_deleted'),0)!=1":''} ${email?'AND lower(email)=lower(?)':''} ${p.cursor?`AND (${column}<? OR (${column}=? AND id<?))`:''} ORDER BY ${column} DESC,id DESC LIMIT ?`).bind(...args,p.size+1).all();return c.json(p.finish(rows.results,column))})
  app.get(`/${resource}/:id`,read,async c=>c.json({data:iso(await get(c))}))
  app.post(`/${resource}`,write,async c=>{const a=c.get('authority'),b=await jsonBody(c,resource==='articles'?{title:500,content:100000,slug:200}:c.req.method==='POST'?{name:200,email:320,external_id:200}:{name:320,email:320,external_id:320,provided_name:320,provided_email:320,phone:320}),guard=tokenGuard(a,a.projectId,`${resource}:write`);if(b.id!==undefined)throw new HTTPException(400,{message:'IDs are assigned by the server'});const data=resource==='contacts'?await createContactResource(c.env,a.projectId,b,guard):await writeArticle(c.env,a.projectId,b,guard);return c.json({data:iso(data)},201)})
  app.put(`/${resource}/:id`,write,async c=>{const existing=await get(c),a=c.get('authority'),b=await jsonBody(c,resource==='articles'?{title:500,content:100000,slug:200}:c.req.method==='POST'?{name:200,email:320,external_id:200}:{name:320,email:320,external_id:320,provided_name:320,provided_email:320,phone:320}),guard=tokenGuard(a,a.projectId,`${resource}:write`);const data=resource==='contacts'?await updateContactResource(c.env,a.projectId,existing.id,b,existing,{type:'api',id:a.tokenId},guard):await writeArticle(c.env,a.projectId,{...existing,...b,id:existing.id},guard,!['categoryIds','categories','categoryId'].some(key=>Object.hasOwn(b,key)));return c.json({data:iso(data)})})
 }
}
