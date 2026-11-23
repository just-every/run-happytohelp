-- Recovery only needs live work. Partial indexes leave completed history on
-- its existing access paths, including Inbox, Setup and Assistants reads.
CREATE INDEX IF NOT EXISTS ai_attempts_running_generation
 ON ai_attempts(generation_id) WHERE state='running';
CREATE INDEX IF NOT EXISTS ai_generations_running_updated
 ON ai_generations(updated_at,id) WHERE state='running';
CREATE INDEX IF NOT EXISTS ai_generations_queued_created
 ON ai_generations(created_at,project_id,id) WHERE state='queued';
CREATE INDEX IF NOT EXISTS notification_inbox_sending
 ON notification_inbox(state) WHERE state='sending';
CREATE INDEX IF NOT EXISTS notification_inbox_pending
 ON notification_inbox(created_at,id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS notification_inbox_provider_ready
 ON notification_inbox(created_at,id) WHERE state IN ('pending','awaiting_provider');
CREATE INDEX IF NOT EXISTS email_deliveries_sending_notifications
 ON email_deliveries(state,updated_at) WHERE state='sending';
CREATE INDEX IF NOT EXISTS knowledge_upgrade_reports_pending
 ON knowledge_upgrade_reports(project_id) WHERE completed_at IS NULL;
CREATE INDEX IF NOT EXISTS sla_alerts_notification_recovery
 ON sla_alerts(notification_state,notification_started_at,notification_next_attempt_at);
CREATE INDEX IF NOT EXISTS voice_calls_retained_media_expiry
 ON voice_calls(media_expires_at)
 WHERE recording_cipher IS NOT NULL OR transcript IS NOT NULL OR summary LIKE 'Transcript highlights%';
CREATE INDEX IF NOT EXISTS support_channel_sends_survey_recovery
 ON support_channel_sends(message_id)
 WHERE state='sending';
CREATE INDEX IF NOT EXISTS api_uploads_expiry ON api_uploads(expires_at);
CREATE INDEX IF NOT EXISTS context_jobs_active_recovery
 ON context_jobs(created_at) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS training_runs_active_recovery
 ON training_runs(created_at) WHERE status IN ('planning','queued','running');
CREATE INDEX IF NOT EXISTS training_cases_running_recovery
 ON training_cases(run_id) WHERE status='running';
CREATE INDEX IF NOT EXISTS brand_generations_active_recovery
 ON brand_generations(created_at) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS project_settings_site_read_recovery
 ON project_settings(json_extract(settings_json,'$.site_read.at'))
 WHERE json_extract(settings_json,'$.site_read.state') IN ('queued','running');
CREATE INDEX IF NOT EXISTS legacy_package_admission_due
 ON legacy_package_custody(expires_at,manifest_sha256) WHERE status IN ('admitting','ready');
CREATE INDEX IF NOT EXISTS legacy_package_cleanup_due
 ON legacy_package_custody(next_cleanup_at,manifest_sha256) WHERE status IN ('invalidated','purging','purged');
CREATE INDEX IF NOT EXISTS legacy_worker_resume_due
 ON legacy_import_worker_runs(next_at,id) WHERE state IN ('queued','running');
CREATE INDEX IF NOT EXISTS local_result_effects_pending
 ON local_result_effects(job_id) WHERE state='pending';
CREATE INDEX IF NOT EXISTS audit_events_last_purge
 ON audit_events(project_id,at) WHERE action='audit.purged';
CREATE INDEX IF NOT EXISTS project_settings_audit_retention
 ON project_settings(project_id) WHERE json_extract(settings_json,'$.audit_retention_days') IS NOT NULL;
CREATE INDEX IF NOT EXISTS mailbox_connections_live_poll
 ON mailbox_connections(id) WHERE status='connected' AND provider<>'forwarding' AND coalesce(json_extract(cursor_json,'$.mode'),'live')<>'history';
CREATE INDEX IF NOT EXISTS mailgun_inbound_tokens_expiry ON mailgun_inbound_tokens(received_at);
CREATE INDEX IF NOT EXISTS suspended_emails_expiry ON suspended_emails(expires_at);
CREATE INDEX IF NOT EXISTS lead_jobs_running_recovery
 ON lead_jobs(started_at) WHERE state='running';
CREATE INDEX IF NOT EXISTS lead_jobs_queued_recovery
 ON lead_jobs(created_at) WHERE state='queued';
CREATE INDEX IF NOT EXISTS leads_processing_recovery ON leads(id) WHERE status='processing';
CREATE INDEX IF NOT EXISTS lead_jobs_lead ON lead_jobs(lead_id);
CREATE INDEX IF NOT EXISTS workflow_rules_published_time
 ON workflow_rules(project_id,position,id,published_version) WHERE state='published' AND kind='time';
CREATE INDEX IF NOT EXISTS sla_policies_active ON sla_policies(project_id) WHERE active=1;
CREATE INDEX IF NOT EXISTS csat_settings_enabled ON csat_settings(project_id) WHERE enabled=1;
CREATE INDEX IF NOT EXISTS csat_surveys_live ON csat_surveys(id) WHERE state IN ('pending','sending');
CREATE INDEX IF NOT EXISTS workflow_runs_active_due
 ON workflow_runs(coalesce(next_attempt_at,0)) WHERE state IN ('running','pending');
CREATE INDEX IF NOT EXISTS knowledge_datasets_processing
 ON knowledge_datasets(coalesce(ingest_started_at,-1)) WHERE status='processing';
CREATE INDEX IF NOT EXISTS knowledge_datasets_resumable
 ON knowledge_datasets(id) WHERE claim_token IS NOT NULL AND status IN ('ingesting','crawling');
CREATE INDEX IF NOT EXISTS knowledge_datasets_refresh_due
 ON knowledge_datasets(next_refresh_at) WHERE claim_token IS NULL AND source_input IS NOT NULL AND next_refresh_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS knowledge_imports_processing
 ON knowledge_imports(coalesce(processing_started_at,-1)) WHERE status='processing';
CREATE INDEX IF NOT EXISTS knowledge_imports_queued
 ON knowledge_imports(id) WHERE status='queued';
