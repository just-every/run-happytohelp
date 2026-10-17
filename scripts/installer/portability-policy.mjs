import {r4ExportRow} from './r4-tables.mjs';
// Native identities and password hashes move with their referenced domain rows.
// Live bearer grants, provider credentials and pending outbound deliveries do not.
export const archivePolicy={
 product:'just-every/happytohelp',buckets:{FILES:{}},
 // Keep invitation history, but restored archives never restore a live survey link or queued send.
 exportRow:(table,row)=>r4ExportRow(table,table==='csat_surveys'?{...row,recipient:'',state:row.state==='pending'?'cancelled':row.state,revoked_at:row.revoked_at??row.created_at}
  :table==='mailbox_connections'?{...row,credential_cipher:null,status:'disconnected',cursor_json:null,sync_lock:null,sync_lock_until:null}
  :table==='mailbox_sends'&&row.state==='sending'?{...row,state:'uncertain',error_code:'restored_pending_send'}:row),
 // Reconstruct the full-text index from retained messages after restore.
 derivedTables:['inbox_message_search'],
 excludeTables:[
  'operator_notification_activity','operator_notifications',
  'knowledge_help_links','knowledge_help_sessions',
  'sessions','session_factors','webauthn_challenges','audit_purges','conversation_outbox','identity_tokens','magic_signins','registrations','login_attempts',
  'github_connections','github_oauth_states','preview_grants','edition_codes','edition_consents',
  'mailbox_oauth_states',
  'local_pairings','local_authorizations','local_grants','local_devices','local_device_settings','local_jobs','local_events','local_attachments','local_receipts','local_attachment_grants','local_result_effects',
  'integration_tokens','integration_deliveries','integration_replays','native_integration_destinations','native_integration_intents','native_integration_dispatch_cursor',
 ],
 replaceableTables:['integration_authority_epoch','ai_defaults'],
 secretColumns:{projects:['verification_secret'],edition_grants:['token_hash']},
 requiredConfiguration:['OWNER_EMAIL','APP_ORIGIN','H2H_LOCAL','EMAIL_PROVIDER','EMAIL_FROM','H2H_SETUP_TOKEN','INTEGRATION_ENCRYPTION_KEY'],
};

export default archivePolicy;
