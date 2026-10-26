-- Bound native ticket admission, authenticated mailbox proof and API hold lookup.
-- Indexes only: no stored row changes. Apply before the updated Worker serves traffic.
CREATE INDEX inbound_emails_conversation ON inbound_emails(project_id,conversation_id);
CREATE INDEX inbound_emails_message ON inbound_emails(project_id,message_id);
CREATE INDEX api_requests_hold ON api_requests(project_id,held_id);
