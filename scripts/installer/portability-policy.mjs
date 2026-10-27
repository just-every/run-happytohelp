import {rerMailArchiveRow,rerMailArchiveSafety} from './rer-mail-archive.mjs';
import {asyncWorkArchiveRow,asyncWorkArchiveStagedSafety} from './async-work-archive.mjs';
import {triageArchiveRow,triageArchiveStagedSafety} from './triage-archive.mjs';
import {reportArchiveRow,reportArchiveStagedSafety} from './report-archive.mjs';
import {r4ExportRow} from './r4-tables.mjs';
import {workflowArchiveRow} from './workflow-archive-safety.mjs';
import {escalationArchiveRow,escalationArchiveSafety} from './escalation-archive.mjs';
import {trainingArchiveRow,trainingArchiveStagedSafety} from './training-archive.mjs';
// Native identities and password hashes move with their referenced domain rows.
// Live bearer grants, provider credentials and pending outbound deliveries do not.
export const archivePolicy={
 // Enforce revocation at restore too, including an archive produced by an older
 // exporter or containing an unrevoked metadata row. Never revive bearer authority.
 importSafety:{integration_tokens:{revoked_at:[1]},api_credentials:{revoked_at:[1]}},
 importRow:(table,row)=>['integration_tokens','api_credentials'].includes(table)&&row.revoked_at==null?{...row,revoked_at:1}:row,
 product:'just-every/happytohelp',buckets:{FILES:{}},validateStaged:async input=>{await rerMailArchiveSafety(input);await triageArchiveStagedSafety(input);await escalationArchiveSafety(input);await trainingArchiveStagedSafety(input);await asyncWorkArchiveStagedSafety(input);return reportArchiveStagedSafety(input)},
 // Keep invitation history, but restored archives never restore a live survey link or queued send.
 exportRow:(table,row)=>rerMailArchiveRow(table,asyncWorkArchiveRow(table,trainingArchiveRow(table,triageArchiveRow(table,escalationArchiveRow(table,reportArchiveRow(table,workflowArchiveRow(table,r4ExportRow(table,table==='integration_tokens'?{...row,token_hash:'revoked:'+row.id,revoked_at:row.revoked_at??Math.max(1,row.created_at)}:table==='api_credentials'?{...row,revoked_at:row.revoked_at??Math.max(1,row.created_at)}:table==='api_requests'?{...row,response_json:null,erased:1}:table==='api_appends'?{...row,response_json:null}:table==='csat_surveys'?{...row,recipient:'',state:row.state==='pending'?'cancelled':row.state,revoked_at:row.revoked_at??row.created_at}
  :table==='mailbox_connections'?{...row,credential_cipher:null,status:'disconnected',cursor_json:null,sync_lock:null,sync_lock_until:null}
  :table==='mailbox_sends'&&row.state==='sending'?{...row,state:'uncertain',error_code:'restored_pending_send'}:row)))))))),
 // Reconstruct the full-text index from retained messages after restore.
 derivedTables:['inbox_message_search'],
 excludeTables:[
  'rer_mailbox_outbox',
  'escalation_attachment_grants',
  'workflow_clock',
  'operator_notification_activity','operator_notifications',
  // Receipts are live linkage capabilities. Preserve collection restrictions
  // and explicit grants as business rows, but never restore receipt content.
  'knowledge_help_links','knowledge_help_sessions','knowledge_read_receipts',
  'portal_links','portal_session_proofs',
  'sessions','session_factors','webauthn_challenges','audit_purges','conversation_outbox','identity_tokens','magic_signins','registrations','login_attempts',
  // Who has the dashboard open is live state: a restore never claims a teammate is online.
  'operator_presence',
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
