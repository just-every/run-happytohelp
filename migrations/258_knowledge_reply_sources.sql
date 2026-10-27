-- Durable, server-held compose provenance. No reply door may drop this fence.
-- No text, address, bearer capability or member reference is stored here.
CREATE TABLE knowledge_reply_sources (
 project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 source_id TEXT NOT NULL,
 source_version TEXT NOT NULL,
 PRIMARY KEY(project_id,conversation_id,source_id,source_version)
);
