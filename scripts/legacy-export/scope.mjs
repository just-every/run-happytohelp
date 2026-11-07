// Explicit project boundaries; unknown durable tables require a new scope rule.
export const directTables = ['projects','project_users','contacts','conversations','messages','buckets','ais',
  'categories','articles','macros','datasets','plugins','collectors','collector_actions','collector_summaries',
  'insights','ai_usages','project_optimizations','message_thinkings','leads','charges',
  'project_github_connections','connections','local_agent_device_project_settings','support_delegations'];
export const credentialColumns = {
  // Provider exception messages can embed request credentials/encoded payloads.
  datasets: ['crawl_webhook_token','refresh_claim_token','status_message'],
  dataset_files: ['html'], messages: ['content_raw'], collectors: ['data'],
  local_agent_devices: ['token_hash'], local_agent_grants: ['token_hash'],
  projects: ['verification_secret'], users: ['password','remember_token'],
  project_users: ['invitation_token'], contacts: ['key_hashes','user_agent'],
  connections: ['shared_key','contact_shared_key','contact_shared_key_id','page_content'],
  // Drop encrypted telemetry and its crypto-only reference; never decrypt it.
  collector_actions: ['action','contact_shared_key_id'],
  // Generated browsing summaries can repeat tokens captured in visitor URLs.
  collector_summaries: ['summary'], project_github_connections: ['access_token'],
  message_thinkings: ['signature','thinking_id'], // opaque provider continuation payload, never needed to read history
};
export const skippedTables = ['migrations','password_resets','personal_access_tokens','asymmetric_keys',
  'contact_shared_keys','failed_jobs','jobs','job_batches','telescope_entries','telescope_entries_tags',
  'telescope_monitoring','waitlist','elastic_migrations','ai_logs','local_agent_device_authorizations','local_agent_pairings','prompt_plans'];
export const morphTables = {Message:'messages',Article:'articles',Project:'projects',User:'users',AI:'ais',Event:'events',SupportDelegation:'support_delegations'};
export const childScopes = {
  events: ['conversation_id','conversations'], conversation_participants: ['conversation_id','conversations'],
  dataset_files: ['dataset_id','datasets'], support_delegation_events: ['support_delegation_id','support_delegations'],
};

// EventItem.js renders these support events; PAGE_VIEW is visitor tracking.
export const supportEventTypes = ['AGENT_ASSIGNED','USED_INSIGHT','INTERNAL_NOTE'];
// A customer's generated administrative links (contact metadata) carry an opaque login capability.
// Reply trigger and unsent composer-suggestion caches are runtime state, not sent history.
// Event snapshots of a widget contact carry its identity-verification HMAC (contact_hash)
// and a copy of the contact's metadata, including the same administrative link.
// Remove only these exact paths; unknown nested credential fields still fail.
export const structuredOmissions = {events:{payload:[['contact_message','contact','hash'],['contact_message','contact','metadata','hash'],['contact_message','contact','metadata','admin']]},messages:{content:[['data','clientConfiguration','braintreeApi','accessToken'],['data','tokenizeUsBankAccount','paymentMethod','id'],['data','tokenizeUsBankAccount','paymentMethod','legacyId']]},contacts:{metadata:[['admin']]},conversations:{metadata:[['customer_reply'],['suggestions']]}};
