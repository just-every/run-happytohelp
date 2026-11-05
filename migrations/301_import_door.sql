INSERT INTO ik_d1_assertions(ok) SELECT 0 WHERE EXISTS(SELECT 1 FROM pragma_index_list('ik_door_plans') l WHERE l."unique"=1 AND (SELECT group_concat(name) FROM pragma_index_info(l.name))='installation_id,namespace,bundle_sha256');
CREATE TABLE IF NOT EXISTS ik_door_settings (
    installation_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)));
CREATE TABLE IF NOT EXISTS ik_door_revoked_keys (
    installation_id TEXT NOT NULL, kid TEXT NOT NULL, PRIMARY KEY(installation_id,kid));
CREATE TABLE IF NOT EXISTS ik_door_grants (
    installation_id TEXT NOT NULL, jti TEXT NOT NULL, action TEXT NOT NULL,
    namespace TEXT NOT NULL, kid TEXT NOT NULL, expires INTEGER NOT NULL,
    PRIMARY KEY(installation_id,jti));
CREATE TABLE IF NOT EXISTS ik_door_uploads (
    id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, namespace TEXT NOT NULL,
    name TEXT NOT NULL, bundle_sha256 TEXT NOT NULL, total_bytes INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL, intake_json TEXT);
CREATE TABLE IF NOT EXISTS ik_door_chunks (
    upload_id TEXT NOT NULL REFERENCES ik_door_uploads(id), ordinal INTEGER NOT NULL,
    sha256 TEXT NOT NULL, size INTEGER NOT NULL, base64 TEXT NOT NULL,
    PRIMARY KEY(upload_id,ordinal));
CREATE TABLE IF NOT EXISTS ik_door_namespaces (
    installation_id TEXT NOT NULL, namespace TEXT NOT NULL, head_id TEXT, pending_id TEXT,
    PRIMARY KEY(installation_id,namespace));
CREATE TABLE IF NOT EXISTS ik_door_plans (
      id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, namespace TEXT NOT NULL,
      bundle_sha256 TEXT NOT NULL, fingerprint TEXT NOT NULL, previous_id TEXT,
      job_id TEXT UNIQUE, snapshot_hash TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1)));
CREATE TABLE IF NOT EXISTS ik_door_plan_chunks (
      plan_id TEXT NOT NULL REFERENCES ik_door_plans(id), ordinal INTEGER NOT NULL,
      body TEXT NOT NULL, PRIMARY KEY(plan_id,ordinal));
CREATE TABLE IF NOT EXISTS ik_door_approvals (
      plan_id TEXT PRIMARY KEY REFERENCES ik_door_plans(id), approval_id TEXT NOT NULL,
      owner TEXT NOT NULL, approved_at TEXT NOT NULL, fingerprint TEXT NOT NULL,
      reviewer TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ik_door_plan_bundle ON ik_door_plans(installation_id,namespace,bundle_sha256);
CREATE TABLE IF NOT EXISTS ik_door_apply_failures (
    plan_id TEXT PRIMARY KEY REFERENCES ik_door_plans(id), reason_code TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS ik_door_scopes (
    installation_id TEXT NOT NULL, namespace TEXT NOT NULL, destination TEXT NOT NULL,
    PRIMARY KEY(installation_id,namespace));
CREATE TABLE IF NOT EXISTS ik_door_archives (
    id TEXT PRIMARY KEY, installation_id TEXT NOT NULL, namespace TEXT NOT NULL,
    upload_id TEXT NOT NULL, tool TEXT NOT NULL, taken_at TEXT NOT NULL, name TEXT NOT NULL,
    bundle_sha256 TEXT NOT NULL, total_bytes INTEGER NOT NULL, total_chunks INTEGER NOT NULL,
    counts_json TEXT NOT NULL, UNIQUE(installation_id,namespace,upload_id));
CREATE TABLE IF NOT EXISTS ik_door_archive_chunks (
    archive_id TEXT NOT NULL REFERENCES ik_door_archives(id), ordinal INTEGER NOT NULL,
    sha256 TEXT NOT NULL, size INTEGER NOT NULL, base64 TEXT NOT NULL,
    PRIMARY KEY(archive_id,ordinal));

-- Permanent native claim destination. No caller or grant can select a workspace.
CREATE TABLE h2h_import_door_claim (
 installation_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT NOT NULL
);
-- Hash-only admission aliases bind indivisible door custody to native erasure.
CREATE TABLE h2h_import_door_identities (
 project_id TEXT NOT NULL, bundle_sha256 TEXT NOT NULL,
 digest TEXT NOT NULL, source_digest TEXT NOT NULL,
 PRIMARY KEY(project_id,bundle_sha256,digest,source_digest)
);
CREATE INDEX h2h_import_door_identity_lookup ON h2h_import_door_identities(project_id,digest);
