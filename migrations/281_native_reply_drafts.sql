-- Keep the existing per-person composer slot and every macro-owned draft.
-- Direct reply drafts use an opaque version instead of inventing a macro use.
CREATE TABLE native_reply_draft_upgrade(
 project_id TEXT NOT NULL,conversation_id TEXT NOT NULL,actor_id TEXT NOT NULL,
 usage_id TEXT REFERENCES macro_usage(id),draft_id TEXT,
 content TEXT NOT NULL,reply_type TEXT NOT NULL CHECK(reply_type IN ('public','note')),
 unresolved_json TEXT NOT NULL,media_ids_json TEXT NOT NULL,updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,conversation_id,actor_id),
 CHECK((usage_id IS NOT NULL AND draft_id IS NULL) OR (usage_id IS NULL AND draft_id IS NOT NULL))
);
INSERT INTO native_reply_draft_upgrade(project_id,conversation_id,actor_id,usage_id,content,reply_type,unresolved_json,media_ids_json,updated_at)
 SELECT project_id,conversation_id,actor_id,usage_id,content,reply_type,unresolved_json,media_ids_json,updated_at FROM macro_drafts;
DROP TABLE macro_drafts;
ALTER TABLE native_reply_draft_upgrade RENAME TO macro_drafts;
