-- Cursor progress does not change which connections the scheduled poll considers.
DROP INDEX IF EXISTS mailbox_connections_live_poll;
CREATE INDEX mailbox_connections_live_poll
 ON mailbox_connections(id) WHERE status='connected' AND provider<>'forwarding';

-- Only message notification receipts are recovered by the mail maintenance task.
DROP INDEX IF EXISTS email_deliveries_sending_notifications;
CREATE INDEX email_deliveries_sending_notifications
 ON email_deliveries(updated_at)
 WHERE state='sending' AND (+id GLOB 'message:*:notification' OR +id GLOB 'message:*:notification:*');

-- Keep terminal alerts out of the minute-by-minute notification recovery index.
DROP INDEX IF EXISTS sla_alerts_notification_recovery;
CREATE INDEX sla_alerts_notification_recovery
 ON sla_alerts(notification_state,notification_started_at,notification_next_attempt_at)
 WHERE notification_state='pending' OR notification_state='sending';

-- Migration 161 already indexes suspended_emails(expires_at).
DROP INDEX IF EXISTS suspended_emails_expiry;
