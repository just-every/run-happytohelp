-- Explicit opt-in destination; existing alerts never acquire a new outbound effect.
ALTER TABLE sla_policies ADD COLUMN slack_destination_id TEXT;
ALTER TABLE sla_alerts ADD COLUMN slack_destination_id TEXT;
ALTER TABLE sla_alerts ADD COLUMN slack_state TEXT NOT NULL DEFAULT 'not_configured';
ALTER TABLE sla_alerts ADD COLUMN slack_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sla_alerts ADD COLUMN slack_started_at INTEGER;
ALTER TABLE sla_alerts ADD COLUMN slack_next_attempt_at INTEGER;
ALTER TABLE sla_alerts ADD COLUMN slack_error TEXT;
CREATE INDEX sla_slack_due ON sla_alerts(slack_state,slack_next_attempt_at);
