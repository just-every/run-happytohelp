import type {Env} from '../../../platform/env'
export const notificationErasureCount=2
/** Run before participant/contact redaction. Redact frozen customer destinations
 * while retaining the once-per-ticket receipt fence, even when that contact was removed from the participant list since sending. */
export function notificationErasureStatements(env:Env,projectId:string,contactId:string){
 const tickets=`SELECT id FROM conversations WHERE project_id=? AND contact_id=?`
 return [
  env.DB.prepare(`DELETE FROM notification_inbox WHERE project_id=? AND conversation_id IN (${tickets})`).bind(projectId,projectId,contactId),
  env.DB.prepare(`UPDATE notification_trigger_claims SET outcome_json='{}',claim_token=NULL WHERE project_id=? AND (conversation_id IN (${tickets}) OR EXISTS(
   SELECT 1 FROM json_tree(outcome_json) j JOIN contacts erased ON erased.project_id=? AND erased.id=?
   WHERE j.type='text' AND lower(j.atom) IN (lower(erased.email),lower(json_extract(erased.metadata_json,'$.provided_email')))))`)
   .bind(projectId,projectId,contactId,projectId,contactId),
 ]
}
