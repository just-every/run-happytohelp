-- Apply before serving v2 custody APIs. No source payload or session is retained here.
CREATE TABLE legacy_package_scope_fences (
 project_id TEXT PRIMARY KEY, generation INTEGER NOT NULL DEFAULT 1,
 reason TEXT NOT NULL CHECK(reason IN ('erasure','workspace_deleted')), fenced_at INTEGER NOT NULL, cleanup_after TEXT NOT NULL DEFAULT '', cleanup_done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX legacy_package_scope_cleanup ON legacy_package_scope_fences(cleanup_done,fenced_at,project_id);
CREATE TABLE legacy_package_custody (
 manifest_sha256 TEXT PRIMARY KEY, custody_project_id TEXT NOT NULL, source_project_id TEXT NOT NULL,
 destination_project_id TEXT, generation INTEGER NOT NULL DEFAULT 1,
 custody_generation INTEGER NOT NULL DEFAULT 0, source_generation INTEGER NOT NULL DEFAULT 0,
 destination_generation INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('admitting','ready','purging','purged','invalidated')),
 mapping_policy_version INTEGER NOT NULL CHECK(mapping_policy_version=2),
 created_at INTEGER NOT NULL, last_explicit_activity_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL,
 purge_reason TEXT CHECK(purge_reason IN ('erasure','workspace_deleted','expired','discarded')),
 closed_at INTEGER, purged_at INTEGER, cleanup_table INTEGER NOT NULL DEFAULT 0,
 cleanup_after TEXT NOT NULL DEFAULT '', cleanup_token TEXT, cleanup_until INTEGER, next_cleanup_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX legacy_package_custody_project ON legacy_package_custody(custody_project_id,manifest_sha256);
CREATE INDEX legacy_package_source_project ON legacy_package_custody(source_project_id,manifest_sha256);
CREATE INDEX legacy_package_destination_project ON legacy_package_custody(destination_project_id,manifest_sha256);
CREATE INDEX legacy_package_expiry ON legacy_package_custody(status,expires_at,manifest_sha256);
CREATE INDEX legacy_package_cleanup ON legacy_package_custody(status,next_cleanup_at,manifest_sha256);
CREATE TABLE legacy_package_keys (
 manifest_sha256 TEXT NOT NULL REFERENCES legacy_package_custody(manifest_sha256),
 key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('manifest','chunk','context','object')),
 ordinal INTEGER NOT NULL, generation INTEGER NOT NULL, cleanup_state INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_state IN (0,1)),
 PRIMARY KEY(manifest_sha256,key)
);
CREATE INDEX legacy_package_key_cleanup ON legacy_package_keys(manifest_sha256,cleanup_state,key);
