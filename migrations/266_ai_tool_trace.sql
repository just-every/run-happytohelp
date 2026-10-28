-- Allowlisted metadata only. Arguments, output text and provider errors stay out.
CREATE TABLE ai_tool_traces(id TEXT PRIMARY KEY,generation_id TEXT NOT NULL REFERENCES ai_generations(id) ON DELETE CASCADE,tool_name TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('started','completed','denied','failed','handoff')),started_at INTEGER NOT NULL,finished_at INTEGER,approval TEXT NOT NULL,authority_scope TEXT NOT NULL,error_category TEXT,responsible_user_id TEXT);
CREATE INDEX ai_tool_traces_generation ON ai_tool_traces(generation_id,started_at,id);
