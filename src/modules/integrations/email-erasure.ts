import type {Env} from '../../platform/env'
import {emailThreadErasureStatements} from './email-threading'

// A held copy has its own sender identities and remains in the original delivery's
// custody even before that receipt acquires a conversation. None grants admission.
const addresses=`SELECT value FROM json_each(?3)`
const identifiedHeld=`(s.candidate_conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)
 OR lower(s.from_address) IN (${addresses})
 OR lower(json_extract(s.input_json,'$.custody.headerFrom')) IN (${addresses})
 OR lower(json_extract(s.input_json,'$.custody.envelopeFrom')) IN (${addresses})
 OR EXISTS(SELECT 1 FROM json_each(s.to_json) a WHERE lower(a.value) IN (${addresses}))
 OR EXISTS(SELECT 1 FROM json_each(s.input_json,'$.cc') a WHERE lower(a.value) IN (${addresses})))`
const managedReceipt=`i.project_id=?1 AND (lower(i.sender_address) IN (${addresses}) OR lower(json_extract(i.metadata_json,'$.envelopeFrom')) IN (${addresses}) OR json_extract(i.result_json,'$.conversationId') IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2)
 OR EXISTS(SELECT 1 FROM suspended_emails s WHERE s.project_id=i.project_id AND json_extract(s.input_json,'$.custody.deliveryId')=i.delivery_id AND ${identifiedHeld}))`
const held=`s.project_id=?1 AND (${identifiedHeld}
 OR EXISTS(SELECT 1 FROM rer_mail_ingress i WHERE i.project_id=s.project_id AND i.delivery_id=json_extract(s.input_json,'$.custody.deliveryId') AND (i.state='erased' OR ${managedReceipt})))`
/** Enter suspended objects into the existing resumable erasure delete stage;
 * every object is removed before its identifying D1 row can disappear. */
export function emailErasureObjectStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 return [env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'media','rer-mail:'||r.delivery_id||':'||r.body_sha256,r.object_key FROM rer_mail_raw_objects r JOIN rer_mail_ingress i ON i.delivery_id=r.delivery_id AND i.project_id=r.project_id WHERE ${managedReceipt}`).bind(projectId,contactId,JSON.stringify(emails)),env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key)
  SELECT ?1,?2,'media','suspended:'||s.id||':'||file.key,json_extract(file.value,'$.objectKey') FROM suspended_emails s CROSS JOIN json_each(s.input_json,'$.attachments') file
  WHERE ${held} AND json_extract(file.value,'$.objectKey') IS NOT NULL`).bind(projectId,contactId,JSON.stringify(emails))]
}
export function emailErasureStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 const values=JSON.stringify(emails)
 return [
  env.DB.prepare(`DELETE FROM rer_mail_raw_objects WHERE project_id=?1 AND delivery_id IN (SELECT delivery_id FROM rer_mail_ingress i WHERE ${managedReceipt})`).bind(projectId,contactId,values),
  env.DB.prepare(`UPDATE rer_mail_ingress AS i SET sender_address=NULL,metadata_json='{}',result_json='{"state":"erased"}',state='erased',error=NULL WHERE ${managedReceipt}`).bind(projectId,contactId,values),
  ...emailThreadErasureStatements(env,projectId,contactId,emails),
  env.DB.prepare('DELETE FROM email_followup_links WHERE project_id=? AND (conversation_id IN (SELECT id FROM conversations WHERE project_id=? AND contact_id=?) OR parent_id IN (SELECT id FROM conversations WHERE project_id=? AND contact_id=?))').bind(projectId,projectId,contactId,projectId,contactId),
  env.DB.prepare(`DELETE FROM suspended_emails AS s WHERE ${held}`).bind(projectId,contactId,values),
  env.DB.prepare('DELETE FROM email_sender_rules WHERE project_id=? AND address IN (SELECT value FROM json_each(?))').bind(projectId,values),
 ]
}
