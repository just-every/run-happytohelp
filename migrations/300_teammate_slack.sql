-- NOTIFY-001 personal Slack notices. New tables only: no existing table, trigger or
-- migration changes. Consent, links and preferences leave with their membership;
-- delivery outcomes leave with their inbox notice, so member and contact erasure
-- remove them. None of these tables travels in an export.
CREATE TABLE teammate_slack_consent(
 project_id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 destination_id TEXT NOT NULL,
 enabled_at INTEGER NOT NULL,
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE teammate_slack_links(
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 destination_id TEXT NOT NULL,
 slack_team_id TEXT NOT NULL,
 slack_user_id TEXT NOT NULL,
 dm_channel TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','verified')),
 code_hash TEXT,
 code_expires_at INTEGER,
 code_attempts INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 verified_at INTEGER,
 PRIMARY KEY(project_id,user_id),
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX teammate_slack_links_identity ON teammate_slack_links(project_id,slack_team_id,slack_user_id) WHERE state='verified';
CREATE TABLE teammate_slack_preferences(
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('assignment','group','follower','mention','customer_updated')),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 enabled_at INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(project_id,user_id,kind),
 FOREIGN KEY(project_id,user_id) REFERENCES memberships(project_id,user_id) ON DELETE CASCADE
);
CREATE TABLE teammate_slack_deliveries(
 notice_id TEXT PRIMARY KEY REFERENCES notification_inbox(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 kind TEXT NOT NULL,
 destination_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','pending','accepted','uncertain','failed','cancelled')),
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER,
 started_at INTEGER,
 detail TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX teammate_slack_deliveries_user ON teammate_slack_deliveries(project_id,user_id,created_at);
CREATE INDEX teammate_slack_deliveries_open ON teammate_slack_deliveries(state,next_attempt_at) WHERE state IN ('sending','pending');
