import {Buffer} from 'node:buffer'
import {sha256} from '../import-kit/src/provenance/identity'
import {nativeId,sourceId} from './readers/common'
const allowed=new Set(['text/plain','application/pdf','image/png','image/jpeg','image/gif','image/webp'])
/** Only explicit canonical bytes are admitted. A source URL is never retrieved. */
export function suppliedAttachments({attachments,projectId,conversationId,messageId,visible,when,tables,omissions}:{attachments:unknown;projectId:string;conversationId:string;messageId:string;visible:boolean;when:number;tables:Record<string,any[]>;omissions:string[]}){
 if(attachments==null)return
 if(!Array.isArray(attachments))throw new Error('attachment_invalid')
 for(const a of attachments){
  if(!a||typeof a!=='object')throw new Error('attachment_invalid')
  if(a.base64==null&&a.sha256==null){omissions.push('attachments_metadata_retained_bytes_not_imported');continue}
  if(typeof a.base64!=='string'||!a.base64.length||a.base64.length>65536)throw new Error('attachment_bytes_limit')
  const bytes=Buffer.from(a.base64,'base64')
  if(bytes.toString('base64')!==a.base64||bytes.length!==a.size||!bytes.length)throw new Error('attachment_bytes_invalid')
  if(typeof a.sha256!=='string'||!/^[a-f0-9]{64}$/.test(a.sha256)||sha256(bytes)!==a.sha256)throw new Error('attachment_digest_mismatch')
  if(typeof a.name!=='string'||!a.name.trim()||a.name.length>200||/[\r\n\x00]/.test(a.name)||!allowed.has(a.content_type))throw new Error('attachment_metadata_invalid')
  if(tables.media.length>=20)throw new Error('attachment_count_limit')
  const id=nativeId(projectId,'freshdesk','media',`${messageId}:${sourceId(a.id,'freshdesk')}`)
  if(tables.media.some(row=>row.id===id))throw new Error('duplicate_attachment_id')
  tables.media.push({id,project_id:projectId,conversation_id:conversationId,uploaded_by:'import:freshdesk',object_key:`import-bytes/${projectId}/${conversationId}/${id}`,filename:a.name,content_type:a.content_type,size:bytes.length,message_id:visible?messageId:null,created_at:when})
  tables.move_in_attachment_bytes.push({media_id:id,project_id:projectId,conversation_id:conversationId,note_id:visible?null:messageId,sha256:a.sha256,base64:a.base64})
 }
}
