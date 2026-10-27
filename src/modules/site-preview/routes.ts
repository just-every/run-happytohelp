import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { AppEnv } from '../../platform/env'
import { requireProject,hashToken } from '../../platform/auth'
import { requiredString,id } from '../../platform/db'
import { imageType,brandAssetKnowledgeSql,brandAssetHasKnowledgeSql } from './brand'
import {anonymousReaders,memberReaders} from '../knowledge/door'
import {canonicaliseFields} from '../knowledge/canonicaliser'
import { safeOrigin } from './proxy'
export const routes=new Hono<AppEnv>()
async function manage(c:any){const actor=await requireProject(c,c.req.param('projectId'),true);if(!['owner','admin'].includes(actor.role))throw new HTTPException(403);return actor}
routes.post('/projects/:projectId/brand-image-generations',async c=>{const actor=await manage(c);if(!c.env.OPENAI_API_KEY||!c.env.BRAND_IMAGE_MODEL||!c.env.BRAND_IMAGE_SIZE||!c.env.BRAND_IMAGE_QUALITY)throw new HTTPException(503,{message:'Brand image provider/model/size/quality are not configured'});const b=await c.req.json(),prompt=await canonicaliseFields(c.env,actor.projectId,requiredString(b.prompt,'prompt',4000)),requestId=requiredString(b.requestId,'requestId',200);const old=await c.env.DB.prepare("SELECT * FROM brand_generations WHERE project_id=? AND (request_id=? OR state IN('queued','running','uncertain')) ORDER BY created_at DESC LIMIT 1").bind(actor.projectId,requestId).first<any>();if(old){if(old.request_id===requestId&&old.prompt!==prompt)throw new HTTPException(409,{message:'Request identity was already used for another prompt'});return c.json({...old,dispatched:false})};const generationId=id(),now=Date.now();await c.env.DB.prepare("INSERT INTO brand_generations(id,project_id,actor_id,request_id,prompt,model,size,quality,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'queued',?,?)").bind(generationId,actor.projectId,actor.id,requestId,prompt,String(c.env.BRAND_IMAGE_MODEL),String(c.env.BRAND_IMAGE_SIZE),String(c.env.BRAND_IMAGE_QUALITY),now,now+900000).run();await c.env.JOBS.send({type:'brand.generate',id:generationId,projectId:actor.projectId});return c.json({id:generationId,state:'queued',status:'pending',dispatched:true},202)})
routes.get('/projects/:projectId/brand-image-generations/:id',async c=>{await manage(c);const row=await c.env.DB.prepare('SELECT * FROM brand_generations WHERE id=? AND project_id=?').bind(c.req.param('id'),c.req.param('projectId')).first<any>();if(!row)throw new HTTPException(404);return c.json({...row,status:({queued:'pending',running:'processing'} as Record<string,string>)[row.state]||row.state,preview_url:row.asset_id?`/api/site-preview/assets/${row.asset_id}`:null})})
routes.post('/projects/:projectId/brand-assets',async c=>{const actor=await manage(c),bytes=new Uint8Array(await c.req.arrayBuffer());if(!bytes.length||bytes.length>5000000)throw new HTTPException(413);const contentType=imageType(bytes),assetId=id(),key=`${actor.projectId}/brand/${assetId}`;await c.env.FILES.put(key,bytes,{httpMetadata:{contentType}});await c.env.DB.prepare('INSERT INTO brand_assets VALUES(?,?,?,?,?,?,?,NULL)').bind(assetId,actor.projectId,key,contentType,c.req.header('X-Filename')||'brand-image',actor.id,Date.now()).run();return c.json({id:assetId,preview_url:`/api/site-preview/assets/${assetId}`},201)})
routes.put('/projects/:projectId/brand-assets/:id/publish',async c=>{
 const actor=await manage(c),assetId=c.req.param('id'),url=`/api/site-preview/assets/${assetId}`
 const asset=await c.env.DB.prepare('SELECT id FROM brand_assets WHERE id=? AND project_id=?').bind(assetId,actor.projectId).first()
 if(!asset)throw new HTTPException(404)
 const now=Date.now(),allowed=brandAssetKnowledgeSql('brand_assets',anonymousReaders)
 // The asset and its public setting change in one batch under the same source
 // predicate. An owner may preview restricted evidence without publishing it.
 const results=await c.env.DB.batch([
  c.env.DB.prepare(`UPDATE brand_assets SET published_at=? WHERE id=? AND project_id=? AND ${allowed}`).bind(now,assetId,actor.projectId),
  c.env.DB.prepare(`INSERT INTO project_settings SELECT ?,json_object('brand_image_url',?),? WHERE EXISTS(SELECT 1 FROM brand_assets WHERE id=? AND project_id=? AND published_at=? AND ${allowed}) ON CONFLICT(project_id) DO UPDATE SET settings_json=json_set(settings_json,'$.brand_image_url',?),updated_at=excluded.updated_at`).bind(actor.projectId,url,now,assetId,actor.projectId,now,url)
 ])
 if(!results[0].meta.changes)throw new HTTPException(403)
 return c.json({published:true,url})
})
routes.get('/assets/:id',async c=>{
 const row=await c.env.DB.prepare('SELECT * FROM brand_assets WHERE id=?').bind(c.req.param('id')).first<any>()
 if(!row)throw new HTTPException(404)
 const readers=row.published_at?anonymousReaders:memberReaders((await requireProject(c,row.project_id,true)).id)
 const access=await c.env.DB.prepare(`SELECT ${brandAssetKnowledgeSql('asset',readers)} visible,${brandAssetHasKnowledgeSql('asset')} dependent FROM brand_assets asset WHERE id=? AND project_id=?`).bind(row.id,row.project_id).first<{visible:number;dependent:number}>()
 if(!access?.visible)throw new HTTPException(404)
 const object=await c.env.FILES.get(row.object_key)
 if(!object)throw new HTTPException(404)
 return new Response(object.body,{headers:{'Content-Type':row.content_type,'X-Content-Type-Options':'nosniff','Cache-Control':row.published_at&&!access.dependent?'public,max-age=300':'private,no-store'}})
})
routes.post('/projects/:projectId/preview',async c=>{const actor=await manage(c);if(!c.env.PREVIEW_ORIGIN||!c.env.APP_ORIGIN||new URL(String(c.env.PREVIEW_ORIGIN)).origin===new URL(String(c.env.APP_ORIGIN)).origin)throw new HTTPException(503,{message:'A separate preview origin is required'});const b=await c.req.json(),target=safeOrigin(requiredString(b.url,'url')),token=id()+id();const project=await c.env.DB.prepare('SELECT allowed_origin FROM projects WHERE id=?').bind(actor.projectId).first<{allowed_origin:string}>();if(target!==safeOrigin(project!.allowed_origin))throw new HTTPException(403,{message:'Preview URL must match the configured project origin'});await c.env.DB.prepare('INSERT INTO preview_grants(token_hash,project_id,actor_id,target_origin,expires_at,remaining_requests) VALUES(?,?,?,?,?,1000)').bind(await hashToken(token),actor.projectId,actor.id,target,Date.now()+3600000).run();return c.json({url:`${new URL(String(c.env.PREVIEW_ORIGIN)).origin}/preview/${actor.projectId}/${token}/`,expiresIn:3600},201)})
export const brandMediaRoutes=new Hono<AppEnv>()
brandMediaRoutes.post('/projects/:projectId/brand-media',async c=>{const actor=await requireProject(c,c.req.param('projectId'),true);if(Number(c.req.header('Content-Length'))>5500000)throw new HTTPException(413);const form=await c.req.formData(),file=form.get('file');if(!(file instanceof File)||file.size>5000000||!file.size)throw new HTTPException(400,{message:'An image file up to 5 MB is required'});const bytes=new Uint8Array(await file.arrayBuffer()),contentType=imageType(bytes),assetId=id(),key=`${actor.projectId}/brand/${assetId}`;await c.env.FILES.put(key,bytes,{httpMetadata:{contentType}});await c.env.DB.prepare('INSERT INTO brand_assets VALUES(?,?,?,?,?,?,?,?)').bind(assetId,actor.projectId,key,contentType,file.name,actor.id,Date.now(),Date.now()).run();return c.json({id:assetId,url:`/api/site-preview/assets/${assetId}`},201)})
