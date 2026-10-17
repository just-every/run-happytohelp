CREATE TABLE notification_triggers (
 project_id TEXT NOT NULL REFERENCES projects(id), event TEXT NOT NULL CHECK(event IN ('request_received','ticket_solved')),
 channel TEXT NOT NULL DEFAULT '*', brand_id TEXT NOT NULL DEFAULT '*', enabled INTEGER NOT NULL DEFAULT 1,
 subject TEXT NOT NULL, body TEXT NOT NULL, expected_reply_time TEXT NOT NULL DEFAULT 'within one business day', updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,event,channel,brand_id)
);
CREATE TABLE notification_trigger_claims (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 event TEXT NOT NULL, claim_token TEXT, state TEXT NOT NULL, outcome_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL,
 UNIQUE(project_id,conversation_id,event)
);
CREATE TABLE notification_preferences (
 project_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('assignment','group','follower','mention','customer_updated')),
 inbox INTEGER NOT NULL DEFAULT 1, email INTEGER NOT NULL DEFAULT 1,
 PRIMARY KEY(project_id,user_id,kind), FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE notification_inbox (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL, kind TEXT NOT NULL, inbox INTEGER NOT NULL DEFAULT 1, email INTEGER NOT NULL DEFAULT 1,
 email_address TEXT, state TEXT NOT NULL DEFAULT 'pending', read_at INTEGER, created_at INTEGER NOT NULL,
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE INDEX notification_inbox_user ON notification_inbox(project_id,user_id,created_at);
