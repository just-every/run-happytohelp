import {hashToken} from '../../platform/auth'
import type {Hono} from 'hono'
import {tokenGuard} from '../../platform/integration-authority'
import {type ApiEnv,requireScope} from './http'
import {attachmentTypes} from './create-attachments'
import {ApiError} from './errors'
export function uploadApi(app:Hono<ApiEnv>){
 app.post('/uploads',async(c,next)=>{
  const bearer=c.req.header('Authorization')?.replace(/^Bearer /,'')??''
  const row=await c.env.DB.prepare('SELECT scopes FROM integration_tokens WHERE token_hash=?').bind(await hashToken(bearer)).first<{scopes:string}>()
  return requireScope(row&&JSON.parse(row.scopes).includes('messages:append')?'messages:append':'conversations:create')(c,next)
 },async c=>{
  const a=c.get('authority'),credential=await c.env.DB.prepare('SELECT family_id FROM integration_tokens WHERE namespace=? AND id=?').bind(a.projectId,a.tokenId).first<any>()
  if(!credential?.family_id)throw new ApiError(403,'outside_credential_bounds')
  const type=c.req.header('Content-Type')??'',filename=c.req.header('X-Filename')??'attachment'
  if(!attachmentTypes.has(type))throw new ApiError(415,'unsupported_media_type')
  if(filename.length>200||/[\r\n\x00]/.test(filename))throw new ApiError(400,'invalid_attachment')
  if(Number(c.req.header('Content-Length'))>20000000)throw new ApiError(413,'payload_too_large')
  const reader=c.req.raw.body?.getReader(),chunks:Uint8Array[]=[];let size=0
  try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20000000)throw new ApiError(413,'payload_too_large');chunks.push(value)}}finally{await reader?.cancel()}
  if(!size)throw new ApiError(400,'invalid_attachment')
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
  const id=crypto.randomUUID(),key=`api-uploads/${a.projectId}/${id}`,guard=tokenGuard(a,a.projectId,a.scope)
  await c.env.FILES.put(key,bytes,{httpMetadata:{contentType:type}})
  const saved=await c.env.DB.prepare(`INSERT INTO api_uploads(id,project_id,family_id,object_key,filename,content_type,size,expires_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(${guard.sql})`).bind(id,a.projectId,credential.family_id,key,filename,type,size,Date.now()+86400000,...guard.params).run()
  if(!saved.meta.changes){await c.env.FILES.delete(key);throw new ApiError(401,'unauthorized')}
  return c.json({data:{id,filename,content_type:type,size}},201)
 })
}
