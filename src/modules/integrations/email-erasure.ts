import type {Env} from '../../platform/env'
import {emailThreadErasureStatements} from './email-threading'
import {legacyMailS3Config} from './legacy-mail-s3/config'

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
// The workspace receiving on the Amazon SES reader's mailbox (?4, null with the reader off), decided as
// receivingMailbox does: an enabled inbound address, or a connected mailbox's address, of a workspace not deleted.
const readerWorkspace=`?1 IN (SELECT e.project_id FROM email_settings e WHERE lower(e.inbound_address)=lower(?4) AND e.is_enabled=1 AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=e.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL)
 UNION ALL SELECT a.project_id FROM mailbox_addresses a JOIN mailbox_connections m ON m.id=a.mailbox_id AND m.project_id=a.project_id WHERE lower(a.address)=lower(?4) AND m.status='connected' AND NOT EXISTS(SELECT 1 FROM project_settings s WHERE s.project_id=a.project_id AND json_extract(s.settings_json,'$.deleted_at') IS NOT NULL))`
// The Amazon SES reader's receipt names a private transport copy and the sender while it is read. A receipt still in
// flight has no workspace yet; it is this workspace's only when this workspace receives on the reader's mailbox.
const legacyReceipt=`(l.project_id=?1 OR l.project_id IS NULL AND ${readerWorkspace}) AND (lower(l.sender_address) IN (${addresses}) OR l.conversation_id IN (SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2))`
const readerMailbox=(env:Env)=>legacyMailS3Config(env)?.mailbox??null
/** Enter suspended objects into the existing resumable erasure delete stage;
 * every object is removed before its identifying D1 row can disappear. */
export function emailErasureObjectStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 return [env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'media','legacy-mail-s3:'||l.object_key,l.raw_key FROM legacy_mail_s3_receipts l WHERE l.raw_key IS NOT NULL AND ${legacyReceipt}`).bind(projectId,contactId,JSON.stringify(emails),readerMailbox(env)),env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT ?1,?2,'media','rer-mail:'||r.delivery_id||':'||r.body_sha256,r.object_key FROM rer_mail_raw_objects r JOIN rer_mail_ingress i ON i.delivery_id=r.delivery_id AND i.project_id=r.project_id WHERE ${managedReceipt}`).bind(projectId,contactId,JSON.stringify(emails)),env.DB.prepare(`INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key)
  SELECT ?1,?2,'media','suspended:'||s.id||':'||file.key,json_extract(file.value,'$.objectKey') FROM suspended_emails s CROSS JOIN json_each(s.input_json,'$.attachments') file
  WHERE ${held} AND json_extract(file.value,'$.objectKey') IS NOT NULL`).bind(projectId,contactId,JSON.stringify(emails))]
}
export function emailErasureStatements(env:Env,projectId:string,contactId:string,emails:readonly string[]){
 const values=JSON.stringify(emails)
 return [
  env.DB.prepare(`DELETE FROM rer_mail_raw_objects WHERE project_id=?1 AND delivery_id IN (SELECT delivery_id FROM rer_mail_ingress i WHERE ${managedReceipt})`).bind(projectId,contactId,values),
  env.DB.prepare(`UPDATE rer_mail_ingress AS i SET sender_address=NULL,metadata_json='{}',result_json='{"state":"erased"}',state='erased',error=NULL WHERE ${managedReceipt}`).bind(projectId,contactId,values),
  // The receipt stays, as the arrival record a later legacy delta reads; what names a person goes.
  env.DB.prepare(`UPDATE legacy_mail_s3_receipts AS l SET raw_key=NULL,sender_address=NULL WHERE ${legacyReceipt}`).bind(projectId,contactId,values,readerMailbox(env)),
  ...emailThreadErasureStatements(env,projectId,contactId,emails),
  env.DB.prepare('DELETE FROM email_followup_links WHERE project_id=? AND (conversation_id IN (SELECT id FROM conversations WHERE project_id=? AND contact_id=?) OR parent_id IN (SELECT id FROM conversations WHERE project_id=? AND contact_id=?))').bind(projectId,projectId,contactId,projectId,contactId),
  env.DB.prepare(`DELETE FROM suspended_emails AS s WHERE ${held}`).bind(projectId,contactId,values),
  env.DB.prepare('DELETE FROM email_sender_rules WHERE project_id=? AND address IN (SELECT value FROM json_each(?))').bind(projectId,values),
 ]
}
