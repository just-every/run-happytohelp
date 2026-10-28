CREATE TABLE feedback_sources (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id), contact_id TEXT NOT NULL REFERENCES contacts(id),
 message_id TEXT NOT NULL REFERENCES messages(id), account_id TEXT, quote TEXT NOT NULL,
 penny_url TEXT NOT NULL, issue_url TEXT NOT NULL,
 subscribed INTEGER NOT NULL DEFAULT 0 CHECK(subscribed IN (0,1)),
 preference_message_id TEXT REFERENCES messages(id), created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(project_id,conversation_id,message_id,penny_url)
);
CREATE INDEX feedback_request_sources ON feedback_sources(project_id,issue_url);
CREATE TABLE feedback_release_events (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), external_id TEXT NOT NULL,
 digest TEXT NOT NULL, issue_url TEXT NOT NULL, release_url TEXT NOT NULL, released_at INTEGER NOT NULL,
 received_at INTEGER NOT NULL, UNIQUE(project_id,external_id)
);
CREATE TABLE feedback_updates (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 source_id TEXT NOT NULL REFERENCES feedback_sources(id) ON DELETE CASCADE,
 release_id TEXT NOT NULL REFERENCES feedback_release_events(id), content TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','approved','sent','cancelled')),
 approved_by TEXT, approved_at INTEGER, message_id TEXT, created_at INTEGER NOT NULL,
 UNIQUE(source_id,release_id)
);
CREATE TABLE feedback_connections (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), secret_cipher TEXT, updated_at INTEGER NOT NULL
);
