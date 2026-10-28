-- Consent binds the current connection revision, never a later channel or credential.
-- Existing policies and alerts acquire no new outbound effect.
ALTER TABLE sla_policies ADD COLUMN teams_connection_id TEXT;
ALTER TABLE sla_policies ADD COLUMN teams_connection_version INTEGER;
ALTER TABLE sla_alerts ADD COLUMN teams_connection_id TEXT;
ALTER TABLE sla_alerts ADD COLUMN teams_connection_version INTEGER;
ALTER TABLE sla_alerts ADD COLUMN teams_state TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE sla_alerts ADD COLUMN teams_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sla_alerts ADD COLUMN teams_started_at INTEGER;
ALTER TABLE sla_alerts ADD COLUMN teams_next_attempt_at INTEGER;
ALTER TABLE sla_alerts ADD COLUMN teams_error TEXT;
CREATE INDEX sla_teams_due ON sla_alerts(teams_state,teams_next_attempt_at);
