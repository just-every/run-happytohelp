-- Background reads inherit the explicitly connecting session, never mint one.
ALTER TABLE helpscout_connections ADD COLUMN sync_actor_id TEXT;
ALTER TABLE helpscout_connections ADD COLUMN sync_session_hash TEXT;
ALTER TABLE helpscout_connections ADD COLUMN continuous INTEGER NOT NULL DEFAULT 0 CHECK(continuous IN (0,1));
ALTER TABLE helpscout_connections ADD COLUMN next_sync_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX helpscout_due ON helpscout_connections(status,continuous,next_sync_at);
-- A receipt contains counts and opaque identities, never imported content.
CREATE TABLE helpscout_merge_receipts (
 project_id TEXT NOT NULL REFERENCES projects(id),
 run_id TEXT NOT NULL REFERENCES move_in_runs(id),
 fingerprint TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 messages INTEGER NOT NULL,
 notes INTEGER NOT NULL,
 merged_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,run_id)
);
