CREATE TABLE mailbox_connections (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 provider TEXT NOT NULL CHECK(provider IN ('gmail','microsoft','imap','forwarding')),
 address TEXT NOT NULL COLLATE NOCASE,
 display_name TEXT NOT NULL DEFAULT '',
 sender_address TEXT COLLATE NOCASE,
 status TEXT NOT NULL CHECK(status IN ('connected','disconnected','reconnect_required','needs_backfill')),
 credential_cipher TEXT,
 credential_version INTEGER NOT NULL DEFAULT 1,
 mutation_token TEXT,
 cursor_json TEXT,
 sync_lock TEXT,
 sync_lock_until INTEGER,
 last_sync_at INTEGER,
 error_code TEXT,
 connected_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(project_id,provider,address)
);
CREATE INDEX mailbox_connections_project ON mailbox_connections(project_id,status);
-- One active routing owner for an address across all projects. Disconnect removes
-- addresses but retains opaque send/receive receipts to fence future replay.
CREATE TABLE mailbox_addresses (
 address TEXT PRIMARY KEY COLLATE NOCASE,
 mailbox_id TEXT NOT NULL REFERENCES mailbox_connections(id),
 project_id TEXT NOT NULL REFERENCES projects(id),
 can_send INTEGER NOT NULL DEFAULT 0 CHECK(can_send IN (0,1)),
 is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1))
);
CREATE INDEX mailbox_addresses_connection ON mailbox_addresses(mailbox_id);
CREATE TABLE mailbox_oauth_states (
 state_hash TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 user_id TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('gmail','microsoft')),
 mailbox_id TEXT,
 mailbox_version INTEGER,
 display_name TEXT NOT NULL,
 verifier_cipher TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 authority_revision INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER
);
CREATE INDEX mailbox_oauth_states_expiry ON mailbox_oauth_states(expires_at);
CREATE TABLE mailbox_signatures (
 mailbox_id TEXT NOT NULL REFERENCES mailbox_connections(id),
 agent_id TEXT NOT NULL,
 text TEXT NOT NULL DEFAULT '',
 html TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(mailbox_id,agent_id)
);
CREATE TABLE mailbox_sync_receipts (
 mailbox_id TEXT NOT NULL REFERENCES mailbox_connections(id),
 provider_message_id TEXT NOT NULL,
 received_at INTEGER NOT NULL,
 PRIMARY KEY(mailbox_id,provider_message_id)
);
CREATE TABLE mailbox_sends (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 mailbox_id TEXT NOT NULL REFERENCES mailbox_connections(id),
 intent_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','sent','failed','uncertain')),
 provider_id TEXT,
 error_code TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
-- Admission checks the workspace-scoped mailbox relation. Keep this nullable
-- additive column independent so older archives can restore while R6 stores are empty.
ALTER TABLE conversations ADD COLUMN mailbox_id TEXT;
CREATE INDEX conversations_mailbox ON conversations(project_id,mailbox_id);

-- Fence the legacy single-mailbox route and the new multi-mailbox route in the
-- same database transaction, including concurrent configuration requests.
CREATE TRIGGER mailbox_address_legacy_guard BEFORE INSERT ON mailbox_addresses WHEN EXISTS(
 SELECT 1 FROM email_settings e WHERE lower(e.inbound_address)=lower(NEW.address) AND e.project_id<>NEW.project_id AND e.is_enabled=1
 AND NOT EXISTS(SELECT 1 FROM project_settings ps WHERE ps.project_id=e.project_id AND json_extract(ps.settings_json,'$.deleted_at') IS NOT NULL)
) BEGIN SELECT RAISE(ABORT,'mailbox_address_conflict'); END;
CREATE TRIGGER email_settings_mailbox_insert_guard BEFORE INSERT ON email_settings WHEN NEW.is_enabled=1 AND EXISTS(
 SELECT 1 FROM mailbox_addresses a WHERE lower(a.address)=lower(NEW.inbound_address) AND a.project_id<>NEW.project_id
) BEGIN SELECT RAISE(ABORT,'mailbox_address_conflict'); END;
CREATE TRIGGER email_settings_mailbox_update_guard BEFORE UPDATE ON email_settings WHEN NEW.is_enabled=1 AND EXISTS(
 SELECT 1 FROM mailbox_addresses a WHERE lower(a.address)=lower(NEW.inbound_address) AND a.project_id<>NEW.project_id
) BEGIN SELECT RAISE(ABORT,'mailbox_address_conflict'); END;
CREATE TRIGGER mailbox_project_retirement AFTER UPDATE OF settings_json ON project_settings WHEN json_extract(NEW.settings_json,'$.deleted_at') IS NOT NULL BEGIN
 DELETE FROM mailbox_addresses WHERE project_id=NEW.project_id;
 UPDATE mailbox_connections SET status='disconnected',credential_cipher=NULL,credential_version=credential_version+1,sync_lock=NULL,sync_lock_until=NULL WHERE project_id=NEW.project_id;
 DELETE FROM mailbox_oauth_states WHERE project_id=NEW.project_id;
END;
