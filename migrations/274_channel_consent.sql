-- Reply consent and WhatsApp continuation consent are separate authorities.
ALTER TABLE support_channel_threads ADD COLUMN reply_consent_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE support_channel_threads ADD COLUMN template_opted_out INTEGER NOT NULL DEFAULT 0;
UPDATE support_channel_threads SET template_opted_out=opted_out;
CREATE TABLE support_channel_consent (
 connection_id TEXT NOT NULL, event_id TEXT NOT NULL, identity_hash TEXT NOT NULL,
 contact_id TEXT NOT NULL, channel_id TEXT NOT NULL, kind TEXT NOT NULL, at INTEGER NOT NULL, received_at INTEGER NOT NULL,
 PRIMARY KEY(connection_id,event_id)
);
CREATE TRIGGER support_channel_consent_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 DELETE FROM support_channel_consent WHERE contact_id=NEW.id;
END;
-- A later START can authorize a fresh reply, never revive an earlier queued send.
CREATE TRIGGER support_channel_stop_queue AFTER UPDATE OF opted_out ON support_channel_threads
WHEN NEW.opted_out=1
BEGIN
 INSERT OR IGNORE INTO support_channel_sends
 SELECT m.id,m.project_id,m.conversation_id,NEW.connection_id,'blocked','customer_opted_out',NULL,m.created_at,unixepoch()*1000 FROM messages m WHERE m.conversation_id=NEW.conversation_id AND m.actor_role NOT IN ('contact','system');
 UPDATE workflow_schedules SET state='cancelled',reason='Customer opted out; compose a new reply only after fresh consent',updated_at=unixepoch()*1000,version=version+1 WHERE conversation_id=NEW.conversation_id AND kind='reply' AND state='pending';
END;
CREATE TRIGGER support_channel_opted_out_message AFTER INSERT ON messages
WHEN NEW.actor_role NOT IN ('contact','system')
BEGIN
 INSERT OR IGNORE INTO support_channel_sends SELECT NEW.id,NEW.project_id,NEW.conversation_id,t.connection_id,'blocked','customer_opted_out',NULL,NEW.created_at,NEW.created_at FROM support_channel_threads t WHERE t.conversation_id=NEW.conversation_id AND t.opted_out=1;
END;
CREATE TRIGGER support_channel_opted_out_schedule AFTER INSERT ON workflow_schedules
WHEN NEW.kind='reply' AND EXISTS(SELECT 1 FROM support_channel_threads WHERE conversation_id=NEW.conversation_id AND opted_out=1)
BEGIN
 UPDATE workflow_schedules SET state='cancelled',reason='Customer opted out; human review required',version=version+1 WHERE id=NEW.id;
END;
