CREATE TABLE email_followup_links (
 project_id TEXT NOT NULL REFERENCES projects(id),
 parent_id TEXT NOT NULL REFERENCES conversations(id),
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
 created_at INTEGER NOT NULL
);
CREATE INDEX email_followup_parent ON email_followup_links(project_id,parent_id,created_at);
