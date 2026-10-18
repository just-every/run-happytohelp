CREATE TABLE mailbox_message_attempts (
 mailbox_id TEXT NOT NULL REFERENCES mailbox_connections(id) ON DELETE CASCADE,
 provider_message_id TEXT NOT NULL,
 attempts INTEGER NOT NULL,
 reason TEXT NOT NULL,
 PRIMARY KEY(mailbox_id,provider_message_id)
);
