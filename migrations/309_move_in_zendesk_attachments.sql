-- Move in brings each imported Zendesk comment's attachment bytes into private R2
-- over the workspace's existing Zendesk connection. Additive only. Ids, states and
-- reason codes only: no file name, URL, token or Location is ever stored here (the
-- file name lives on the media row, which erasure already covers).
CREATE TABLE move_in_zendesk_attachment_pulls(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 subdomain TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','done')),
 cursor_json TEXT NOT NULL DEFAULT '{}',
 next_at INTEGER NOT NULL DEFAULT 0,
 error TEXT,
 lease_until INTEGER,
 version INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL);
CREATE UNIQUE INDEX move_in_zendesk_attachment_pulls_running ON move_in_zendesk_attachment_pulls(project_id) WHERE state='running';
CREATE INDEX move_in_zendesk_attachment_pulls_project ON move_in_zendesk_attachment_pulls(project_id,created_at);
-- The workspace's ledger: every attachment found on a comment it holds, bound by
-- Zendesk attachment id to its comment, conversation and native message or note.
-- run_id is the run that last attempted it.
CREATE TABLE move_in_zendesk_attachments(
 project_id TEXT NOT NULL,
 attachment_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 comment_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 visible INTEGER NOT NULL CHECK(visible IN (0,1)),
 media_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','stored','refused')),
 reason TEXT,
 run_id TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,attachment_id));
CREATE INDEX move_in_zendesk_attachments_state ON move_in_zendesk_attachments(project_id,state);
CREATE INDEX move_in_zendesk_attachments_ticket ON move_in_zendesk_attachments(project_id,ticket_id);
-- Tickets the workspace holds that Zendesk no longer returns, by ticket id and reason.
CREATE TABLE move_in_zendesk_attachment_tickets(
 project_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 reason TEXT NOT NULL,
 run_id TEXT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,ticket_id));
-- A fetched file on an imported private note, shaped like api_note_media.
CREATE TABLE move_in_note_media(
 note_id TEXT NOT NULL REFERENCES move_in_notes(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
 PRIMARY KEY(note_id,media_id));
