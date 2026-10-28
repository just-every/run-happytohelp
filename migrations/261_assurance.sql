CREATE TABLE assurance_profiles (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), requested_at INTEGER NOT NULL,
 partner TEXT NOT NULL, deployment_ref TEXT NOT NULL, timezone TEXT NOT NULL,
 country TEXT NOT NULL DEFAULT 'US' CHECK(country='US'), currency TEXT NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 recording_enabled INTEGER NOT NULL DEFAULT 0 CHECK(recording_enabled=0),
 revision INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE assurance_evidence (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL,
 provider TEXT NOT NULL, reference TEXT NOT NULL, recorded_by TEXT NOT NULL,
 recorded_at INTEGER NOT NULL, valid_from INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('executed','passed','approved','revoked')),
 settings_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(settings_json)),
 revoked_at INTEGER, UNIQUE(project_id,id)
);
CREATE INDEX assurance_evidence_project ON assurance_evidence(project_id,kind,expires_at);
