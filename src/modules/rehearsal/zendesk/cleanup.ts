import type {Env} from '../../../platform/env'
/** Only uncommitted files owned by closed consent are reduced here. Imported media stays. */
const pending=`FROM move_in_zendesk_attachments l JOIN move_in_zendesk_attachment_pulls r ON r.id=l.run_id JOIN rehearsal_grants g ON g.id=r.rehearsal_id WHERE g.id=? AND g.state='closed' AND l.state<>'stored' AND r.authority_mode='rehearsal'`
export async function pendingZendeskReservations(env:Pick<Env,'DB'>,id:string){return Number((await env.DB.prepare(`SELECT count(*) n ${pending}`).bind(id).first<{n:number}>())?.n??0)}
export async function cleanupZendeskReservations(env:Env,id:string){
 const rows=(await env.DB.prepare(`SELECT l.project_id,l.attachment_id,l.conversation_id,l.media_id,l.run_id ${pending} ORDER BY l.attachment_id LIMIT 20`).bind(id).all<{project_id:string;attachment_id:string;conversation_id:string;media_id:string;run_id:string}>()).results
 for(const row of rows){
  const key=`import-bytes/${row.project_id}/${row.conversation_id}/${row.media_id}`,object=await env.FILES.head(key)
  if(object&&(object.customMetadata?.moveInReservation===row.run_id||object.customMetadata?.moveInAttachmentRun===row.run_id)&&!await env.DB.prepare('SELECT 1 FROM media WHERE id=?').bind(row.media_id).first()){
   // Erasure/another successful write may already have replaced the object.
   const current=await env.FILES.head(key)
   if(current?.etag===object.etag)await env.FILES.delete(key)
  }
  await env.DB.prepare("UPDATE move_in_zendesk_attachments SET run_id=NULL WHERE project_id=? AND attachment_id=? AND run_id=? AND state<>'stored'").bind(row.project_id,row.attachment_id,row.run_id).run()
 }
 return pendingZendeskReservations(env,id)
}
