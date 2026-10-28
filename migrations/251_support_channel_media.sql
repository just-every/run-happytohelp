-- Additive channel custody and explicit, customer-originated continuation consent.
ALTER TABLE support_channel_threads ADD COLUMN template_consent INTEGER NOT NULL DEFAULT 0;
CREATE TABLE support_channel_attachment_grants (
 token_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL, connection_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL, message_id TEXT NOT NULL, media_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TRIGGER support_channel_media_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 DELETE FROM support_channel_attachment_grants WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
END;
