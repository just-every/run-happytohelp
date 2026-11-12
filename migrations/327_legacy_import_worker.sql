-- Private synthetic package custody and resumable Worker scratch. Apply before Worker code.
CREATE TABLE legacy_import_worker_runs (
 id TEXT PRIMARY KEY, contract_version INTEGER NOT NULL DEFAULT 1,
 manifest_sha256 TEXT NOT NULL UNIQUE, project_id TEXT NOT NULL, source_project_id TEXT NOT NULL,
 actor_id TEXT NOT NULL, session_hash TEXT NOT NULL, mode TEXT NOT NULL,
 exclude_json TEXT NOT NULL CHECK(json_valid(exclude_json)), state TEXT NOT NULL, phase TEXT NOT NULL,
 cursor_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(cursor_json)), attempt INTEGER NOT NULL DEFAULT 1,
 version INTEGER NOT NULL DEFAULT 0, lease_token TEXT, lease_until INTEGER, next_at INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, started_at INTEGER,
 completed_at INTEGER, verified_at INTEGER,
 work_before_json TEXT CHECK(work_before_json IS NULL OR json_valid(work_before_json)),
 work_after_json TEXT CHECK(work_after_json IS NULL OR json_valid(work_after_json)),
 objects_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(objects_json)),
 metrics_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metrics_json))
);
CREATE INDEX legacy_import_worker_due ON legacy_import_worker_runs(state,next_at,lease_until,id);
CREATE INDEX legacy_import_worker_project ON legacy_import_worker_runs(project_id,updated_at,id);
CREATE UNIQUE INDEX legacy_import_worker_unfinished ON legacy_import_worker_runs(project_id) WHERE state IN ('queued','running','paused');
CREATE TABLE legacy_import_worker_parts (
 run_id TEXT NOT NULL REFERENCES legacy_import_worker_runs(id) ON DELETE CASCADE,
 file TEXT NOT NULL, kind TEXT NOT NULL, ordinal INTEGER NOT NULL DEFAULT 0, source_table TEXT,
 expected_rows INTEGER NOT NULL DEFAULT 0, expected_bytes INTEGER NOT NULL DEFAULT 0, sha256 TEXT NOT NULL,
 media_id TEXT, target_key TEXT, journal_run_id TEXT, journal_digest TEXT,
 verified INTEGER NOT NULL DEFAULT 0, loaded_rows INTEGER NOT NULL DEFAULT 0,
 preflight_rows INTEGER NOT NULL DEFAULT 0, applied_rows INTEGER NOT NULL DEFAULT 0, checked_rows INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,file), UNIQUE(run_id,kind,ordinal)
);
CREATE INDEX legacy_import_worker_parts_table ON legacy_import_worker_parts(run_id,source_table,ordinal);
CREATE TABLE legacy_import_context (
 run_id TEXT NOT NULL REFERENCES legacy_import_worker_runs(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, source_table TEXT NOT NULL, source_id TEXT NOT NULL,
 row_json TEXT NOT NULL CHECK(json_valid(row_json)), row_digest TEXT NOT NULL,
 project_id TEXT, parent_id TEXT, created_ms INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,kind,source_table,source_id)
);
CREATE INDEX legacy_import_context_parent ON legacy_import_context(run_id,source_table,parent_id,source_id);
CREATE INDEX legacy_import_context_project ON legacy_import_context(run_id,source_table,project_id,source_id);
CREATE TABLE legacy_import_context_messages (
 run_id TEXT NOT NULL REFERENCES legacy_import_worker_runs(id) ON DELETE CASCADE,
 id TEXT NOT NULL, conversation_id TEXT NOT NULL, project_id TEXT, contact_id TEXT, agent_id TEXT, ai_id TEXT,
 created_ms INTEGER NOT NULL DEFAULT 0, deleted INTEGER NOT NULL DEFAULT 0, local_id TEXT,
 revision INTEGER NOT NULL DEFAULT 0, row_json TEXT NOT NULL CHECK(json_valid(row_json)), PRIMARY KEY(run_id,id)
);
CREATE INDEX legacy_import_context_transcript ON legacy_import_context_messages(run_id,conversation_id,deleted,created_ms,id);
CREATE INDEX legacy_import_context_delivery ON legacy_import_context_messages(run_id,conversation_id,local_id,created_ms,id);
CREATE TABLE legacy_import_context_media (
 run_id TEXT NOT NULL REFERENCES legacy_import_worker_runs(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL, link_id TEXT NOT NULL, mediable_type TEXT NOT NULL, mediable_id TEXT NOT NULL,
 object_key TEXT NOT NULL, legacy_key TEXT NOT NULL, row_json TEXT NOT NULL CHECK(json_valid(row_json)),
 PRIMARY KEY(run_id,media_id,link_id)
);
CREATE INDEX legacy_import_context_media_parent ON legacy_import_context_media(run_id,mediable_type,mediable_id,media_id);
CREATE INDEX legacy_import_context_media_key ON legacy_import_context_media(run_id,legacy_key,media_id);
CREATE TABLE legacy_import_context_identities (
 run_id TEXT NOT NULL REFERENCES legacy_import_worker_runs(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL, identity TEXT NOT NULL, contact_id TEXT NOT NULL, created_ms INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,project_id,identity)
);
CREATE TABLE legacy_import_worker_counts (
 run_id TEXT NOT NULL REFERENCES legacy_import_worker_runs(id) ON DELETE CASCADE, source_table TEXT NOT NULL,
 package_rows INTEGER NOT NULL DEFAULT 0, excluded_rows INTEGER NOT NULL DEFAULT 0, journal_rows INTEGER NOT NULL DEFAULT 0,
 mapped_rows INTEGER NOT NULL DEFAULT 0, archived_rows INTEGER NOT NULL DEFAULT 0, erased_rows INTEGER NOT NULL DEFAULT 0,
 applied_rows INTEGER NOT NULL DEFAULT 0, replayed_rows INTEGER NOT NULL DEFAULT 0, holds INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(run_id,source_table)
);
