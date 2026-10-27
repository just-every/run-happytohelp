-- Preserve the original tracker connection table and all its foreign references.
ALTER TABLE escalation_connections ADD COLUMN installed_by TEXT;
CREATE TABLE escalation_teams_connections(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),provider TEXT NOT NULL CHECK(provider='teams'),target TEXT NOT NULL,base_url TEXT,token_cipher TEXT,webhook_cipher TEXT,updated_at INTEGER NOT NULL,installed_by TEXT NOT NULL,UNIQUE(project_id,provider));
