-- Cutover steps: each switch of a move-in source (Zendesk, legacy HappyToHelp, the email route, the website
-- widget) is recorded here, with its change, its undo and the check made after it. Additive only. A step is
-- workspace history like the security log: never edited and never deleted, so an undo is a newer step. recorded_by
-- names the member without a foreign key, so the member's name follows the account's anonymization.
CREATE TABLE cutover_steps(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 source TEXT NOT NULL CHECK(source IN ('zendesk','legacy','email','widget')),
 state TEXT NOT NULL CHECK(state IN ('incumbent','seed','retired')),
 change TEXT NOT NULL,
 undo TEXT NOT NULL,
 check_result TEXT NOT NULL CHECK(check_result IN ('passed','failed','not_run')),
 check_detail TEXT NOT NULL DEFAULT '',
 recorded_by TEXT NOT NULL,
 recorded_at INTEGER NOT NULL);
CREATE INDEX cutover_steps_source ON cutover_steps(project_id,source,recorded_at);
-- The page's live counts read only this workspace's rows, and these indexes keep each count off a full scan.
CREATE INDEX move_in_conversations_vendor ON move_in_conversations(project_id,vendor);
CREATE INDEX legacy_import_rows_source ON legacy_import_rows(source_table,source_id,status,run_id);
CREATE INDEX inbound_emails_arrivals ON inbound_emails(project_id,state,created_at);
CREATE INDEX conversations_created ON conversations(project_id,created_at);
