-- Forward-only rebuild preserving rows, keys and erasure behavior.
DROP TRIGGER email_threading_contact_erasure;
CREATE TABLE operator_ticket_commands_next(
 project_id TEXT NOT NULL REFERENCES projects(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 local_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
 intent_hash TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('email','call','sms','whatsapp')),
 created_at INTEGER NOT NULL,
 support_thread_id TEXT REFERENCES support_channel_threads(id) ON DELETE SET NULL,
 PRIMARY KEY(project_id,actor_id,local_id)
);
INSERT INTO operator_ticket_commands_next(project_id,actor_id,local_id,conversation_id,intent_hash,kind,created_at) SELECT project_id,actor_id,local_id,conversation_id,intent_hash,kind,created_at FROM operator_ticket_commands;
DROP TABLE operator_ticket_commands;
ALTER TABLE operator_ticket_commands_next RENAME TO operator_ticket_commands;
CREATE TRIGGER email_threading_contact_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN COALESCE(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR COALESCE(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 DELETE FROM email_threading_keys WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 DELETE FROM email_message_options WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 UPDATE operator_ticket_commands SET local_id='erased:'||conversation_id,intent_hash=NULL WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
END;
-- Erasure clears provider identifiers for every ticket linked to the shared thread.
CREATE TRIGGER outbound_channel_thread_erasure BEFORE DELETE ON support_channel_threads
BEGIN
 UPDATE support_channel_sends SET provider_id=NULL,state=CASE WHEN state='sending' THEN 'uncertain' ELSE state END,error_code='contact_erased' WHERE project_id=OLD.project_id AND conversation_id IN (SELECT conversation_id FROM operator_ticket_commands WHERE support_thread_id=OLD.id);
END;
