import type {Env} from '../../platform/env'
/** Deletes are journaled by the upload-row trigger in the consuming transaction. */
export async function sweepUploads(env:Env){
 await env.DB.prepare('DELETE FROM api_uploads WHERE id IN (SELECT id FROM api_uploads WHERE expires_at<=? LIMIT 25)').bind(Date.now()).run()
 const rows=await env.DB.prepare('SELECT object_key FROM api_upload_disposals ORDER BY object_key LIMIT 50').all<{object_key:string}>()
 if(!rows.results.length)return
 await dispose(env,rows.results.map(row=>row.object_key))
}
export function consumeUploads(env:Env,project:string,credential:string,files:{uploadId?:string}[]){
 return files.filter(file=>file.uploadId).flatMap(file=>[
  env.DB.prepare('INSERT INTO ik_d1_assertions(ok) SELECT CASE WHEN EXISTS(SELECT 1 FROM api_uploads WHERE project_id=? AND credential_id=? AND id=? AND expires_at>?) THEN 1 ELSE 0 END').bind(project,credential,file.uploadId!,Date.now()),
  env.DB.prepare('DELETE FROM api_uploads WHERE project_id=? AND credential_id=? AND id=?').bind(project,credential,file.uploadId!)
 ])
}

async function dispose(env:Env,keys:string[]){
 if(!keys.length)return
 await env.FILES.delete(keys)
 await env.DB.prepare('DELETE FROM api_upload_disposals WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).run()
}
/** Complete these committed uploads even when unrelated expired work is queued. */
export async function finishUploads(env:Env,project:string,files:{uploadId?:string}[]){
 const keys=files.filter(file=>file.uploadId).map(file=>`api-uploads/${project}/${file.uploadId}`)
 if(!keys.length)return
 const rows=await env.DB.prepare('SELECT object_key FROM api_upload_disposals WHERE object_key IN (SELECT value FROM json_each(?))').bind(JSON.stringify(keys)).all<{object_key:string}>()
 await dispose(env,rows.results.map(row=>row.object_key))
}
