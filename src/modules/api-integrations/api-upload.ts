import {uploadLimits} from './limit-config'
import {hashToken} from '../../platform/auth'
import type {Hono} from 'hono'
import {tokenGuard} from '../../platform/integration-authority'
import {type ApiEnv,requireScope,readBody} from './http'
import {attachmentTypes} from './create-attachments'
import {ApiError} from './errors'
export function uploadApi(app:Hono<ApiEnv>){
 app.post('/uploads',async(c,next)=>{
  const bearer=c.req.header('Authorization')?.replace(/^Bearer /,'')??''
  const row=await c.env.DB.prepare('SELECT scopes FROM integration_tokens WHERE token_hash=?').bind(await hashToken(bearer)).first<{scopes:string}>()
  return requireScope(row&&JSON.parse(row.scopes).includes('messages:append')?'messages:append':'conversations:create')(c,next)
 },async c=>{
  const a=c.get('authority'),credential=await c.env.DB.prepare('SELECT id FROM api_credentials WHERE namespace=? AND id=?').bind(a.projectId,a.credentialId).first<any>()
  if(!credential?.id)throw new ApiError(403,'outside_credential_bounds')
  const type=c.req.header('Content-Type')??'',filename=c.req.header('X-Filename')??'attachment'
  if(!attachmentTypes.has(type))throw new ApiError(415,'unsupported_media_type')
  if(filename.length>200||/[\r\n\x00]/.test(filename))throw new ApiError(400,'invalid_attachment')
  const bytes=await readBody(c,20000000,false),size=bytes.byteLength
  if(!size)throw new ApiError(400,'invalid_attachment')
  const limit=uploadLimits(c.env).outstanding
  const id=crypto.randomUUID(),key=`api-uploads/${a.projectId}/${id}`,guard=tokenGuard(a,a.projectId,a.scope)
  await c.env.FILES.put(key,bytes,{httpMetadata:{contentType:type}})
  const saved=await c.env.DB.prepare(`INSERT INTO api_uploads(id,project_id,credential_id,object_key,filename,content_type,size,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql}) AND (SELECT count(*) FROM api_uploads WHERE project_id=? AND credential_id=?)<?`).bind(id,a.projectId,credential.id,key,filename,type,size,Date.now()+86400000,...guard.params,a.projectId,credential.id,limit).run()
  if(!saved.meta.changes){await c.env.FILES.delete(key);if(!await c.env.DB.prepare(guard.sql).bind(...guard.params).first())throw new ApiError(401,'unauthorized');throw new ApiError(429,'credential','Outstanding upload limit reached',{}, {'Retry-After':'60','RateLimit-Limit':String(limit),'RateLimit-Remaining':'0','RateLimit-Reset':String(Math.ceil(Date.now()/1000)+60)})}
  return c.json({data:{id,filename,content_type:type,size}},201)
 })
}
