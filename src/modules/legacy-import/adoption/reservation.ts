import {dbNow} from '../lease'
import {scopeAllowed} from '../custody/authority'

/** Only unused reservations can be released. Custody tombstones retain the old
 * SHA, and scope erasure/deletion fences always outrank ordinary recovery. */
export const releasableReservation=`a.state='reserved' AND a.created_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM projects WHERE id=a.source_project_id)
 AND EXISTS(SELECT 1 FROM legacy_package_custody c WHERE c.manifest_sha256=a.manifest_sha256
  AND c.custody_project_id=a.custody_project_id AND c.source_project_id=a.source_project_id
  AND c.cleanup_only=0 AND c.mapping_policy_version=2
  AND ${scopeAllowed('c.custody_project_id')} AND ${scopeAllowed('c.source_project_id')}
  AND (c.destination_project_id IS NULL OR (${scopeAllowed('c.destination_project_id')}))
  AND (c.status IN ('invalidated','purging','purged') AND c.purge_reason IN ('expired','discarded')
   OR c.status IN ('admitting','ready') AND (min(c.expires_at,c.absolute_expires_at)<=${dbNow}
    OR EXISTS(SELECT 1 FROM legacy_import_worker_runs r WHERE r.manifest_sha256=a.manifest_sha256
     AND r.contract_version=2 AND r.state='paused' AND r.error_code IS NOT NULL))))`

/** Runs inside approval's guarded transaction. Closing the old generation and
 * stopping its worker is atomic with handing its unused destination to a new SHA. */
export function releaseReservation(db:D1Database,sha:string){
 return [
  db.prepare(`DELETE FROM legacy_workspace_adoptions AS a WHERE manifest_sha256=? AND ${releasableReservation}`).bind(sha),
  db.prepare(`UPDATE legacy_package_custody SET status='invalidated',generation=generation+1,
   purge_reason=CASE WHEN min(expires_at,absolute_expires_at)<=${dbNow} THEN 'expired' ELSE 'discarded' END,
   closed_at=${dbNow},next_cleanup_at=0 WHERE manifest_sha256=? AND status IN ('admitting','ready')
   AND NOT EXISTS(SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=?)`).bind(sha,sha),
  db.prepare(`UPDATE legacy_import_worker_runs SET version=version+1,state='stopped',error_code='source_invalidated',
   lease_token=NULL,lease_until=NULL,session_hash='',cursor_json='{}',metrics_json='{}',objects_json='{}',updated_at=${dbNow}
   WHERE manifest_sha256=? AND NOT EXISTS(SELECT 1 FROM legacy_workspace_adoptions WHERE manifest_sha256=?)`).bind(sha,sha),
 ]
}
