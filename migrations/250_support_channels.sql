-- Support intake is separate from notification-only integrations.
CREATE TABLE support_channel_connections (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), provider TEXT NOT NULL,
 account TEXT NOT NULL, sender TEXT NOT NULL, channels_json TEXT NOT NULL DEFAULT '[]',
 token_cipher TEXT, signing_cipher TEXT, verify_hash TEXT NOT NULL,
 registered INTEGER NOT NULL DEFAULT 0, revoked_at INTEGER, created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX support_channel_account ON support_channel_connections(provider,account,sender) WHERE revoked_at IS NULL;
CREATE TABLE support_channel_threads (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT NOT NULL REFERENCES support_channel_connections(id),
 contact_id TEXT NOT NULL, conversation_id TEXT NOT NULL, identity_hash TEXT NOT NULL,
 recipient TEXT NOT NULL, channel_id TEXT NOT NULL, thread_key TEXT NOT NULL,
 last_inbound_at INTEGER NOT NULL, opted_out INTEGER NOT NULL DEFAULT 0,
 UNIQUE(connection_id,channel_id,thread_key)
);
CREATE INDEX support_channel_conversation ON support_channel_threads(project_id,conversation_id);
CREATE TABLE support_channel_events (
 connection_id TEXT NOT NULL, event_hash TEXT NOT NULL, thread_id TEXT, message_id TEXT,
 created_at INTEGER NOT NULL, PRIMARY KEY(connection_id,event_hash)
);
CREATE TABLE support_channel_sends (
 message_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
 connection_id TEXT NOT NULL, state TEXT NOT NULL, error_code TEXT, provider_id TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE support_channel_fences (
 connection_id TEXT NOT NULL, identity_hash TEXT NOT NULL, PRIMARY KEY(connection_id,identity_hash)
);
-- Fence before canonical erasure. No provider credential or raw webhook body is kept in a receipt.
CREATE TRIGGER support_channel_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 INSERT OR IGNORE INTO erasure_requests(id,project_id,contact_id,store,destination_id,state,detail,requested_at,settled_at)
 SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.id,'support-channel:'||c.provider,'','unsupported','Provider retains messages or media. Request deletion with the connected provider; local erasure cannot recall external copies.',unixepoch()*1000,unixepoch()*1000 FROM support_channel_threads t JOIN support_channel_connections c ON c.id=t.connection_id WHERE t.project_id=NEW.project_id AND t.contact_id=NEW.id GROUP BY c.provider;
 INSERT OR IGNORE INTO support_channel_fences SELECT connection_id,identity_hash FROM support_channel_threads WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 UPDATE support_channel_events SET thread_id=NULL,message_id=NULL WHERE thread_id IN (SELECT id FROM support_channel_threads WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 UPDATE support_channel_sends SET provider_id=NULL,state=CASE WHEN state='sending' THEN 'uncertain' ELSE state END,error_code='contact_erased' WHERE project_id=NEW.project_id AND conversation_id IN (SELECT conversation_id FROM support_channel_threads WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 DELETE FROM support_channel_threads WHERE project_id=NEW.project_id AND contact_id=NEW.id;
END;
