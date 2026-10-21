-- Live teammate presence per workspace, written only by the workspace's operator stream (ConversationSocket
-- project:<id>). A row counts until expires_at: an entry a restart left behind expires instead of staying online.
-- Live state: never exported, imported or restored (scripts/installer/portability-policy.mjs).
CREATE TABLE operator_presence(project_id TEXT NOT NULL REFERENCES projects(id),user_id TEXT NOT NULL REFERENCES users(id),active_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,PRIMARY KEY(project_id,user_id));
