import {sweepCanonicalNonces} from '../worker/canonical-custody'
import {seedLegacyPage,seedLegacyInventory,seedLegacyScopeRun} from './seed'
import type {Env} from '../../../platform/env'
import {dbNow} from '../lease'
import {associatedPage,closeCustody,sourceCleanupStatus} from './fence'
import {CUSTODY_JOB,getCustody,type Custody,type CleanupWake} from './types'
/** Each invocation deletes <=100 exact R2 keys and <=250 child rows TOTAL. */
const children=['legacy_import_context','legacy_import_context_messages','legacy_import_context_media','legacy_import_context_identities','legacy_import_worker_parts'] as const
const guard=(db:D1Database,c:Custody,token:string)=>db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND generation=? AND cleanup_token=? AND cleanup_until>${dbNow} AND status IN ('invalidated','purging','purged'))`).bind(c.manifest_sha256,c.generation,token)
async function batch(db:D1Database,c:Custody,token:string,statements:D1PreparedStatement[]){return db.batch([guard(db,c,token),...statements,guard(db,c,token),db.prepare('DELETE FROM ik_d1_assertions')])}
/** Cleanup uses durable tombstone authority and never grants native write authority. */
export async function cleanupStep(env:Pick<Env,'DB'|'FILES'>,sha:string,generation:number){
 const c=await getCustody(env.DB,sha)
 if(!c||c.generation!==generation||!['invalidated','purging','purged'].includes(c.status))return {keys:0,rows:0,pending:false}
 const token=crypto.randomUUID(),claimed=await env.DB.prepare(`UPDATE legacy_package_custody SET cleanup_token=?,cleanup_until=${dbNow}+60000 WHERE manifest_sha256=? AND generation=? AND (cleanup_until IS NULL OR cleanup_until<=${dbNow}) RETURNING manifest_sha256`).bind(token,sha,generation).first()
 if(!claimed)return {keys:0,rows:0,pending:true}
 let keys=0,rows=0
 try{
  if(!c.seeding_complete)return await seedLegacyPage(env,c,token)
  // A completed tombstone periodically sweeps its opaque coordinates for late nonce placeholders.
  // Original key rows stay as a cleanup ledger; never list a prefix or accept them as source.
  if(c.status==='purged'){
   const page=await env.DB.prepare('SELECT key FROM legacy_package_keys WHERE manifest_sha256=? AND key>? ORDER BY key LIMIT 100').bind(sha,c.cleanup_after).all<{key:string}>()
   if(page.results.length){await env.FILES.delete(page.results.map(row=>row.key));keys=page.results.length;await batch(env.DB,c,token,[env.DB.prepare('UPDATE legacy_package_custody SET cleanup_after=? WHERE manifest_sha256=?').bind(page.results.at(-1)!.key,sha)])}
   else await batch(env.DB,c,token,[env.DB.prepare("UPDATE legacy_package_custody SET cleanup_after='' WHERE manifest_sha256=?").bind(sha)])
   keys+=await sweepCanonicalNonces(env,sha,100-keys)
   return {keys,rows,pending:false}
  }
  const page=await env.DB.prepare('SELECT key FROM legacy_package_keys WHERE manifest_sha256=? AND cleanup_state=0 ORDER BY key LIMIT 100').bind(sha).all<{key:string}>()
  if(page.results.length){
   await env.FILES.delete(page.results.map(row=>row.key));keys=page.results.length
   await batch(env.DB,c,token,[env.DB.prepare('UPDATE legacy_package_keys SET cleanup_state=1 WHERE manifest_sha256=? AND key IN (SELECT value FROM json_each(?))').bind(sha,JSON.stringify(page.results.map(row=>row.key)))])
  }
  let tableIndex=c.cleanup_table
  for(;tableIndex<children.length&&rows<250;tableIndex++){
   const table=children[tableIndex],page=await env.DB.prepare(`SELECT rowid FROM ${table} WHERE run_id=? LIMIT ?`).bind(`legacy-package:${sha}`,250-rows).all<{rowid:number}>()
   if(page.results.length){await batch(env.DB,c,token,[env.DB.prepare(`DELETE FROM ${table} WHERE run_id=? AND rowid IN (SELECT value FROM json_each(?))`).bind(`legacy-package:${sha}`,JSON.stringify(page.results.map(row=>row.rowid)))]);rows+=page.results.length}
   if(rows===250)break
  }
  // Old v1 filenames may contain personal words. Once their bodies are deleted,
  // remove these cleanup-only coordinates in the same bounded D1 row allowance.
  if(c.cleanup_only&&rows<250){
   const clean=await env.DB.prepare('SELECT key FROM legacy_package_keys WHERE manifest_sha256=? AND cleanup_state=1 ORDER BY key LIMIT ?').bind(sha,250-rows).all<{key:string}>()
   if(clean.results.length){await batch(env.DB,c,token,[env.DB.prepare('DELETE FROM legacy_package_keys WHERE manifest_sha256=? AND cleanup_state=1 AND key IN (SELECT value FROM json_each(?))').bind(sha,JSON.stringify(clean.results.map(r=>r.key)))]);rows+=clean.results.length}
  }
  const remaining=await env.DB.prepare('SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=? AND cleanup_state=0 LIMIT 1').bind(sha).first()
  const coordinates=c.cleanup_only?await env.DB.prepare('SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=? LIMIT 1').bind(sha).first():null
  const done=tableIndex>=children.length&&!remaining&&!coordinates
  await batch(env.DB,c,token,[...(done?[env.DB.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT ${children.map(table=>`NOT EXISTS(SELECT 1 FROM ${table} WHERE run_id=?1)`).join(' AND ')} AND EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=?2 AND seeding_complete=1 AND (cleanup_only=0 OR NOT EXISTS(SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=?2))) AND NOT EXISTS(SELECT 1 FROM legacy_package_keys WHERE manifest_sha256=?2 AND cleanup_state=0)`).bind(`legacy-package:${sha}`,sha)]:[]),env.DB.prepare(`UPDATE legacy_package_custody SET cleanup_table=?,status=?,purged_at=CASE WHEN ? THEN ${dbNow} ELSE purged_at END WHERE manifest_sha256=? AND generation=?`).bind(tableIndex,done?'purged':'purging',done?1:0,sha,generation)])
  keys+=await sweepCanonicalNonces(env,sha,100-keys)
  return {keys,rows,pending:!done}
 }finally{
  await env.DB.prepare(`UPDATE legacy_package_custody SET cleanup_token=NULL,cleanup_until=NULL,next_cleanup_at=${dbNow}+? WHERE manifest_sha256=? AND generation=? AND cleanup_token=?`).bind(c.status==='purged'?60000:1000,sha,generation,token).run()
 }
}
async function invalidReason(env:Pick<Env,'DB'>,c:Custody){
 const scopes=[c.custody_project_id,c.source_project_id,...(c.destination_project_id?[c.destination_project_id]:[])]
 for(const scope of new Set(scopes)){
  const row=await env.DB.prepare('SELECT reason FROM legacy_package_scope_fences WHERE project_id=?').bind(scope).first<{reason:'erasure'|'workspace_deleted'}>()
  if(row)return row.reason
  if(await env.DB.prepare('SELECT 1 FROM contact_erasures WHERE project_id=? UNION ALL SELECT 1 FROM contact_erasure_leases WHERE project_id=? LIMIT 1').bind(scope,scope).first())return 'erasure'
 }
 return 'expired' as const
}
/** One native erase request performs one package quantum; following requests continue the ledger. */
export async function cleanupScopeStep(env:Pick<Env,'DB'|'FILES'>,projectId:string){
 await seedLegacyInventory(env)
 await seedLegacyScopeRun(env,projectId)
 const c=await env.DB.prepare(`SELECT * FROM legacy_package_custody WHERE manifest_sha256 IN (${associatedPage(true)}) ORDER BY manifest_sha256 LIMIT 1`).bind(projectId,'',1).first<Custody>()
 if(c){const closed=await closeCustody(env,c.manifest_sha256,await invalidReason(env,c));if(closed)await cleanupStep(env,closed.manifest_sha256,closed.generation)}
 return sourceCleanupStatus(env,projectId)
}
export async function enqueueCleanup(env:Pick<Env,'JOBS'>,c:Custody){
 const job:CleanupWake={type:CUSTODY_JOB,id:c.manifest_sha256,generation:c.generation}
 try{await (env.JOBS as unknown as {send(job:CleanupWake):Promise<void>}).send(job)}catch{/* Durable due row remains discoverable. */}
}
/** C calls before the inactive-project guard, splitting the existing cron reservation.
 * Discovery closes at most ten packages, then enqueues only; never copies/imports source. */
export async function discoverCleanup(env:Pick<Env,'DB'|'FILES'|'JOBS'>,limit=10){
 await seedLegacyInventory(env)
 limit=Math.min(10,Math.max(1,Math.floor(limit)))
 const fence=await env.DB.prepare("SELECT project_id,cleanup_after FROM legacy_package_scope_fences WHERE cleanup_done=0 ORDER BY fenced_at,project_id LIMIT 1").first<{project_id:string;cleanup_after:string}>()
 let rows:Custody[]=[]
 if(fence){
  rows=(await env.DB.prepare(`SELECT * FROM legacy_package_custody WHERE manifest_sha256 IN (${associatedPage()}) ORDER BY manifest_sha256 LIMIT ?3`).bind(fence.project_id,fence.cleanup_after,limit).all<Custody>()).results
 }else{
  rows=(await env.DB.prepare(`SELECT * FROM legacy_package_custody WHERE status IN ('admitting','ready') AND expires_at<=${dbNow} ORDER BY expires_at,manifest_sha256 LIMIT ?`).bind(limit).all<Custody>()).results
 }
 if(!rows.length)rows=(await env.DB.prepare(`SELECT * FROM legacy_package_custody WHERE status IN ('invalidated','purging','purged') AND next_cleanup_at<=${dbNow} AND (cleanup_until IS NULL OR cleanup_until<=${dbNow}) ORDER BY next_cleanup_at,manifest_sha256 LIMIT ?`).bind(limit).all<Custody>()).results
 for(const c of rows){const closed=['admitting','ready'].includes(c.status)?await closeCustody(env,c.manifest_sha256,await invalidReason(env,c)):c;if(closed)await enqueueCleanup(env,closed)}
 if(fence){
  // Cursor advances only over the fenced scope's page, never over another task's SHA.
  const page=await env.DB.prepare(`SELECT manifest_sha256 FROM legacy_package_custody WHERE manifest_sha256 IN (${associatedPage()}) ORDER BY manifest_sha256 LIMIT ?3`).bind(fence.project_id,fence.cleanup_after,limit).all<{manifest_sha256:string}>()
  await env.DB.prepare('UPDATE legacy_package_scope_fences SET cleanup_after=?,cleanup_done=? WHERE project_id=? AND cleanup_after=?').bind(page.results.at(-1)?.manifest_sha256??fence.cleanup_after,page.results.length?0:1,fence.project_id,fence.cleanup_after).run()
 }
 return rows.length
}
/** Workspace deletion closes its scope first; this bounded scheduling call is advisory. */
export async function scheduleScopeCleanup(env:Pick<Env,'DB'|'JOBS'>,projectId:string){
 const rows=await env.DB.prepare(`SELECT * FROM legacy_package_custody WHERE manifest_sha256 IN (${associatedPage(true)}) ORDER BY manifest_sha256 LIMIT 10`).bind(projectId,'',10).all<Custody>()
 for(const c of rows.results){const closed=await closeCustody(env,c.manifest_sha256,'workspace_deleted');if(closed)await enqueueCleanup(env,closed)}
}
