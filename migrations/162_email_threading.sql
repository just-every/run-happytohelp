-- Inert identifiers: all matches are candidate evidence, never sender authority.
CREATE TABLE email_threading_keys(
 project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 key_kind TEXT NOT NULL CHECK(key_kind IN ('message_id','subject_token','reply_address','vendor_header')),
 key_value TEXT NOT NULL,
 source TEXT NOT NULL,
 source_ref TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,conversation_id,key_kind,key_value)
);
CREATE INDEX email_threading_lookup ON email_threading_keys(project_id,key_kind,key_value,conversation_id);
-- Immutable sending options are staged before message admission and its outbox.
-- Join to messages by project/conversation/local_id; BCC is never customer data.
CREATE TABLE email_message_options(
 project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 local_id TEXT NOT NULL,
 mailbox_id TEXT REFERENCES mailbox_connections(id),
 agent_id TEXT NOT NULL REFERENCES users(id),
 from_address TEXT,
 to_address TEXT,
 cc_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(cc_json) AND json_type(cc_json)='array'),
 bcc_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(bcc_json) AND json_type(bcc_json)='array'),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,conversation_id,local_id)
);
CREATE TABLE operator_ticket_commands(
 project_id TEXT NOT NULL REFERENCES projects(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 local_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
 intent_hash TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('email','call')),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,actor_id,local_id)
);
CREATE TRIGGER email_threading_contact_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN COALESCE(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR COALESCE(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 DELETE FROM email_threading_keys WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 DELETE FROM email_message_options WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 UPDATE operator_ticket_commands SET local_id='erased:'||conversation_id,intent_hash=NULL WHERE project_id=NEW.project_id AND conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
END;
