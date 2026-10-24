-- A causal receipt, committed in the same batch as a successful model-requested
-- assignment. Historical generic assignments are deliberately not backfilled.
-- No prompt, customer text, credential or replay authority is retained here.
CREATE TABLE ai_handoff_receipts(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 generation_id TEXT NOT NULL UNIQUE,
 agent_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX ai_handoff_receipts_conversation ON ai_handoff_receipts(project_id,conversation_id);
