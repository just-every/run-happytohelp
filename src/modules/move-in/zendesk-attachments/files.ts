import type {Env} from '../../../platform/env'
import {delivered,type Transfer} from './download'
import type {Found} from './ledger'
import {fenced,runAllowed,type AttachmentRun} from './store'
const CONTENT_TYPE=/^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/i
/** Zendesk's file name without control characters, at most 200 characters. */
export function fileName(value:unknown){const text=typeof value==='string'?value.replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,200):'';return text||'attachment'}
/** A well-formed media type (parameters left out), else a plain download. */
export function contentType(value:unknown){const type=typeof value==='string'?value.split(';')[0].trim().toLowerCase():'';return CONTENT_TYPE.test(type)?type:'application/octet-stream'}
/** Private R2, under the same key as supplied import bytes for this attachment's media. */
export const fileKey=(run:AttachmentRun,conversation:string,file:Found)=>`import-bytes/${run.project_id}/${conversation}/${file.mediaId}`
const mediaExists=async(env:Env,id:string)=>!!await env.DB.prepare('SELECT 1 FROM media WHERE id=?').bind(id).first()
/** Streams a download into R2 with its known length. R2 keeps exactly those bytes or
 * nothing: a body that ends early or runs past its length fails the put. Returns null
 * once stored, else the refusal code. No URL or token reaches R2. */
export async function putFile(env:Env,key:string,file:Found,download:Transfer,run?:AttachmentRun){
 if(!run||run.authority_mode!=='rehearsal'){const refused=await delivered(download,env.FILES.put(key,download.body,{httpMetadata:{contentType:contentType(file.contentType)}}));if(refused)await env.FILES.delete(key);return refused}
 const allowed=async()=>!run||await runAllowed(env,run)&&!!await env.DB.prepare(file.visible?'SELECT 1 FROM messages WHERE id=? AND project_id=? AND erased_at IS NULL':'SELECT 1 FROM move_in_notes WHERE id=? AND project_id=?').bind(file.messageId,run.project_id).first()
 const cancel=async()=>{await download.body.cancel().catch(()=>{});await download.piped.catch(()=>{})}
 if(!await allowed()){await cancel();throw new Error('import_authority_revoked')}
 // A killed transfer can leave its nonce. It is not attachment content and a later
 // explicitly resumed delivery replaces it only by its exact etag.
 await fenced(env,run,[env.DB.prepare("UPDATE move_in_zendesk_attachments SET run_id=?,updated_at=? WHERE project_id=? AND attachment_id=? AND state<>'stored'").bind(run.id,Date.now(),run.project_id,file.attachmentId)])
 const prior=await env.FILES.head(key),nonce=crypto.randomUUID()
 const reservation=await env.FILES.put(key,nonce,{onlyIf:prior?.customMetadata?.moveInReservation?{etagMatches:prior.etag}:{etagDoesNotMatch:'*'},customMetadata:{moveInReservation:run?.id??'transfer'}})
 if(!reservation){await cancel();throw new Error('source_custody_race')}
 const remove=async(etag:string)=>{if((await env.FILES.head(key))?.etag===etag)await env.FILES.delete(key)}
 if(!await allowed()){await cancel();await remove(reservation.etag);throw new Error('import_authority_revoked')}
 const stored=env.FILES.put(key,download.body,{onlyIf:{etagMatches:reservation.etag},httpMetadata:{contentType:contentType(file.contentType)},customMetadata:{moveInAttachmentRun:run.id}})
 const refused=await delivered(download,stored),written=await stored.catch(()=>null)
 if(!written&&!refused)throw new Error('source_custody_erased')
 if(refused){await remove(written?.etag??reservation.etag);return refused}
 if(!await allowed()){await remove(written!.etag);throw new Error('import_authority_revoked')}
 return null
}
/** One batch, fenced by the member's authority and the comment still being held, adds the
 * media row of the bytes at `key` (on its message, or with no message for a private note
 * and its note link) and marks the attachment stored. Bytes whose comment is no longer
 * held, or whose batch fails, leave R2 again. */
export async function recordFile(env:Env,run:AttachmentRun,conversation:string,file:Found,key:string,size:number):Promise<'stored'|'not_held'>{
 const held=file.visible?'EXISTS(SELECT 1 FROM messages WHERE id=? AND project_id=? AND conversation_id=? AND erased_at IS NULL)':'EXISTS(SELECT 1 FROM move_in_notes WHERE id=? AND project_id=? AND conversation_id=?)'
 try{
  await fenced(env,run,[
   env.DB.prepare(`INSERT OR IGNORE INTO media(id,project_id,conversation_id,uploaded_by,object_key,filename,content_type,size,message_id,created_at) SELECT ?,?,?,'import:zendesk',?,?,?,?,?,? WHERE ${held}`).bind(file.mediaId,run.project_id,conversation,key,fileName(file.fileName),contentType(file.contentType),size,file.visible?file.messageId:null,file.createdAt,file.messageId,run.project_id,conversation),
   ...(file.visible?[]:[env.DB.prepare('INSERT OR IGNORE INTO move_in_note_media(note_id,media_id) SELECT ?,id FROM media WHERE id=? AND message_id IS NULL').bind(file.messageId,file.mediaId)]),
   env.DB.prepare("UPDATE move_in_zendesk_attachments SET state='stored',reason=NULL,run_id=?,updated_at=? WHERE project_id=? AND attachment_id=? AND EXISTS(SELECT 1 FROM media WHERE id=?)").bind(run.id,Date.now(),run.project_id,file.attachmentId,file.mediaId)])
 }catch(error){if(!await mediaExists(env,file.mediaId).catch(()=>true))await env.FILES.delete(key);throw error}
 if(await mediaExists(env,file.mediaId))return 'stored'
 await env.FILES.delete(key);return 'not_held'
}
