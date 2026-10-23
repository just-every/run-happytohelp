import {triageArchiveRow,triageArchiveStagedSafety} from './triage-archive.mjs';
import {reportArchiveRow,reportArchiveStagedSafety} from './report-archive.mjs';
import {r4ExportRow} from './r4-tables.mjs';
import {workflowArchiveRow} from './workflow-archive-safety.mjs';
import {escalationArchiveRow,escalationArchiveSafety} from './escalation-archive.mjs';
// Native identities and password hashes move with their referenced domain rows.
// Live bearer grants, provider credentials and pending outbound deliveries do not.
export const archivePolicy={
 product:'just-every/happytohelp',buckets:{FILES:{}},validateStaged:async input=>{await enterpriseArchiveSafety(input);await triageArchiveStagedSafety(input);await escalationArchiveSafety(input);return reportArchiveStagedSafety(input)},
 // Keep invitation history, but restored archives never restore a live survey link or queued send.
 exportRow:(table,row)=>triageArchiveRow(table,escalationArchiveRow(table,reportArchiveRow(table,workflowArchiveRow(table,r4ExportRow(table,table==='refund_approvals'?{...row,expires_at:row.created_at}:table==='enterprise_connections'?{...row,enabled:0,scim_hash:null,secret_cipher:null}:table==='enterprise_principals'?{...row,active:0}:table==='csat_surveys'?{...row,recipient:'',state:row.state==='pending'?'cancelled':row.state,revoked_at:row.revoked_at??row.created_at}
  :table==='mailbox_connections'?{...row,credential_cipher:null,status:'disconnected',cursor_json:null,sync_lock:null,sync_lock_until:null}
  :table==='mailbox_sends'&&row.state==='sending'?{...row,state:'uncertain',error_code:'restored_pending_send'}:row))))),
 // Reconstruct the full-text index from retained messages after restore.
 derivedTables:['inbox_message_search'],
 excludeTables:[
  // Provider credentials and active sync state are reconfigured after restore;
  // ordinary Move in history and its erased-identity tombstones remain native.
  'helpscout_connections','helpscout_sync_receipts','helpscout_webhook_receipts',
  'enterprise_states','enterprise_sessions',
  'escalation_attachment_grants',
  'workflow_clock',
  'operator_notification_activity','operator_notifications',
  'knowledge_help_links','knowledge_help_sessions',
  'portal_links','portal_session_proofs',
  'sessions','session_factors','webauthn_challenges','audit_purges','conversation_outbox','identity_tokens','magic_signins','registrations','login_attempts',
  // Who has the dashboard open is live state: a restore never claims a teammate is online.
  'operator_presence',
  'github_connections','github_oauth_states','preview_grants','edition_codes','edition_consents',
  'mailbox_oauth_states',
  'local_pairings','local_authorizations','local_grants','local_devices','local_device_settings','local_jobs','local_events','local_attachments','local_receipts','local_attachment_grants','local_result_effects',
  'integration_tokens','integration_deliveries','integration_replays','native_integration_destinations','native_integration_intents','native_integration_dispatch_cursor',
 ],
 replaceableTables:['integration_authority_epoch','ai_defaults','workflow_event_sequence'],
 secretColumns:{projects:['verification_secret'],edition_grants:['token_hash']},
 requiredConfiguration:['OWNER_EMAIL','APP_ORIGIN','H2H_LOCAL','EMAIL_PROVIDER','EMAIL_FROM','H2H_SETUP_TOKEN','INTEGRATION_ENCRYPTION_KEY'],
};

export default archivePolicy;

// Import also sanitizes archives made by older clients or edited outside export.
async function enterpriseArchiveSafety({db,tables}){
 const q=name=>'"'+tables[name].replaceAll('"','""')+'"',statements=[];
 if(tables.enterprise_connections)statements.push(`UPDATE ${q('enterprise_connections')} SET enabled=0,secret_cipher=NULL,scim_hash=NULL`);
 if(tables.enterprise_principals)statements.push(`UPDATE ${q('enterprise_principals')} SET active=0`);
 if(tables.refund_approvals)statements.push(`UPDATE ${q('refund_approvals')} SET expires_at=created_at`);
 if(statements.length)await db.batch(statements.map(sql=>db.prepare(sql)));
}
