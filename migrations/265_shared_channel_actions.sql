-- Authenticated shared-channel identities remain separate from unverified email identities.
ALTER TABLE support_channel_threads ADD COLUMN service_url TEXT;
ALTER TABLE support_channel_threads ADD COLUMN provider_conversation TEXT;
CREATE TABLE support_channel_members (
 connection_id TEXT NOT NULL, provider_user TEXT NOT NULL, project_id TEXT NOT NULL,
 user_id TEXT NOT NULL, linked_at INTEGER NOT NULL, PRIMARY KEY(connection_id,provider_user),
 UNIQUE(connection_id,user_id)
);
CREATE TABLE support_channel_link_codes (
 token_hash TEXT PRIMARY KEY, connection_id TEXT NOT NULL, project_id TEXT NOT NULL,
 user_id TEXT NOT NULL, session_hash TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE support_channel_accounts (
 connection_id TEXT NOT NULL, project_id TEXT NOT NULL, channel_id TEXT NOT NULL,
 company_id TEXT NOT NULL, PRIMARY KEY(connection_id,channel_id)
);
CREATE TABLE support_channel_actions (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL, state TEXT NOT NULL, provider_id TEXT, created_at INTEGER NOT NULL
);
ALTER TABLE support_channel_events ADD COLUMN provider_message_id TEXT;
ALTER TABLE support_channel_events ADD COLUMN sender_hash TEXT;
ALTER TABLE support_channel_events ADD COLUMN edited_at INTEGER;
CREATE TRIGGER support_channel_shared_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 UPDATE support_channel_events SET provider_message_id=NULL,sender_hash=NULL,edited_at=NULL WHERE message_id IN (SELECT id FROM messages WHERE project_id=NEW.project_id AND actor_id=NEW.id);
 UPDATE support_channel_actions SET provider_id=NULL WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
END;
CREATE TABLE support_channel_changes (
 connection_id TEXT NOT NULL, event_hash TEXT NOT NULL, message_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL, kind TEXT NOT NULL, content TEXT NOT NULL, at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,event_hash)
);
CREATE TRIGGER support_channel_changes_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 DELETE FROM support_channel_changes WHERE message_id IN (SELECT id FROM messages WHERE project_id=NEW.project_id AND (actor_id=NEW.id OR conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id)));
END;
CREATE TABLE support_channel_installations (
 connection_id TEXT PRIMARY KEY, config_json TEXT NOT NULL, verified_at INTEGER NOT NULL
);
CREATE TRIGGER support_channel_participant_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 INSERT OR IGNORE INTO support_channel_fences SELECT e.connection_id,e.sender_hash FROM support_channel_events e JOIN messages m ON m.id=e.message_id WHERE m.project_id=NEW.project_id AND m.actor_id=NEW.id AND e.sender_hash IS NOT NULL;
 UPDATE support_channel_events SET provider_message_id=NULL,sender_hash=NULL WHERE message_id IN (SELECT id FROM messages WHERE project_id=NEW.project_id AND actor_id=NEW.id);
END;
