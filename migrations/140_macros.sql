-- Existing saved replies become versioned macros without changing their insertion behavior.
CREATE TABLE macro_heads(macro_id TEXT PRIMARY KEY REFERENCES macros(id) ON DELETE CASCADE,version INTEGER NOT NULL DEFAULT 1,archived_at INTEGER);
INSERT INTO macro_heads(macro_id) SELECT id FROM macros;
CREATE TABLE macro_versions(
 macro_id TEXT NOT NULL REFERENCES macros(id) ON DELETE CASCADE,project_id TEXT NOT NULL REFERENCES projects(id),version INTEGER NOT NULL,
 title TEXT NOT NULL,content TEXT NOT NULL,actions_json TEXT NOT NULL DEFAULT '{}',scope_json TEXT NOT NULL DEFAULT '{"visibility":"shared","roles":[],"groups":[],"brands":[]}',
 created_by TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(macro_id,version)
);
INSERT INTO macro_versions(macro_id,project_id,version,title,content,created_by,created_at) SELECT id,project_id,1,title,content,created_by,updated_at FROM macros;
CREATE TRIGGER macro_saved_reply_insert AFTER INSERT ON macros BEGIN
 INSERT INTO macro_heads(macro_id) VALUES(NEW.id);
 INSERT INTO macro_versions(macro_id,project_id,version,title,content,created_by,created_at) VALUES(NEW.id,NEW.project_id,1,NEW.title,NEW.content,NEW.created_by,NEW.updated_at);
END;
CREATE TABLE macro_usage(
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL,macro_id TEXT NOT NULL,version INTEGER NOT NULL,conversation_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,command_id TEXT NOT NULL,created_at INTEGER NOT NULL,
 UNIQUE(project_id,actor_id,command_id,conversation_id)
);
CREATE INDEX macro_usage_reporting ON macro_usage(project_id,macro_id,version,created_at);
CREATE TABLE macro_drafts(
 project_id TEXT NOT NULL,conversation_id TEXT NOT NULL,actor_id TEXT NOT NULL,usage_id TEXT NOT NULL REFERENCES macro_usage(id),
 content TEXT NOT NULL,reply_type TEXT NOT NULL CHECK(reply_type IN ('public','note')),unresolved_json TEXT NOT NULL,media_ids_json TEXT NOT NULL,
 updated_at INTEGER NOT NULL,PRIMARY KEY(project_id,conversation_id,actor_id)
);
-- Provenance follows copied attachment bytes even into another requester's draft.
CREATE TABLE macro_attachment_copies(
 media_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,source_media_id TEXT NOT NULL,source_contact_id TEXT NOT NULL
);
