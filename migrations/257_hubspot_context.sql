-- Read-only CRM context never changes native customer identity or authority.
CREATE TABLE crm_connections (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 account_id TEXT NOT NULL,
 token_cipher TEXT,
 properties_json TEXT NOT NULL,
 revision TEXT NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE crm_mappings (
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 source_contact_id TEXT NOT NULL,
 company_id TEXT,
 source_company_id TEXT,
 revision TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'stale',
 context_json TEXT,
 refreshed_at INTEGER,
 checked_at INTEGER,
 PRIMARY KEY(project_id,contact_id),
 UNIQUE(project_id,source_contact_id),
 CHECK ((company_id IS NULL) = (source_company_id IS NULL))
);
CREATE TABLE crm_changes (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 at INTEGER NOT NULL
);
