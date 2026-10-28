CREATE TABLE feedback_penny_connections (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), origin TEXT NOT NULL,
 token_cipher TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE feedback_penny_requesters (
 project_id TEXT NOT NULL REFERENCES projects(id), contact_id TEXT NOT NULL REFERENCES contacts(id),
 requester_id TEXT, claim_source_id TEXT NOT NULL, PRIMARY KEY(project_id,contact_id)
);
CREATE TABLE feedback_handoffs (
 source_id TEXT PRIMARY KEY REFERENCES feedback_sources(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id), intent_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','accepted','uncertain')),
 approved_by TEXT NOT NULL, consent_message_id TEXT NOT NULL,
 created_at INTEGER NOT NULL, settled_at INTEGER
);
