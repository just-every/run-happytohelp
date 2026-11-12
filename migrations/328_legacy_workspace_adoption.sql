-- Reservations are permanent provenance, including after workspace deletion.
-- No source user, credential, session or membership is admitted by these tables.
CREATE TABLE legacy_workspace_adoptions (
 manifest_sha256 TEXT PRIMARY KEY,
 custody_project_id TEXT NOT NULL,
 source_project_id TEXT NOT NULL UNIQUE,
 approver_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 policy_version INTEGER NOT NULL CHECK(policy_version=2),
 approval_version INTEGER NOT NULL DEFAULT 1,
 state TEXT NOT NULL CHECK(state IN ('reserved','created')),
 approved_at INTEGER NOT NULL,
 created_at INTEGER
);
CREATE INDEX legacy_workspace_adoptions_custody ON legacy_workspace_adoptions(custody_project_id,manifest_sha256);
-- Bind ORIGINAL chunk identities to their interpretation. A v1 journal cannot
-- silently become historical v2 (nor v2 a CLI/native-account import).
CREATE TABLE legacy_import_mapping_profiles (
 run_id TEXT PRIMARY KEY,
 profile_json TEXT NOT NULL CHECK(json_valid(profile_json))
);
CREATE TABLE legacy_actor_origins (
 project_id TEXT NOT NULL,
 target_table TEXT NOT NULL,
 target_id TEXT NOT NULL,
 field TEXT NOT NULL,
 source_user_id TEXT NOT NULL,
 display_name TEXT,
 PRIMARY KEY(project_id,target_table,target_id,field)
);
-- Preserve original note grouping for C's reader integration. Existing vendor
-- imports remain NULL and keep their current root-conversation interpretation.
ALTER TABLE move_in_notes ADD COLUMN bucket_id TEXT;
