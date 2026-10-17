CREATE TABLE suspended_emails (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 receipt_id TEXT NOT NULL,
 from_address TEXT NOT NULL,
 to_json TEXT NOT NULL,
 subject TEXT NOT NULL,
 text TEXT NOT NULL,
 reason TEXT NOT NULL,
 auth_json TEXT NOT NULL,
 headers_json TEXT NOT NULL,
 candidate_conversation_id TEXT,
 input_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE(project_id,receipt_id)
);
CREATE INDEX suspended_mail_retention ON suspended_emails(expires_at);
CREATE INDEX suspended_mail_workspace ON suspended_emails(project_id,created_at);
CREATE TABLE email_sender_rules (
 project_id TEXT NOT NULL REFERENCES projects(id),
 address TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('allow','block')),
 created_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,address)
);
