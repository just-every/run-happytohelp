-- Customer mailbox proof is independent from account sign-in and widget claims.
CREATE TABLE portal_links(token_hash TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),email TEXT NOT NULL,return_path TEXT NOT NULL,expires_at INTEGER NOT NULL,consumed_at INTEGER);
CREATE INDEX portal_links_expiry ON portal_links(expires_at);
CREATE TABLE portal_identities(project_id TEXT NOT NULL REFERENCES projects(id),email TEXT NOT NULL,contact_id TEXT NOT NULL REFERENCES contacts(id),verified_at INTEGER NOT NULL,PRIMARY KEY(project_id,email),UNIQUE(project_id,contact_id));
CREATE TABLE portal_session_proofs(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash),project_id TEXT NOT NULL REFERENCES projects(id),contact_id TEXT NOT NULL REFERENCES contacts(id),email TEXT NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX portal_sessions_contact ON portal_session_proofs(project_id,contact_id);
CREATE TABLE portal_preferences(project_id TEXT NOT NULL REFERENCES projects(id),contact_id TEXT NOT NULL REFERENCES contacts(id),locale TEXT NOT NULL DEFAULT 'en',update_emails INTEGER NOT NULL DEFAULT 1 CHECK(update_emails IN (0,1)),updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,contact_id));
