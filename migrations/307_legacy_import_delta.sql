-- MIGRATION-001 legacy delta sweeps. Importer bookkeeping only: no business table, trigger
-- or existing row changes. legacy_import_state holds, per canonical row the legacy importer
-- wrote or confirmed, the digest of the columns it wrote and of the legacy row they came
-- from, so a later delta applies a legacy change only where the seed has not changed the
-- row since. An installation imported before this migration records it by replaying its
-- original package once. legacy_import_conflicts lists the rows a delta left as the seed has
-- them. legacy_import_marks exists only inside a delta's own D1 batch. A delta and its check
-- find a source row across runs through 306_cutover_steps.sql's legacy_import_rows_source
-- index, which leads with (source_table,source_id).
CREATE TABLE legacy_import_state(target_table TEXT NOT NULL,target_key TEXT NOT NULL,columns TEXT NOT NULL,digest TEXT NOT NULL,source_digest TEXT NOT NULL,run_id TEXT NOT NULL,source_table TEXT NOT NULL,source_id TEXT NOT NULL,PRIMARY KEY(target_table,target_key)) WITHOUT ROWID;
CREATE TABLE legacy_import_conflicts(run_id TEXT NOT NULL REFERENCES legacy_import_runs(id),source_table TEXT NOT NULL,source_id TEXT NOT NULL,target_table TEXT NOT NULL,target_key TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(run_id,source_table,source_id,target_table,target_key));
CREATE TABLE legacy_import_marks(name TEXT PRIMARY KEY,high INTEGER NOT NULL);
