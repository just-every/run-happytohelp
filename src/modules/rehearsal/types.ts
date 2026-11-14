export interface RehearsalRef {rehearsal_id:string;rehearsal_generation:number}
export interface RehearsalGrant {
 id:string;generation:number;setup_project_id:string;owner_id:string;issuing_session_hash:string
 installation_id:string;app_origin:string;owner_epoch:number;owner_proof_at:number;owner_proof_method:string;owner_email:string;configured_owner_email:string;factor_policy:string
 origin_sha:string;legacy_project_id:string;legacy_watermark:number;legacy_cutoff:number;legacy_watermark_iso:string;legacy_cutoff_iso:string;legacy_enabled:number
 zendesk_project_id:string;zendesk_subdomain:string;zendesk_connection_generation:number;zendesk_client_id:string;zendesk_connected_at:number
 zendesk_base_pull_id:string;zendesk_cursor_json:string;zendesk_enabled:number
 copier_id:string;credential_hash:string|null;expiry_at:number;started_at:number;created_at:number
 state:'active'|'closed';closed_at:number|null;closure_reason:string|null;active_day:string|null
 cleanup_state:'pending'|'complete';cleanup_at:number|null
}
export const grantRef=(g:RehearsalGrant):RehearsalRef=>({rehearsal_id:g.id,rehearsal_generation:g.generation})
export class RehearsalError extends Error {constructor(readonly code:string,readonly status=409){super(code)}}
export function reject(code:string,status=409):never {throw new RehearsalError(code,status)}
