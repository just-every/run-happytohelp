-- NOTIFY-001 personal Teams notices. New tables only: no existing table, trigger or
-- migration changes. Consent, links and preferences leave with their membership;
-- delivery outcomes leave with their inbox notice, so member and contact erasure
-- remove them. None of these tables travels in an export.
CREATE TABLE teammate_teams_consent(
 project_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 enabled_at INTEGER NOT NULL,
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE teammate_teams_codes(
 token_hash TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 session_hash TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE(project_id,user_id),
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE teammate_teams_links(
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 tenant_id TEXT NOT NULL,
 app_id TEXT NOT NULL,
 aad_object_id TEXT NOT NULL,
 provider_user TEXT NOT NULL,
 personal_conversation TEXT NOT NULL,
 service_url TEXT NOT NULL,
 activity_id TEXT NOT NULL,
 verified_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,user_id),
 UNIQUE(connection_id,tenant_id,aad_object_id),
 UNIQUE(connection_id,provider_user),
 UNIQUE(connection_id,activity_id),
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE teammate_teams_preferences(
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','group','follower','mention','customer_updated')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 enabled_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,user_id,kind),
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE teammate_teams_deliveries(
 notice_id TEXT PRIMARY KEY REFERENCES notification_inbox(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 connection_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','pending','accepted','uncertain','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER,
 started_at INTEGER,
 detail TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX teammate_teams_deliveries_user ON teammate_teams_deliveries(project_id,user_id,created_at);
CREATE INDEX teammate_teams_deliveries_open ON teammate_teams_deliveries(state,next_attempt_at) WHERE state IN ('sending','pending');
