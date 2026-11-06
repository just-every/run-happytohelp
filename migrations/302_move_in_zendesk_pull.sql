-- Move in pulls a whole Zendesk account over OAuth with a public PKCE client.
-- Additive only. Existing runs are uploads; a pulled batch is an ordinary Move in
-- run whose source is 'zendesk-pull'. Tokens and the PKCE verifier are stored only
-- as AES-GCM ciphertext under the installation's integration key. Staged source
-- records exist only while a pull reads and packs; packed batches hold custody in
-- their runs, so contact erasure covers them like uploads.
ALTER TABLE move_in_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'upload' CHECK(source IN ('upload','zendesk-pull'));
-- One single-use authorization per Connect, bound to the session and workspace.
CREATE TABLE move_in_zendesk_authorizations(
 state_hash TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 subdomain TEXT NOT NULL,
 client_id TEXT NOT NULL,
 verifier_ciphertext TEXT NOT NULL,
 redirect_uri TEXT NOT NULL,
 expires_at INTEGER NOT NULL);
CREATE INDEX move_in_zendesk_authorizations_project ON move_in_zendesk_authorizations(project_id);
-- One workspace binds one Zendesk subdomain. Disconnect clears the ciphertext and
-- keeps the binding, so a later Connect cannot mix two accounts' native ids.
CREATE TABLE move_in_zendesk_connections(
 project_id TEXT PRIMARY KEY,
 subdomain TEXT NOT NULL,
 client_id TEXT NOT NULL,
 scopes TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('connected','reconnect','disconnected')),
 access_ciphertext TEXT,
 refresh_ciphertext TEXT,
 access_expires_at INTEGER,
 refresh_expires_at INTEGER,
 generation INTEGER NOT NULL DEFAULT 1,
 connected_by TEXT NOT NULL,
 connected_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL);
CREATE TABLE move_in_zendesk_pulls(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 subdomain TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pulling','reviewing','ready','applying','applied','abandoned')),
 phase TEXT NOT NULL,
 cursor_json TEXT NOT NULL DEFAULT '{}',
 start_json TEXT NOT NULL DEFAULT '{}',
 resume_json TEXT,
 next_at INTEGER NOT NULL DEFAULT 0,
 incremental_json TEXT NOT NULL DEFAULT '[]',
 counts_json TEXT NOT NULL DEFAULT '{}',
 approval_json TEXT,
 approved_at INTEGER,
 error TEXT,
 lease_until INTEGER,
 version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX move_in_zendesk_pulls_active ON move_in_zendesk_pulls(project_id) WHERE state NOT IN ('applied','abandoned');
CREATE INDEX move_in_zendesk_pulls_project ON move_in_zendesk_pulls(project_id,created_at);
-- Source records read by a pull, until they are packed into Move in batches. A
-- ticket_comment is a reply that arrived on a ticket an earlier import holds.
CREATE TABLE move_in_zendesk_staged(
 pull_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('ticket','ticket_comment','user','organization','ticket_field','article')),
 source_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('comments','ready','packed','deleted','missing')),
 record_json TEXT,
 refs_json TEXT,
 comments_cursor TEXT,
 PRIMARY KEY(pull_id,kind,source_id));
CREATE INDEX move_in_zendesk_staged_state ON move_in_zendesk_staged(pull_id,kind,state);
-- Records a pull refuses by name before packing (ids and reasons only).
CREATE TABLE move_in_zendesk_refusals(
 pull_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 source_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 PRIMARY KEY(pull_id,kind,source_id));
-- The ordered Move in runs a pull packed, with each review's summary once ready.
-- A batch identical to an earlier pull's (unchanged fields, say) reuses that run.
CREATE TABLE move_in_zendesk_pull_runs(
 pull_id TEXT NOT NULL,
 ordinal INTEGER NOT NULL,
 run_id TEXT NOT NULL,
 summary_json TEXT,
 PRIMARY KEY(pull_id,ordinal));
CREATE INDEX move_in_zendesk_pull_runs_run ON move_in_zendesk_pull_runs(run_id);
-- The hash of each packed ticket's own fields (comments and update clocks left
-- out), so a later pull can tell a ticket whose fields changed from one that only
-- gained replies. A hash only; no source content.
CREATE TABLE move_in_zendesk_ticket_fields(
 project_id TEXT NOT NULL,
 source_id TEXT NOT NULL,
 fields_hash TEXT NOT NULL,
 PRIMARY KEY(project_id,source_id));
