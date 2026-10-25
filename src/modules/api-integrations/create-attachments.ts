import type {Env} from '../../platform/env'
import {validateDestination} from '../../vendor/base/modules/integrations/core/destination'
import {ApiError} from './errors'
export const attachmentTypes=new Set(['text/plain','application/pdf','image/png','image/jpeg','image/gif','image/webp','image/avif','image/bmp','image/x-icon','image/vnd.microsoft.icon','audio/mpeg','audio/ogg','audio/wav','audio/webm','audio/mp4','video/mp4','video/ogg','video/webm','video/quicktime'])
export async function attachments(env:Env,project:string,family:string,input:unknown){
 if(input===undefined)return []
 if(!Array.isArray(input)||input.length>20)throw new ApiError(400,'invalid_attachments')
 const files:{id:string;filename:string;type:string;bytes:Uint8Array;uploadId?:string}[]=[]
 for(const reference of input){
  if(!reference||typeof reference!=='object')throw new ApiError(400,'invalid_attachment')
  let bytes:Uint8Array,type:string,filename=reference.filename??'attachment'
  if(typeof filename!=='string'||filename.length>200||/[\r\n\x00]/.test(filename))throw new ApiError(400,'invalid_attachment')
  if(reference.upload_id){
   const row=await env.DB.prepare('SELECT * FROM api_uploads WHERE project_id=? AND family_id=? AND id=? AND expires_at>?').bind(project,family,reference.upload_id,Date.now()).first<any>()
   if(!row)throw new ApiError(404,'not_found')
   const object=await env.FILES.get(row.object_key);if(!object)throw new ApiError(404,'not_found')
   bytes=new Uint8Array(await object.arrayBuffer());type=row.content_type;filename=row.filename
  }else{
   if(typeof reference.url!=='string'||typeof reference.sha256!=='string'||!/^[a-f0-9]{64}$/.test(reference.sha256))throw new ApiError(400,'invalid_attachment')
   try{validateDestination(reference.url)}catch{throw new ApiError(400,'invalid_attachment_url')}
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000)
   try{
    const response=await fetch(reference.url,{redirect:'manual',signal:controller.signal})
    if(!response.ok){await response.body?.cancel();throw new ApiError(400,'attachment_fetch_refused')}
    if(Number(response.headers.get('content-length'))>20000000){await response.body?.cancel();throw new ApiError(413,'payload_too_large')}
    type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase()
    const reader=response.body?.getReader(),chunks:Uint8Array[]=[];let size=0
    try{if(reader)for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>20000000)throw new ApiError(413,'payload_too_large');chunks.push(value)}}finally{await reader?.cancel()}
    bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength}
    const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)),b=>b.toString(16).padStart(2,'0')).join('')
    if(digest!==reference.sha256)throw new ApiError(400,'attachment_digest_mismatch')
   }catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,'attachment_fetch_refused')}finally{clearTimeout(timer)}
  }
  if(!attachmentTypes.has(type))throw new ApiError(415,'unsupported_media_type')
  if(!bytes.length||bytes.length>20000000)throw new ApiError(413,'payload_too_large')
  files.push({id:crypto.randomUUID(),filename,type,bytes,...(reference.upload_id?{uploadId:reference.upload_id}:{})})
 }
 return files
}
