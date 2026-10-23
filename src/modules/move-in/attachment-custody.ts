import type {Env} from '../../platform/env'
import type {ImportPlan} from '../import-kit/src/d1/index'
import {sha256} from '../import-kit/src/provenance/identity'
import {assertAuthority,guarded} from './context'
import {putPrivate} from './private-custody'
import type {Run} from './types'

export async function stageAttachmentBytes(env:Env,run:Run,plan:ImportPlan){
 const files=new Map<string,any>(JSON.parse(run.files_json).map((file:any)=>[file.name,file]))
 for(const entry of plan.entries)for(const effect of entry.effects){
  const value=effect.value as any
  for(const descriptor of value.source?.attachments??[]){
   const media=value.tables.media.find((row:any)=>row.id===descriptor.mediaId),file=files.get(descriptor.member)
   if(!media||!file||file.sha256!==descriptor.sha256||file.size!==descriptor.size)throw Error('attachment_custody_changed')
   const native=await env.DB.prepare('SELECT object_key FROM media WHERE project_id=? AND id=?').bind(run.project_id,media.id).first<{object_key:string}>()
   if(native){
    const object=await env.FILES.get(native.object_key)
    if(native.object_key!==media.object_key||!object||sha256(new Uint8Array(await object.arrayBuffer()))!==descriptor.sha256)throw Error('native_attachment_bytes_conflict')
    continue
   }
   const held=await env.DB.prepare('SELECT * FROM move_in_attachment_objects WHERE media_id=?').bind(media.id).first<any>()
   if(held&&(held.run_id!==run.id||held.sha256!==descriptor.sha256||held.object_key!==media.object_key))throw Error('attachment_reservation_conflict')
   if(!held){
    if(await env.FILES.head(media.object_key))throw Error('attachment_reservation_conflict')
    await guarded(env,run,[env.DB.prepare('INSERT INTO move_in_attachment_objects(media_id,project_id,run_id,conversation_id,contact_id,uploaded_by,object_key,sha256,size) VALUES(?,?,?,?,?,?,?,?,?)').bind(media.id,run.project_id,run.id,effect.targetId,value.tables.conversations[0].contact_id,media.uploaded_by,media.object_key,descriptor.sha256,descriptor.size)])
   }
   const object=await env.FILES.get(file.key),bytes=object?new Uint8Array(await object.arrayBuffer()):null
   if(!bytes||sha256(bytes)!==descriptor.sha256)throw Error('attachment_custody_changed')
   await putPrivate(env,run,media.object_key,bytes,{httpMetadata:{contentType:media.content_type},customMetadata:{sha256:descriptor.sha256}})
  }
 }
 await assertAuthority(env,run)
}

export async function clearUnpublishedAttachments(env:Env,run:Run){
 const rows=(await env.DB.prepare('SELECT media_id,object_key FROM move_in_attachment_objects a WHERE a.run_id=? AND NOT EXISTS(SELECT 1 FROM media m WHERE m.id=a.media_id)').bind(run.id).all<{media_id:string;object_key:string}>()).results
 await assertAuthority(env,run)
 for(const row of rows)await env.FILES.delete(row.object_key)
 if(rows.length)await guarded(env,run,[env.DB.prepare('DELETE FROM move_in_attachment_objects WHERE run_id=? AND NOT EXISTS(SELECT 1 FROM media m WHERE m.id=move_in_attachment_objects.media_id)').bind(run.id)])
}
