CREATE TABLE procedure_versions (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 procedure_key TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),
 definition TEXT NOT NULL CHECK(json_valid(definition)),
 created_by TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(project_id,procedure_key,version)
);
CREATE TRIGGER procedure_versions_immutable BEFORE UPDATE ON procedure_versions
BEGIN SELECT RAISE(ABORT,'Procedure versions are immutable'); END;
