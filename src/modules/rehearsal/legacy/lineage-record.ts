import type {SqlGuard} from '../../../platform/integration-authority'
import {scopeAllowed} from '../../legacy-import/custody/scope'
export interface Lineage {
 manifest_sha256:string;origin_sha256:string;rehearsal_id:string;rehearsal_generation:number
 custody_project_id:string;source_project_id:string;custodian_id:string;day:string
 since:number;source_cutoff:number;snapshot_clock:number;watermark:number;since_iso:string;source_cutoff_iso:string;snapshot_clock_iso:string;watermark_iso:string;verified_at:number|null;created_at:number
}
export const getLineage=(db:D1Database,sha:string)=>db.prepare('SELECT * FROM legacy_rehearsal_lineage WHERE manifest_sha256=?').bind(sha).first<Lineage>()
export function lineagePredicate(l:Lineage):SqlGuard {
 return {sql:`SELECT 1 FROM legacy_rehearsal_lineage l JOIN legacy_workspace_adoptions a ON a.manifest_sha256=l.origin_sha256
 WHERE l.manifest_sha256=? AND l.origin_sha256=? AND l.rehearsal_id=? AND l.rehearsal_generation=?
 AND l.custody_project_id=? AND l.source_project_id=? AND l.custodian_id=?
 AND a.state='created' AND a.policy_version=2 AND a.custody_project_id=l.custody_project_id AND a.source_project_id=l.source_project_id AND a.approver_id=l.custodian_id
 AND EXISTS(SELECT 1 FROM legacy_import_worker_runs r WHERE r.manifest_sha256=a.manifest_sha256 AND r.contract_version=2 AND r.verified_at IS NOT NULL)
 AND EXISTS(SELECT 1 FROM projects WHERE id=l.source_project_id)
 AND EXISTS(SELECT 1 FROM project_settings WHERE project_id=l.source_project_id)
 AND ${scopeAllowed('l.source_project_id')} AND ${scopeAllowed('l.custody_project_id')}`,
 params:[l.manifest_sha256,l.origin_sha256,l.rehearsal_id,l.rehearsal_generation,l.custody_project_id,l.source_project_id,l.custodian_id]}
}
