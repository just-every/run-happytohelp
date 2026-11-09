import {voiceArchiveRow,voiceArchiveSafety} from './voice-archive.mjs';
import {supportChannelArchiveRow,supportChannelArchiveSafety} from './support-channel-archive.mjs';
import {feedbackArchiveRow,feedbackArchiveSafety} from './feedback-archive.mjs';
import {agentArchiveRow,agentArchiveSafety} from './agent-archive.mjs';
import {rerMailArchiveRow,rerMailArchiveSafety} from './rer-mail-archive.mjs';
import {asyncWorkArchiveRow,asyncWorkArchiveStagedSafety} from './async-work-archive.mjs';
import {triageArchiveRow,triageArchiveStagedSafety} from './triage-archive.mjs';
import {reportArchiveRow,reportArchiveStagedSafety} from './report-archive.mjs';
import {r4ExportRow} from './r4-tables.mjs';
import {workflowArchiveRow} from './workflow-archive-safety.mjs';
import {escalationArchiveRow,escalationArchiveSafety} from './escalation-archive.mjs';
import {trainingArchiveRow,trainingArchiveStagedSafety} from './training-archive.mjs';
const privateKnowledgeTables=['knowledge_help_links','knowledge_help_sessions','knowledge_read_receipts','knowledge_canonicalisation_receipts','knowledge_write_guards','knowledge_upgrade_permits','knowledge_upgrade_progress'];
async function knowledgeArchiveSafety({db,tables}){
 if(tables.ik_door_settings)await db.prepare(`UPDATE "${tables.ik_door_settings.replaceAll('"','""')}" SET enabled=0`).run();
 const quoted=name=>'"'+tables[name].replaceAll('"','""')+'"',statements=[];
 // Older archives must not restore personal linkage or a transient write permit.
 for(const name of privateKnowledgeTables)if(tables[name])statements.push(db.prepare(`DELETE FROM ${quoted(name)}`));
 if(tables.knowledge_upgrade_reports)statements.push(db.prepare(`UPDATE ${quoted('knowledge_upgrade_reports')} SET completed_at=NULL`));
 if(tables.knowledge_reply_blocks){
  const live=tables.contacts?`EXISTS(SELECT 1 FROM ${quoted('contacts')} contact WHERE contact.project_id=block.project_id AND contact.id=block.author_contact_id
   AND coalesce(json_extract(contact.metadata_json,'$.is_deleted'),0)<>1 AND coalesce(json_extract(contact.metadata_json,'$.is_erasing'),0)<>1 AND coalesce(json_extract(contact.metadata_json,'$.is_erased'),0)<>1
   ${tables.contact_erasures?`AND NOT EXISTS(SELECT 1 FROM ${quoted('contact_erasures')} erased WHERE erased.project_id=contact.project_id AND erased.contact_id=contact.id)`:''})`:'0';
  // Remove personal payloads and author-derived fingerprints from older archives.
  statements.push(db.prepare(`DELETE FROM ${quoted('knowledge_reply_blocks')} AS block WHERE author_contact_id IS NOT NULL AND NOT (${live})`));
  // Copies written into an erased customer's ticket, by anyone, carry that
  // ticket as custody; erasure blanks every message there.
  if(tables.conversations&&tables.contacts)statements.push(db.prepare(`DELETE FROM ${quoted('knowledge_reply_blocks')} AS block WHERE generation_id LIKE 'ticket:%' AND EXISTS(SELECT 1 FROM ${quoted('conversations')} ticket JOIN ${quoted('contacts')} contact ON contact.project_id=ticket.project_id AND contact.id=ticket.contact_id
   WHERE ticket.project_id=block.project_id AND 'ticket:'||ticket.id=block.generation_id AND (coalesce(json_extract(contact.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(contact.metadata_json,'$.is_erased'),0)=1
   ${tables.contact_erasures?`OR EXISTS(SELECT 1 FROM ${quoted('contact_erasures')} erased WHERE erased.project_id=contact.project_id AND erased.contact_id=contact.id)`:''}))`));
 }
 if(statements.length)await db.batch(statements);
}
// Native identities and password hashes move with their referenced domain rows.
// Live bearer grants, provider credentials and pending outbound deliveries do not.
export const archivePolicy={
 // Enforce revocation at restore too, including an archive produced by an older
 // exporter or containing an unrevoked metadata row. Never revive bearer authority.
 importSafety:{
  ik_door_settings:{enabled:[0]},
  integration_tokens:{revoked_at:[1]},api_credentials:{revoked_at:[1]},
  crm_connections:{token_cipher:[null]},
  helpscout_connections:{secret_ciphertext:[null],claim:[null],claim_until:[null]},
  crm_mappings:{context_json:[null],state:['stale'],refreshed_at:[null],checked_at:[null]},
 },
 importRow:(table,row)=>table==='ik_door_settings'?{...row,enabled:0}:table==='knowledge_upgrade_reports'?{...row,completed_at:null}:table==='helpscout_connections'?{...row,secret_ciphertext:null,claim:null,claim_until:null}:table==='crm_connections'?{...row,token_cipher:null}:table==='crm_mappings'?{...row,context_json:null,state:'stale',refreshed_at:null,checked_at:null}:['integration_tokens','api_credentials'].includes(table)&&row.revoked_at==null?{...row,revoked_at:1}:row,
 product:'just-every/happytohelp',buckets:{FILES:{}},validateStaged:async input=>{await voiceArchiveSafety(input);await supportChannelArchiveSafety(input);await feedbackArchiveSafety(input);await knowledgeArchiveSafety(input);await agentArchiveSafety(input);await rerMailArchiveSafety(input);await triageArchiveStagedSafety(input);await escalationArchiveSafety(input);await trainingArchiveStagedSafety(input);await asyncWorkArchiveStagedSafety(input);return reportArchiveStagedSafety(input)},
 // Keep invitation history, but restored archives never restore a live survey link or queued send.
 exportRow:(table,original)=>{const row=table==='ik_door_settings'?{...original,enabled:0}:voiceArchiveRow(table,supportChannelArchiveRow(table,feedbackArchiveRow(table,agentArchiveRow(table,original))));
  // The receipts are the arrival record a legacy delta reads and the reader's idempotency fence, so they travel; the
  // sender and the private copy's key do not.
  return table==='legacy_mail_s3_receipts'?{...row,raw_key:null,sender_address:null}:table==='helpscout_connections'?{...row,secret_ciphertext:null,claim:null,claim_until:null}:table==='crm_connections'?{...row,token_cipher:null}:table==='crm_mappings'?{...row,context_json:null,state:'stale',refreshed_at:null,checked_at:null}:rerMailArchiveRow(table,asyncWorkArchiveRow(table,trainingArchiveRow(table,triageArchiveRow(table,escalationArchiveRow(table,reportArchiveRow(table,workflowArchiveRow(table,r4ExportRow(table,table==='integration_tokens'?{...row,token_hash:'revoked:'+row.id,revoked_at:row.revoked_at??Math.max(1,row.created_at)}:table==='api_credentials'?{...row,revoked_at:row.revoked_at??Math.max(1,row.created_at)}:table==='api_requests'?{...row,response_json:null,erased:1}:table==='api_appends'?{...row,response_json:null}:table==='csat_surveys'?{...row,recipient:'',state:row.state==='pending'?'cancelled':row.state,revoked_at:row.revoked_at??row.created_at}
  :table==='mailbox_connections'?{...row,credential_cipher:null,status:'disconnected',cursor_json:null,sync_lock:null,sync_lock_until:null}
  :table==='knowledge_upgrade_reports'?{...row,completed_at:null}
  :table==='mailbox_sends'&&row.state==='sending'?{...row,state:'uncertain',error_code:'restored_pending_send'}:row))))))));},
 // Reconstruct the full-text indexes from retained messages, contacts and inbox entries after restore.
 derivedTables:['inbox_message_search','inbox_contact_search','contact_search','inbox_subject_search'],
 excludeTables:[
  // Derived by triggers and rebuilt from the restored rows after every import (inbox-entries-sql, cutover-bounds-sql,
  // contact-bounds-sql): the inbox's entries, tallies, unread and waiting rows and their facets and counts (313, 314, 319), the contacts' tally and the
  // cutover sets (318). Their tallies and entries have no declared key, so an archive orders them by rowid, which is
  // write history a rebuild cannot reproduce: a restored export would carry the same rows in another order.
  'inbox_entries','inbox_tallies','inbox_tag_tallies','inbox_field_tallies','inbox_unread','inbox_visitor_waiting',
  'inbox_unread_tallies','inbox_facets','inbox_counts',
  'contact_tallies','cutover_tallies','cutover_zendesk_conversations','cutover_legacy_conversations','cutover_legacy_runs','cutover_widget_arrivals',
  // Consumed ik_door_grants are portable replay fences, never authority.
  // ik_door_settings is neutralized on export, import and staged validation.
  // Installation-private pull membership and replay custody never transfer.
  'agent_door_relay','agent_door_replay_aliases',
  // Mailgun signature replay fences are short-lived and never travel.
  'mailgun_inbound_tokens',
  // The Amazon SES reader lists again after a restore; its last-list time belongs to this installation.
  'legacy_mail_s3_state',
  'support_channel_attachment_grants','support_channel_link_codes',
  'crm_changes',
  'rer_mailbox_outbox',
  'escalation_attachment_grants',
  'workflow_clock',
  'operator_notification_activity','operator_notifications',
  // Slack identity links, consent and pending personal deliveries never travel.
  'teammate_slack_consent','teammate_slack_links','teammate_slack_preferences','teammate_slack_deliveries',
  'teammate_teams_consent','teammate_teams_codes','teammate_teams_links','teammate_teams_preferences','teammate_teams_deliveries',
  // Preserve grants, reference bodies and source/shingle indexes. Live read
  // linkage and local canonicalisation completion must not survive a restore;
  // the restored installation canonicalises before nonmember disclosure.
  ...privateKnowledgeTables,
  'portal_links','portal_session_proofs',
  'sessions','session_factors','webauthn_challenges','audit_purges','conversation_outbox','identity_tokens','magic_signins','registrations','login_attempts',
  // Who has the dashboard open is live state: a restore never claims a teammate is online.
  'operator_presence',
  // Derived device authority and offline command/frontier receipts never travel.
  'mobile_links','mobile_commands','mobile_frontiers','mobile_devices',
  'github_connections','github_oauth_states','preview_grants','edition_codes','edition_consents',
  'mailbox_oauth_states',
  'local_pairings','local_authorizations','local_grants','local_devices','local_device_settings','local_jobs','local_events','local_attachments','local_receipts','local_attachment_grants','local_result_effects',
  'api_uploads','api_upload_disposals','integration_deliveries','integration_replays','native_integration_destinations','native_integration_intents','native_integration_dispatch_cursor',
 ],
 replaceableTables:['integration_authority_epoch','ai_defaults','workflow_event_sequence'],
 secretColumns:{projects:['verification_secret'],edition_grants:['token_hash']},
 requiredConfiguration:['OWNER_EMAIL','APP_ORIGIN','H2H_LOCAL','EMAIL_PROVIDER','EMAIL_FROM','H2H_SETUP_TOKEN','INTEGRATION_ENCRYPTION_KEY'],
};

export default archivePolicy;
