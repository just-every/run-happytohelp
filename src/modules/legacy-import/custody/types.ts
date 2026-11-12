export const CUSTODY_JOB='legacy-package.cleanup' as const
export const DAY=86_400_000
export interface Custody {
 manifest_sha256:string;custody_project_id:string;source_project_id:string;destination_project_id:string|null
 cleanup_only:number;seeding_complete:number
 generation:number;custody_generation:number;source_generation:number;destination_generation:number
 status:'admitting'|'ready'|'purging'|'purged'|'invalidated';mapping_policy_version:2;retention_state:'upload'|'progress'|'paused'|'stopped'|'resume'|'complete'
 created_at:number;last_explicit_activity_at:number;expires_at:number;absolute_expires_at:number
 purge_reason:'erasure'|'workspace_deleted'|'expired'|'discarded'|null;closed_at:number|null;purged_at:number|null
 cleanup_table:number;cleanup_after:string;cleanup_token:string|null;cleanup_until:number|null;next_cleanup_at:number
}
export interface CustodyPrincipal {projectId:string;actorId:string;sessionHash:string}
export interface CustodyHandle {sha:string;generation:number}
export interface CleanupWake {type:typeof CUSTODY_JOB;id:string;generation:number}
export class CustodyError extends Error {
 constructor(readonly code:'invalid_request'|'unsupported_package'|'custody_conflict'|'source_invalidated'|'source_expired'|'import_authority_revoked'|'file_conflict'|'source_reservation_pending'|'digest_mismatch'|'source_cleanup_pending',readonly status=409){super(code)}
}
export const getCustody=(db:D1Database,sha:string)=>db.prepare('SELECT * FROM legacy_package_custody WHERE manifest_sha256=?').bind(sha).first<Custody>()
export function validateSha(sha:string){if(!/^[0-9a-f]{64}$/.test(sha))throw new CustodyError('invalid_request',400)}
export function validateScope(scope:string){if(typeof scope!=='string'||!scope||new TextEncoder().encode(scope).length>512||/[\x00-\x1f\x7f]/.test(scope))throw new CustodyError('invalid_request',400)}
