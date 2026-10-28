-- Read-only Help Scout intake stages ordinary, reviewed Move in artifacts.
-- No transcript, customer address or provider response is kept in these stores.
CREATE TABLE helpscout_connections (
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 mailbox_id TEXT NOT NULL,
 token_cipher TEXT,
 webhook_cipher TEXT,
 generation INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('connected','disconnected')),
 cursor TEXT NOT NULL,
 pending INTEGER NOT NULL DEFAULT 1,
 sync_lock TEXT,
 sync_lock_until INTEGER,
 last_sync_at INTEGER,
 error_code TEXT,
 updated_at INTEGER NOT NULL
);
CREATE TABLE helpscout_sync_receipts (
 project_id TEXT NOT NULL REFERENCES projects(id),
 mailbox_id TEXT NOT NULL,
 source_digest TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES move_in_runs(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,mailbox_id,source_digest,content_digest)
);
CREATE TABLE helpscout_webhook_receipts (
 project_id TEXT NOT NULL REFERENCES projects(id),
 digest TEXT NOT NULL,
 received_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,digest)
);
