-- A date-indexed membership projection, not a snapshot of report figures. Empty
-- drafts never enter it. All evidence, permissions and dimensions remain live.
CREATE TABLE reporting_conversations(
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 status_category TEXT NOT NULL
);
CREATE INDEX reporting_conversations_created ON reporting_conversations(project_id,created_at,conversation_id);
CREATE INDEX reporting_conversations_active ON reporting_conversations(project_id,created_at,conversation_id) WHERE status_category NOT IN ('solved','closed');
CREATE INDEX reporting_brand_options ON conversations(project_id,brand_id);
INSERT INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT c.id,c.project_id,c.created_at,c.status_category FROM conversations c
 WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=c.project_id AND m.conversation_id=c.id);
CREATE TRIGGER reporting_message_insert AFTER INSERT ON messages BEGIN
 INSERT OR IGNORE INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT id,project_id,created_at,status_category FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id;
END;
CREATE TRIGGER reporting_message_delete AFTER DELETE ON messages BEGIN
 DELETE FROM reporting_conversations WHERE conversation_id=OLD.conversation_id
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.project_id=reporting_conversations.project_id AND m.conversation_id=reporting_conversations.conversation_id);
END;
CREATE TRIGGER reporting_message_move AFTER UPDATE OF conversation_id,project_id ON messages BEGIN
 DELETE FROM reporting_conversations WHERE conversation_id=OLD.conversation_id
 AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.project_id=reporting_conversations.project_id AND m.conversation_id=reporting_conversations.conversation_id);
 INSERT OR IGNORE INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT id,project_id,created_at,status_category FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id;
END;
CREATE TRIGGER reporting_conversation_update AFTER UPDATE OF project_id,created_at,status_category ON conversations BEGIN
 DELETE FROM reporting_conversations WHERE conversation_id=OLD.id;
 INSERT INTO reporting_conversations(conversation_id,project_id,created_at,status_category)
 SELECT NEW.id,NEW.project_id,NEW.created_at,NEW.status_category
 WHERE EXISTS(SELECT 1 FROM messages m WHERE m.project_id=NEW.project_id AND m.conversation_id=NEW.id);
END;
