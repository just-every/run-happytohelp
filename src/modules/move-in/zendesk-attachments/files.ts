import type {Env} from '../../../platform/env'
import type {Found} from './ledger'
import {fenced,type AttachmentRun} from './store'
const CONTENT_TYPE=/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i
/** Zendesk's file name without control characters, at most 200 characters. */
export function fileName(value:unknown){const text=typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,200):'';return text||'attachment'}
/** A well-formed media type (parameters left out), else a plain download. */
export function contentType(value:unknown){const type=typeof value==='string'?value.split(';')[0].trim().toLowerCase():'';return CONTENT_TYPE.test(type)?type:'application/octet-stream'}
const mediaExists=async(env:Env,id:string)=>!!await env.DB.prepare('SELECT 1 FROM media WHERE id=?').bind(id).first()
/** The bytes go to private R2 under the same key as supplied import bytes, then one
 * batch, fenced by the member's authority and the comment still being held, adds the
 * media row (on its message, or with no message for a private note and its note link)
 * and marks the attachment stored. No URL or token reaches R2 or D1. */
export async function storeFile(env:Env,run:AttachmentRun,conversation:string,file:Found,bytes:Uint8Array):Promise<'stored'|'not_held'>{
 const key=`import-bytes/${run.project_id}/${conversation}/${file.mediaId}`,type=contentType(file.contentType)
 await env.FILES.put(key,bytes,{httpMetadata:{contentType:type}})
 const held=file.visible?'EXISTS(SELECT 1 FROM messages WHERE id=? AND project_id=? AND conversation_id=? AND erased_at IS NULL)':'EXISTS(SELECT 1 FROM move_in_notes WHERE id=? AND project_id=? AND conversation_id=?)'
 try{
  await fenced(env,run,[
   env.DB.prepare(`INSERT OR IGNORE INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) SELECT ?,?,?,'import:zendesk',?,?,?,?,?,? WHERE ${held}`).bind(file.mediaId,run.project_id,conversation,key,fileName(file.fileName),type,bytes.byteLength,file.visible?file.messageId:null,file.createdAt,file.messageId,run.project_id,conversation),
   ...(file.visible?[]:[env.DB.prepare('INSERT OR IGNORE INTO move_in_note_media(note_id,media_id) SELECT ?,id FROM media WHERE id=? AND message_id IS NULL').bind(file.messageId,file.mediaId)]),
   env.DB.prepare("UPDATE move_in_zendesk_attachments SET state='stored',reason=NULL,run_id=?,updated_at=? WHERE project_id=? AND attachment_id=? AND EXISTS(SELECT 1 FROM media WHERE id=?)").bind(run.id,Date.now(),run.project_id,file.attachmentId,file.mediaId)])
 }catch(error){if(!await mediaExists(env,file.mediaId).catch(()=>true))await env.FILES.delete(key);throw error}
 if(await mediaExists(env,file.mediaId))return 'stored'
 await env.FILES.delete(key);return 'not_held'
}
