import type {Env} from '../../platform/env'
/** Called inside the root erasure transaction before contact identity is redacted. */
export function portalErasureStatements(env:Env,projectId:string,contactId:string,emails:string[]){
 const normalized=[...new Set(emails.map(email=>email.trim().toLowerCase()).filter(Boolean))],marks=normalized.map(()=>'?').join(',')||'NULL'
 return [
  env.DB.prepare('UPDATE sessions SET revoked_at=? WHERE project_id=? AND token_hash IN (SELECT token_hash FROM portal_session_proofs WHERE project_id=? AND contact_id=?)').bind(Date.now(),projectId,projectId,contactId),
  env.DB.prepare('DELETE FROM portal_session_proofs WHERE project_id=? AND contact_id=?').bind(projectId,contactId),
  env.DB.prepare(`DELETE FROM portal_links WHERE project_id=? AND (email IN (${marks}) OR email IN (SELECT email FROM portal_identities WHERE project_id=? AND contact_id=?))`).bind(projectId,...normalized,projectId,contactId),
  env.DB.prepare('DELETE FROM portal_identities WHERE project_id=? AND contact_id=?').bind(projectId,contactId),
  env.DB.prepare('DELETE FROM portal_preferences WHERE project_id=? AND contact_id=?').bind(projectId,contactId)
 ]
}
