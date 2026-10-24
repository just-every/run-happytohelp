-- Route authority survives a failed observation. Retry reads independently of
-- inbound/outbound activity and keep the last successful check visible.
ALTER TABLE rer_mailboxes ADD COLUMN route_checked_at INTEGER;
ALTER TABLE rer_mailboxes ADD COLUMN route_check_next_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rer_mailboxes ADD COLUMN route_check_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rer_mailboxes ADD COLUMN route_check_error TEXT;
