import type {Env} from '../../platform/env'
import type {SourceRecord} from '../import-kit/src/types'
import {sha256} from '../import-kit/src/provenance/identity'
import {completeNativeValue,nativeStatementCount} from './targets'
import type {NativeValue} from './readers/normalise'
import {attachmentMember,attachmentReferences} from './readers/attachment-references'
import {nativeId} from './readers/common'
import {LIMITS,recordKey,type PreparedMapping,type Run} from './types'

/** Review binds every source occurrence and byte digest. Canonical bytes are
 * separately reserved before the guarded ticket publication. */
export async function prepareAttachments(env:Env,run:Run,records:SourceRecord[],prepared:PreparedMapping){
 const files=new Map<string,{key:string;sha256:string;size:number}>(JSON.parse(run.files_json).map((file:any)=>[file.name,file]))
 const references=records.flatMap(record=>attachmentReferences(run.vendor,record.kind,record.payload))
 if(!references.length)return
 const candidates=references.map(ref=>nativeId(run.project_id,run.vendor,'attachment',`${ref.conversation}:${ref.occurrence}`))
 const existing=(await env.DB.prepare('SELECT * FROM media WHERE project_id=? AND id IN (SELECT value FROM json_each(?))').bind(run.project_id,JSON.stringify(candidates)).all<any>()).results
 const prior=new Map(existing.map(row=>[row.id,row])),hashes=new Map<string,string>()
 for(const record of records){
  const key=recordKey(record),effect=prepared.effects.get(key)?.find(effect=>effect.targetKind==='conversation')
  if(!effect||prepared.rejections.has(key))continue
  const refs=references.filter(ref=>ref.conversation===record.sourceId)
  if(!refs.length||!refs.some(ref=>files.has(attachmentMember(ref.conversation,ref.occurrence))))continue
  try{
   const value=effect.value as unknown as NativeValue,media:any[]=[],notes:any[]=[],attachments:any[]=[],seen=new Set<string>()
   for(const ref of refs){
    const file=files.get(attachmentMember(ref.conversation,ref.occurrence))
    if(!file)throw Error('attachment_bytes_missing')
    if(ref.unavailable)throw Error('attachment_deleted_or_unsafe')
    if(typeof ref.filename!=='string'||!ref.filename.trim()||ref.filename.length>500||/[\x00-\x1f\x7f]/.test(ref.filename))throw Error('attachment_filename_invalid')
    if(typeof ref.contentType!=='string'||!/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(ref.contentType))throw Error('attachment_content_type_invalid')
    if(ref.sizes.some(size=>!Number.isSafeInteger(size)||size!==file.size)||file.size===0)throw Error('attachment_size_mismatch')
    if(!ref.sizes.length)(prepared.omissions.get(key)??prepared.omissions.set(key,[]).get(key)!).push('attachment_source_size_unavailable_bytes_measured')
    const id=nativeId(run.project_id,run.vendor,'attachment',`${ref.conversation}:${ref.occurrence}`)
    if(seen.has(id))throw Error('duplicate_attachment_reference');seen.add(id)
    const message=nativeId(run.project_id,run.vendor,'message',`${ref.conversation}:${ref.message}`)
    const parent=(value.tables[ref.private?'move_in_notes':'messages']??[]).find(row=>row.id===message)
    if(!parent)throw Error('attachment_message_unavailable')
    const objectKey=`${run.project_id}/${effect.targetId}/${id}`
    const old=prior.get(id)
    if(old){
     if(!hashes.has(old.object_key)){const stored=await env.FILES.get(old.object_key);hashes.set(old.object_key,stored?sha256(new Uint8Array(await stored.arrayBuffer())):'missing')}
     if(old.object_key!==objectKey||hashes.get(old.object_key)!==file.sha256)throw Error('native_attachment_bytes_conflict')
    }
    const author=ref.private?JSON.parse(parent.author_json):{role:parent.actor_role,id:parent.actor_id}
    const uploadedBy=author.role==='contact'?(ref.private?nativeId(run.project_id,run.vendor,'contact',String(author.id)):author.id):`import:${run.vendor}`
    media.push({id,project_id:run.project_id,conversation_id:effect.targetId,uploaded_by:uploadedBy,object_key:objectKey,filename:ref.filename,content_type:ref.contentType,size:file.size,message_id:ref.private?null:message,created_at:parent.created_at})
    attachments.push({mediaId:id,member:attachmentMember(ref.conversation,ref.occurrence),sha256:file.sha256,size:file.size,sourceAttachmentId:ref.sourceAttachmentId})
    if(ref.private)notes.push({project_id:run.project_id,conversation_id:effect.targetId,note_id:message,media_id:id})
   }
   value.tables.media=media;value.tables.move_in_note_media=notes;value.source.attachments=attachments
   completeNativeValue('conversation',value)
   if(nativeStatementCount('conversation',value)>LIMITS.nativeStatements)throw Error('native_record_statement_limit')
   prepared.omissions.set(key,(prepared.omissions.get(key)??[]).filter(reason=>reason!=='attachments_metadata_retained_bytes_not_imported'))
  }catch(error){prepared.rejections.set(key,error instanceof Error?error.message:'attachment_mapping_failed')}
 }
}
