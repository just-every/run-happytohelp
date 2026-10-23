import {HTTPException} from 'hono/http-exception'
import {auditLegacyCustody} from './legacy-identities'
import {messages as erasedMessages} from '../management/contact-erasure/scope'
import type {Env} from '../../platform/env'
import {contactDigests,sourceDigest} from './identities'
import {clearedIncompleteRuns} from './uninterpreted-identities'
export interface ErasureIdentity {email?:unknown;external_id?:unknown;metadata_json?:string|null}
function identityFenceStatements(env:Env,projectId:string,seeds:string[]){
 const encoded=JSON.stringify(seeds)
 return [env.DB.prepare('INSERT OR IGNORE INTO move_in_erased_identities(project_id,digest) SELECT ?,value FROM json_each(?)').bind(projectId,encoded),
  // Follow both sides of known aliases before a concurrent native edit or a
  // resumed erasure can lose the originally admitted identity snapshot.
  env.DB.prepare(`WITH RECURSIVE aliases(digest) AS (
   SELECT value FROM json_each(?2)
   UNION SELECT l.source_digest FROM move_in_identity_links l JOIN aliases a ON a.digest=l.digest WHERE l.project_id=?1
   UNION SELECT l.digest FROM move_in_identity_links l JOIN aliases a ON a.digest=l.source_digest WHERE l.project_id=?1
  ) INSERT OR IGNORE INTO move_in_erased_identities(project_id,digest) SELECT ?1,digest FROM aliases`).bind(projectId,encoded)]
}
export async function retainErasureIdentity(env:Env,projectId:string,contactId:string,contact:ErasureIdentity){
 const origin=await env.DB.prepare("SELECT vendor,source_id FROM move_in_origins WHERE project_id=? AND target_kind='contact' AND target_id=?").bind(projectId,contactId).first<any>()
 const seeds=contactDigests(projectId,contact);if(origin)seeds.push(sourceDigest(projectId,origin.vendor,origin.source_id))
 return identityFenceStatements(env,projectId,seeds)
}
/** Mixed artifacts are indivisible custody: erase each run that holds an erased
 * identity, retaining only its non-content replay tombstone. Other people's runs,
 * and native imported records, remain in place. */
export async function fenceImportErasure(env:Env,projectId:string,contactId:string){
 if(!await auditLegacyCustody(env,projectId))throw new HTTPException(409,{message:'Older import originals are being indexed for erasure. Retry erasure to continue; completed identity indexing is retained.'})
 const contact=await env.DB.prepare('SELECT email,external_id,metadata_json FROM contacts WHERE project_id=? AND id=?').bind(projectId,contactId).first<any>()
 const origin=await env.DB.prepare("SELECT vendor,source_id FROM move_in_origins WHERE project_id=? AND target_kind='contact' AND target_id=?").bind(projectId,contactId).first<any>()
 const seeds=contactDigests(projectId,contact??{});if(origin)seeds.push(sourceDigest(projectId,origin.vendor,origin.source_id))
 await env.DB.batch(identityFenceStatements(env,projectId,seeds))
 // Incomplete runs are checked against their uninterpreted-value index; any
 // incomplete run not cleared here (no index, or admitted since) stays in scope.
 const cleared=await clearedIncompleteRuns(env,projectId)
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO move_in_erasure_runs(project_id,contact_id,run_id,job_id)
   SELECT ?1,?2,r.id,r.kit_job_id FROM move_in_runs r WHERE r.project_id=?1 AND r.state<>'erased' AND
   ((r.identity_complete=0 AND r.id NOT IN (SELECT value FROM json_each(?3))) OR EXISTS(SELECT 1 FROM move_in_identity_links x JOIN move_in_erased_identities e ON e.project_id=x.project_id AND e.digest=x.digest WHERE x.run_id=r.id AND x.project_id=?1))`).bind(projectId,contactId,JSON.stringify(cleared)),
  // Reused decisions retain an owner-job FK. Fence their complete import groups
  // before deleting an erased owner's journal, including transitive reuse.
  env.DB.prepare(`WITH RECURSIVE affected(id) AS (
   SELECT j.id FROM ik_jobs j JOIN move_in_erasure_runs e ON j.id=e.job_id OR (j.destination=e.project_id AND (j.operation_key=e.run_id OR substr(j.operation_key,1,length(e.run_id)+1)=e.run_id||'/')) WHERE e.project_id=?1 AND e.contact_id=?2
   UNION SELECT d.job_id FROM ik_d1_entries d JOIN affected a ON d.owner_job_id=a.id
  ) INSERT OR IGNORE INTO move_in_erasure_runs(project_id,contact_id,run_id,job_id)
  SELECT ?1,?2,r.id,r.kit_job_id FROM move_in_runs r WHERE r.project_id=?1 AND EXISTS(SELECT 1 FROM ik_jobs j JOIN affected a ON a.id=j.id WHERE j.destination=r.project_id AND (j.id=r.kit_job_id OR j.operation_key=r.id OR substr(j.operation_key,1,length(r.id)+1)=r.id||'/'))`).bind(projectId,contactId),
  env.DB.prepare(`UPDATE move_in_runs SET state='erased',error=NULL WHERE id IN (SELECT run_id FROM move_in_erasure_runs WHERE project_id=? AND contact_id=?)`).bind(projectId,contactId)
 ])
 // Page custody descriptors and R2 keys. No complete workspace/run/object
 // inventory is accumulated in JS, even after many historical imports.
 let after=''
 for(;;){const runs=(await env.DB.prepare('SELECT r.id,r.object_key,r.files_json FROM move_in_runs r JOIN move_in_erasure_runs e ON e.run_id=r.id WHERE e.project_id=? AND e.contact_id=? AND r.id>? ORDER BY r.id LIMIT 10').bind(projectId,contactId,after).all<any>()).results;if(!runs.length)break
  for(const run of runs){let cursor:string|undefined
   const retain=async(keys:string[])=>{if(keys.length)await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO move_in_erasure_objects(project_id,contact_id,run_id,object_key) SELECT ?1,?2,?3,value FROM json_each(?4)").bind(projectId,contactId,run.id,JSON.stringify(keys))])}
   await retain([...new Set<string>([run.object_key,...JSON.parse(run.files_json).map((f:any)=>f.key)].filter(Boolean))])
   const pending=(await env.DB.prepare('SELECT object_key FROM move_in_attachment_objects a WHERE a.run_id=? AND NOT EXISTS(SELECT 1 FROM media m WHERE m.id=a.media_id)').bind(run.id).all<{object_key:string}>()).results
   await retain(pending.map(row=>row.object_key))
   do{const listed=await env.FILES.list({prefix:`move-in/${projectId}/${run.id}/`,cursor,limit:100});await retain(listed.objects.map(object=>object.key));cursor=listed.truncated?listed.cursor:undefined}while(cursor)
   after=run.id
  }
 }
 return contact as ErasureIdentity|null
}
export function importErasureStatements(env:Env,projectId:string,contactId:string){
 const jobs=`SELECT j.id FROM ik_jobs j JOIN move_in_erasure_runs e ON j.id=e.job_id OR ((j.operation_key=e.run_id OR substr(j.operation_key,1,length(e.run_id)+1)=e.run_id||'/') AND j.destination=e.project_id) WHERE e.project_id=?1 AND e.contact_id=?2`,runs='SELECT run_id FROM move_in_erasure_runs WHERE project_id=?1 AND contact_id=?2',conversations='SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2',bind=(sql:string)=>env.DB.prepare(sql).bind(projectId,contactId)
 return [
  bind(`DELETE FROM move_in_attachment_objects WHERE project_id=?1 AND (contact_id=?2 OR uploaded_by=?2 OR (run_id IN (${runs}) AND NOT EXISTS(SELECT 1 FROM media m WHERE m.id=move_in_attachment_objects.media_id)))`),
  bind(`DELETE FROM move_in_message_sources WHERE project_id=?1 AND message_id IN (SELECT id FROM messages WHERE ${erasedMessages})`),
  bind(`DELETE FROM move_in_notes WHERE project_id=?1 AND (conversation_id IN (${conversations}) OR (json_extract(author_json,'$.role')='contact' AND EXISTS(SELECT 1 FROM move_in_origins o JOIN move_in_conversations c ON c.conversation_id=move_in_notes.conversation_id AND c.project_id=o.project_id AND c.vendor=o.vendor WHERE o.project_id=?1 AND o.target_kind='contact' AND o.target_id=?2 AND o.source_id=json_extract(move_in_notes.author_json,'$.id'))))`),
  bind(`DELETE FROM move_in_origins WHERE project_id=?1 AND ((target_kind='contact' AND target_id=?2) OR (NOT(target_kind='contact' AND target_id<>?2) AND (target_kind,target_id) IN (SELECT target_kind,target_id FROM ik_provenance WHERE job_id IN (${jobs}))))`),
  bind(`UPDATE ik_d1_creation_plans SET released=1 WHERE released=0 AND job_id IN (${jobs})`),
  ...['ik_d1_plan_index','ik_d1_indexed_jobs','ik_d1_stream_pages','ik_d1_reversal_reports','ik_d1_creation_plans','ik_d1_history','ik_d1_entries','ik_provenance','ik_stages','ik_sources','ik_batches','ik_d1_plan_chunks','ik_d1_original_chunks','ik_originals','ik_original_sets'].map(table=>bind(`DELETE FROM ${table} WHERE job_id IN (${jobs})`)),
  bind(`DELETE FROM ik_jobs WHERE id IN (${jobs})`),bind(`DELETE FROM move_in_batches WHERE run_id IN (${runs})`),bind(`DELETE FROM move_in_identity_links WHERE run_id IN (${runs})`),bind(`DELETE FROM move_in_records WHERE run_id IN (${runs})`),
  bind(`UPDATE move_in_runs SET state='erased',filename='',object_key='',session_hash='',files_json='[]',diagnostics_json='[]',review_fingerprint=NULL,total=0,plan_json=NULL,report_json=NULL,kit_job_id=NULL,error=NULL WHERE id IN (${runs})`),
  bind(`UPDATE move_in_conversations SET source_id='',subject='',source_channel='' WHERE project_id=?1 AND conversation_id IN (${conversations})`),
  bind('DELETE FROM move_in_erasure_objects WHERE project_id=?1 AND contact_id=?2'),
  bind('DELETE FROM move_in_erasure_runs WHERE project_id=?1 AND contact_id=?2')
 ]
}
