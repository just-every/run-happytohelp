-- 330 is reserved for platform recovery. Cleanup-only v1 inventory never grants v2 readiness.
ALTER TABLE legacy_package_custody ADD COLUMN cleanup_only INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_only IN (0,1));
ALTER TABLE legacy_package_custody ADD COLUMN seeding_complete INTEGER NOT NULL DEFAULT 1 CHECK(seeding_complete IN (0,1));
CREATE TABLE legacy_package_v1_seeds (
 manifest_sha256 TEXT PRIMARY KEY REFERENCES legacy_package_custody(manifest_sha256),
 phase TEXT NOT NULL DEFAULT 'manifest' CHECK(phase IN ('manifest','listing','complete')),
 manifest_offset INTEGER NOT NULL DEFAULT 0,
 list_cursor TEXT NOT NULL DEFAULT ''
);
-- Until the old prefix inventory is exhausted, no erasure may assert all source is gone.
-- New intake is v2-only; this cursor is never reset by an upload or a status read.
CREATE TABLE legacy_package_v1_inventory (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 list_cursor TEXT NOT NULL DEFAULT '', complete INTEGER NOT NULL DEFAULT 0 CHECK(complete IN (0,1))
);
INSERT INTO legacy_package_v1_inventory(singleton) VALUES(1);
CREATE INDEX legacy_worker_source_scope ON legacy_import_worker_runs(source_project_id,contract_version,manifest_sha256);
-- Private installation counts have no workspace audit/read entitlement.
CREATE TABLE installation_work_baseline (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 captured_at INTEGER NOT NULL,
 counts_json TEXT NOT NULL CHECK(json_valid(counts_json))
);
