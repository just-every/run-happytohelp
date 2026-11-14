-- Detached consent is installation-private. Existing session rows remain session
-- authority, and no old hash is interpreted as a delegation.
CREATE TABLE rehearsal_grants(
 id TEXT PRIMARY KEY,generation INTEGER NOT NULL DEFAULT 1,setup_project_id TEXT NOT NULL,owner_id TEXT NOT NULL,
 issuing_session_hash TEXT NOT NULL,installation_id TEXT NOT NULL,app_origin TEXT NOT NULL,owner_epoch INTEGER NOT NULL,owner_proof_at INTEGER NOT NULL,owner_proof_method TEXT NOT NULL,
 owner_email TEXT NOT NULL,configured_owner_email TEXT NOT NULL,factor_policy TEXT NOT NULL,
 origin_sha TEXT NOT NULL,legacy_project_id TEXT NOT NULL,legacy_watermark INTEGER NOT NULL,legacy_cutoff INTEGER NOT NULL,
 legacy_watermark_iso TEXT NOT NULL,legacy_cutoff_iso TEXT NOT NULL,legacy_enabled INTEGER NOT NULL DEFAULT 1,
 zendesk_project_id TEXT NOT NULL,zendesk_subdomain TEXT NOT NULL,zendesk_connection_generation INTEGER NOT NULL,
 zendesk_client_id TEXT NOT NULL,zendesk_connected_at INTEGER NOT NULL,zendesk_base_pull_id TEXT NOT NULL,zendesk_cursor_json TEXT NOT NULL,
 zendesk_enabled INTEGER NOT NULL DEFAULT 1,copier_id TEXT NOT NULL,credential_hash TEXT UNIQUE,
 started_at INTEGER NOT NULL,expiry_at INTEGER NOT NULL,created_at INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN ('active','closed')),
 closed_at INTEGER,closure_reason TEXT,active_day TEXT,cleanup_state TEXT NOT NULL DEFAULT 'pending' CHECK(cleanup_state IN ('pending','complete')),cleanup_at INTEGER
);
CREATE UNIQUE INDEX rehearsal_one_active ON rehearsal_grants(setup_project_id) WHERE state='active';
CREATE INDEX rehearsal_cleanup ON rehearsal_grants(state,cleanup_state,expiry_at);
-- Verified non-content origin clocks survive finite source-package purge.
CREATE TABLE rehearsal_origins(
 manifest_sha256 TEXT PRIMARY KEY,custody_project_id TEXT NOT NULL,source_project_id TEXT NOT NULL,custodian_id TEXT NOT NULL,
 source_cutoff_iso TEXT NOT NULL,snapshot_clock_iso TEXT NOT NULL,watermark_iso TEXT NOT NULL,overlap_seconds INTEGER NOT NULL,verified_at INTEGER NOT NULL
);
CREATE TABLE rehearsal_copies(
 grant_id TEXT NOT NULL,generation INTEGER NOT NULL,day TEXT NOT NULL,legacy_sha TEXT,zendesk_pull_id TEXT,
 legacy_verified INTEGER NOT NULL DEFAULT 0,zendesk_verified INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,verified_at INTEGER,
 legacy_conflicts INTEGER,legacy_rows INTEGER,zendesk_refusals INTEGER,
 PRIMARY KEY(grant_id,generation,day)
);
CREATE TABLE legacy_rehearsal_lineage(
 manifest_sha256 TEXT PRIMARY KEY,origin_sha256 TEXT NOT NULL,rehearsal_id TEXT NOT NULL,rehearsal_generation INTEGER NOT NULL,
 custody_project_id TEXT NOT NULL,source_project_id TEXT NOT NULL,custodian_id TEXT NOT NULL,day TEXT NOT NULL,
 since INTEGER NOT NULL,source_cutoff INTEGER NOT NULL,snapshot_clock INTEGER NOT NULL,watermark INTEGER NOT NULL,
 since_iso TEXT NOT NULL,source_cutoff_iso TEXT NOT NULL,snapshot_clock_iso TEXT NOT NULL,watermark_iso TEXT NOT NULL,
 verified_at INTEGER,created_at INTEGER NOT NULL,UNIQUE(rehearsal_id,rehearsal_generation,day)
);
CREATE INDEX legacy_rehearsal_origin ON legacy_rehearsal_lineage(origin_sha256,source_project_id);
ALTER TABLE legacy_import_worker_runs ADD COLUMN authority_mode TEXT NOT NULL DEFAULT 'session' CHECK(authority_mode IN ('session','rehearsal'));
ALTER TABLE legacy_import_worker_runs ADD COLUMN rehearsal_id TEXT;
ALTER TABLE legacy_import_worker_runs ADD COLUMN rehearsal_generation INTEGER;
CREATE INDEX legacy_import_worker_runs_rehearsal ON legacy_import_worker_runs(rehearsal_id,rehearsal_generation);
ALTER TABLE legacy_package_custody ADD COLUMN authority_mode TEXT NOT NULL DEFAULT 'session' CHECK(authority_mode IN ('session','rehearsal'));
ALTER TABLE legacy_package_custody ADD COLUMN rehearsal_id TEXT;
ALTER TABLE legacy_package_custody ADD COLUMN rehearsal_generation INTEGER;
CREATE INDEX legacy_package_custody_rehearsal ON legacy_package_custody(rehearsal_id,rehearsal_generation);
ALTER TABLE move_in_runs ADD COLUMN authority_mode TEXT NOT NULL DEFAULT 'session' CHECK(authority_mode IN ('session','rehearsal'));
ALTER TABLE move_in_runs ADD COLUMN rehearsal_id TEXT;
ALTER TABLE move_in_runs ADD COLUMN rehearsal_generation INTEGER;
CREATE INDEX move_in_runs_rehearsal ON move_in_runs(rehearsal_id,rehearsal_generation);
ALTER TABLE move_in_zendesk_pulls ADD COLUMN authority_mode TEXT NOT NULL DEFAULT 'session' CHECK(authority_mode IN ('session','rehearsal'));
ALTER TABLE move_in_zendesk_pulls ADD COLUMN rehearsal_id TEXT;
ALTER TABLE move_in_zendesk_pulls ADD COLUMN rehearsal_generation INTEGER;
CREATE INDEX move_in_zendesk_pulls_rehearsal ON move_in_zendesk_pulls(rehearsal_id,rehearsal_generation);
ALTER TABLE move_in_zendesk_attachment_pulls ADD COLUMN authority_mode TEXT NOT NULL DEFAULT 'session' CHECK(authority_mode IN ('session','rehearsal'));
ALTER TABLE move_in_zendesk_attachment_pulls ADD COLUMN rehearsal_id TEXT;
ALTER TABLE move_in_zendesk_attachment_pulls ADD COLUMN rehearsal_generation INTEGER;
CREATE INDEX move_in_zendesk_attachment_pulls_rehearsal ON move_in_zendesk_attachment_pulls(rehearsal_id,rehearsal_generation);

-- Closing is terminal and fences in-flight children before any later commit.
CREATE TRIGGER rehearsal_close AFTER UPDATE OF state ON rehearsal_grants WHEN OLD.state='active' AND NEW.state='closed' BEGIN
 UPDATE legacy_import_worker_runs SET state='stopped',version=version+1,lease_token=NULL,lease_until=NULL,error_code='rehearsal_closed',updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE rehearsal_id=NEW.id AND authority_mode='rehearsal' AND state<>'complete';
 UPDATE move_in_zendesk_pulls SET state='abandoned',version=version+1,lease_until=NULL,error='rehearsal_closed',updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE rehearsal_id=NEW.id AND authority_mode='rehearsal' AND state<>'applied';
 UPDATE move_in_zendesk_attachment_pulls SET state='done',version=version+1,lease_until=NULL,error='rehearsal_closed',updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE rehearsal_id=NEW.id AND authority_mode='rehearsal' AND state<>'done';
 UPDATE move_in_runs SET error='rehearsal_closed',updated_at=max(CAST(unixepoch('subsec')*1000 AS INTEGER),updated_at+1) WHERE rehearsal_id=NEW.id AND authority_mode='rehearsal' AND state<>'completed';
 UPDATE legacy_package_custody SET status='invalidated',generation=generation+1,purge_reason='discarded',closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),next_cleanup_at=0,cleanup_token=NULL,cleanup_until=NULL WHERE rehearsal_id=NEW.id AND authority_mode='rehearsal' AND status IN ('admitting','ready');
END;
CREATE TRIGGER rehearsal_session_revoke AFTER UPDATE OF revoked_at,actor_id,project_id,role ON sessions BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='issuing_session_revoked',cleanup_state='pending' WHERE state='active' AND (issuing_session_hash=NEW.token_hash AND (NEW.revoked_at IS NOT NULL OR NEW.actor_id<>owner_id OR NEW.project_id<>setup_project_id OR NEW.role<>'owner'));
END;
CREATE TRIGGER rehearsal_epoch_insert AFTER INSERT ON identity_recovery_epochs BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='owner_changed',cleanup_state='pending' WHERE state='active' AND (owner_id=NEW.user_id AND owner_epoch<>NEW.epoch);
END;
CREATE TRIGGER rehearsal_epoch_update AFTER UPDATE ON identity_recovery_epochs BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='owner_changed',cleanup_state='pending' WHERE state='active' AND (owner_id=NEW.user_id AND owner_epoch<>NEW.epoch);
END;
CREATE TRIGGER rehearsal_anchor_update AFTER UPDATE ON owner_setup BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='owner_anchor_changed',cleanup_state='pending' WHERE state='active' AND (1);
END;
CREATE TRIGGER rehearsal_anchor_delete AFTER DELETE ON owner_setup BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='owner_anchor_changed',cleanup_state='pending' WHERE state='active' AND (1);
END;
CREATE TRIGGER rehearsal_owner_email AFTER UPDATE OF email ON users BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='owner_changed',cleanup_state='pending',owner_email='',configured_owner_email='' WHERE state='active' AND (owner_id=NEW.id AND lower(trim(NEW.email))<>owner_email);
END;
CREATE TRIGGER rehearsal_owner_delete AFTER DELETE ON users BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='owner_removed',cleanup_state='pending',owner_email='',configured_owner_email='',issuing_session_hash='' WHERE state='active' AND (owner_id=OLD.id);
END;
CREATE TRIGGER rehearsal_membership_delete AFTER DELETE ON memberships BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='membership_lost',cleanup_state='pending' WHERE state='active' AND (owner_id=OLD.user_id AND OLD.project_id IN (setup_project_id,legacy_project_id,zendesk_project_id));
END;
CREATE TRIGGER rehearsal_membership_change AFTER UPDATE ON memberships BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='membership_lost',cleanup_state='pending' WHERE state='active' AND (owner_id=OLD.user_id AND OLD.project_id IN (setup_project_id,legacy_project_id,zendesk_project_id) AND (NEW.user_id<>OLD.user_id OR NEW.project_id<>OLD.project_id OR NEW.role<>'owner'));
END;
CREATE TRIGGER rehearsal_project_delete AFTER DELETE ON projects BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='destination_removed',cleanup_state='pending' WHERE state='active' AND (OLD.id IN (setup_project_id,legacy_project_id,zendesk_project_id));
END;
CREATE TRIGGER rehearsal_project_policy AFTER UPDATE OF settings_json ON project_settings BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='project_policy_changed',cleanup_state='pending' WHERE state='active' AND (NEW.project_id IN (setup_project_id,legacy_project_id,zendesk_project_id) AND (json_extract(NEW.settings_json,'$.deleted_at') IS NOT NULL OR json_extract(NEW.settings_json,'$.suspended_at') IS NOT NULL OR NEW.project_id=setup_project_id AND coalesce(json_extract(NEW.settings_json,'$.two_factor_roles'),'[]')<>factor_policy));
END;
CREATE TRIGGER rehearsal_pause_insert AFTER INSERT ON agent_door_state BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='agents_paused_or_revoked',cleanup_state='pending' WHERE state='active' AND (NEW.local_paused=1 OR (NEW.envelope IS NOT NULL AND (NOT json_valid(NEW.envelope) OR coalesce(json_extract(NEW.envelope,'$.paused'),0)=1 OR coalesce(json_extract(NEW.envelope,'$.exp'),0)*1000<=CAST(unixepoch('subsec')*1000 AS INTEGER) OR EXISTS(SELECT 1 FROM json_each(NEW.envelope,'$.revoked.agents') WHERE value=copier_id) OR EXISTS(SELECT 1 FROM json_each(NEW.envelope,'$.revoked.consents') WHERE value=rehearsal_grants.id))));
END;
CREATE TRIGGER rehearsal_business_insert AFTER INSERT ON bs_settings BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='business_paused',cleanup_state='pending' WHERE state='active' AND (NEW.stopped=1);
END;
CREATE TRIGGER rehearsal_agent_insert AFTER INSERT ON agent_door_agents BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='copier_revoked',cleanup_state='pending' WHERE state='active' AND (NEW.id=copier_id AND NEW.revoked=1);
END;
CREATE TRIGGER rehearsal_erasure_insert AFTER INSERT ON contact_erasure_leases BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='legacy_erasure',cleanup_state='pending' WHERE state='active' AND (NEW.project_id IN (setup_project_id,legacy_project_id));
END;
CREATE TRIGGER rehearsal_pause_update AFTER UPDATE ON agent_door_state BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='agents_paused_or_revoked',cleanup_state='pending' WHERE state='active' AND (NEW.local_paused=1 OR (NEW.envelope IS NOT NULL AND (NOT json_valid(NEW.envelope) OR coalesce(json_extract(NEW.envelope,'$.paused'),0)=1 OR coalesce(json_extract(NEW.envelope,'$.exp'),0)*1000<=CAST(unixepoch('subsec')*1000 AS INTEGER) OR EXISTS(SELECT 1 FROM json_each(NEW.envelope,'$.revoked.agents') WHERE value=copier_id) OR EXISTS(SELECT 1 FROM json_each(NEW.envelope,'$.revoked.consents') WHERE value=rehearsal_grants.id))) OR (OLD.envelope IS NOT NULL AND coalesce(json_extract(OLD.envelope,'$.exp'),0)*1000<=CAST(unixepoch('subsec')*1000 AS INTEGER)));
END;
CREATE TRIGGER rehearsal_business_update AFTER UPDATE ON bs_settings BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='business_paused',cleanup_state='pending' WHERE state='active' AND (NEW.stopped=1);
END;
CREATE TRIGGER rehearsal_agent_update AFTER UPDATE ON agent_door_agents BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='copier_revoked',cleanup_state='pending' WHERE state='active' AND (NEW.id=copier_id AND NEW.revoked=1);
END;
CREATE TRIGGER rehearsal_erasure_update AFTER UPDATE ON contact_erasure_leases BEGIN
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='legacy_erasure',cleanup_state='pending' WHERE state='active' AND (NEW.project_id IN (setup_project_id,legacy_project_id));
END;
CREATE TRIGGER rehearsal_cutover AFTER INSERT ON cutover_steps WHEN NEW.state IN ('seed','retired') AND NEW.check_result='passed' BEGIN
 UPDATE rehearsal_grants SET legacy_enabled= CASE WHEN NEW.source='widget' AND NEW.project_id=legacy_project_id THEN 0 ELSE legacy_enabled END ,zendesk_enabled= CASE WHEN NEW.source='email' AND NEW.project_id=zendesk_project_id THEN 0 ELSE zendesk_enabled END WHERE state='active';
 UPDATE legacy_import_worker_runs SET state='stopped',version=version+1,lease_token=NULL,lease_until=NULL,error_code='component_ended',updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE authority_mode='rehearsal' AND state<>'complete' AND rehearsal_id IN (SELECT id FROM rehearsal_grants WHERE legacy_enabled=0);
 UPDATE move_in_zendesk_pulls SET state='abandoned',version=version+1,lease_until=NULL,error='component_ended',updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE authority_mode='rehearsal' AND state<>'applied' AND rehearsal_id IN (SELECT id FROM rehearsal_grants WHERE zendesk_enabled=0);
 UPDATE move_in_zendesk_attachment_pulls SET state='done',version=version+1,lease_until=NULL,error='component_ended',updated_at=CAST(unixepoch('subsec')*1000 AS INTEGER) WHERE authority_mode='rehearsal' AND state<>'done' AND rehearsal_id IN (SELECT id FROM rehearsal_grants WHERE zendesk_enabled=0);
 UPDATE rehearsal_grants SET state='closed',generation=generation+1,credential_hash=NULL,closed_at=CAST(unixepoch('subsec')*1000 AS INTEGER),closure_reason='components_ended',cleanup_state='pending' WHERE state='active' AND legacy_enabled=0 AND zendesk_enabled=0;
END;

-- Closed consent history loses copied personal identity at native anonymization too.
CREATE TRIGGER rehearsal_identity_redact AFTER UPDATE OF email ON users WHEN lower(trim(NEW.email))<>lower(trim(OLD.email)) BEGIN
 UPDATE rehearsal_grants SET owner_email='',configured_owner_email='',issuing_session_hash='' WHERE owner_id=NEW.id;
END;
CREATE TRIGGER rehearsal_identity_remove AFTER DELETE ON users BEGIN
 UPDATE rehearsal_grants SET owner_email='',configured_owner_email='',issuing_session_hash='' WHERE owner_id=OLD.id;
END;
