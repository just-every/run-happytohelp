import type {Env} from '../../../platform/env'
import {dbNow} from '../lease'
import {getCustody,type CustodyHandle,type CustodyPrincipal} from './types'
import {custodyBatch} from './authority'
/** Constant-size fence in the admitted-identity transaction. All three scopes consult it;
 * package/run closure is paged afterwards. Never depends on an importing session. */
export function scopeFenceStatements(db:D1Database,projectId:string,reason:'erasure'|'workspace_deleted'){
 return [db.prepare(`INSERT INTO legacy_package_scope_fences(project_id,generation,reason,fenced_at) VALUES(?,1,?,${dbNow}) ON CONFLICT(project_id) DO UPDATE SET generation=generation+1,reason=excluded.reason,fenced_at=excluded.fenced_at`).bind(projectId,reason)]
}
/** Explicit indexed union, including source/destination IDs before a native workspace exists. */
export const associated=`SELECT manifest_sha256 FROM legacy_package_custody WHERE custody_project_id=?1
 UNION SELECT manifest_sha256 FROM legacy_package_custody WHERE source_project_id=?1
 UNION SELECT manifest_sha256 FROM legacy_package_custody WHERE destination_project_id=?1`
/** Each scope index contributes at most limit coordinates; never materialize a workspace's full package set. */
export function associatedPage(pendingOnly=false){return ['custody_project_id','source_project_id','destination_project_id'].map(column=>`SELECT manifest_sha256 FROM (SELECT manifest_sha256 FROM legacy_package_custody WHERE ${column}=?1 AND manifest_sha256>?2 ${pendingOnly?"AND status<>'purged'":''} ORDER BY manifest_sha256 LIMIT ?3)`).join(' UNION ')+ ' ORDER BY manifest_sha256 LIMIT ?3'}
const sourceChildren=['legacy_import_context','legacy_import_context_messages','legacy_import_context_media','legacy_import_context_identities','legacy_import_worker_parts'] as const
export const pendingPackage=`(c.status<>'purged' OR EXISTS(SELECT 1 FROM legacy_package_keys k WHERE k.manifest_sha256=c.manifest_sha256 AND k.cleanup_state=0) OR ${sourceChildren.map(table=>`EXISTS(SELECT 1 FROM ${table} WHERE run_id='legacy-package:'||c.manifest_sha256)`).join(' OR ')})`
export const pendingScope=`EXISTS(SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256 IN (${associated}) AND ${pendingPackage})`
export function sourceCleanupAssertion(db:D1Database,projectId:string){
 return db.prepare(`INSERT INTO ik_d1_assertions(ok) SELECT NOT (${pendingScope})`).bind(projectId)
}
export async function sourceCleanupStatus(env:Pick<Env,'DB'>,projectId:string){
 const row=await env.DB.prepare(`SELECT count(*) packages FROM legacy_package_custody c WHERE c.manifest_sha256 IN (${associated}) AND ${pendingPackage}`).bind(projectId).first<{packages:number}>()
 return {cleanupPending:!!row?.packages,packages:row?.packages??0,code:row?.packages?'source_cleanup_pending':null}
}
/** Terminal closure for a single SHA; tombstones cannot be reopened. */
export async function closeCustody(env:Pick<Env,'DB'>,sha:string,reason:'erasure'|'workspace_deleted'|'expired'|'discarded'){
 const c=await getCustody(env.DB,sha)
 if(!c||!['admitting','ready'].includes(c.status))return c
 await env.DB.batch([
  env.DB.prepare(`UPDATE legacy_package_custody SET status='invalidated',generation=generation+1,purge_reason=?,closed_at=${dbNow},next_cleanup_at=0 WHERE manifest_sha256=? AND generation=? AND status IN ('admitting','ready')`).bind(reason,sha,c.generation),
  // One indexed run only, not every run in a workspace. Scrub source-derived diagnostics.
  env.DB.prepare(`UPDATE legacy_import_worker_runs SET version=version+1,state=CASE WHEN state='complete' THEN state ELSE 'stopped' END,error_code='source_invalidated',lease_token=NULL,lease_until=NULL,session_hash='',cursor_json='{}',metrics_json='{}',objects_json='{}',updated_at=${dbNow} WHERE manifest_sha256=? AND EXISTS(SELECT 1 FROM legacy_package_custody WHERE manifest_sha256=? AND status IN ('invalidated','purging'))`).bind(sha,sha),
 ])
 return getCustody(env.DB,sha)
}
export async function discardCustody(env:Pick<Env,'DB'>,h:CustodyHandle,p:CustodyPrincipal){
 // Caller must also require the existing native step-up for the explicit discard door.
 await custodyBatch(env,h,p,[env.DB.prepare(`UPDATE legacy_package_custody SET status='invalidated',generation=generation+1,purge_reason='discarded',closed_at=${dbNow},next_cleanup_at=0 WHERE manifest_sha256=? AND generation=?`).bind(h.sha,h.generation),env.DB.prepare("UPDATE legacy_import_worker_runs SET version=version+1,state=CASE WHEN state='complete' THEN state ELSE 'stopped' END,error_code='source_invalidated',lease_token=NULL,lease_until=NULL,session_hash='',cursor_json='{}',metrics_json='{}',objects_json='{}' WHERE manifest_sha256=?").bind(h.sha)],false)
}
