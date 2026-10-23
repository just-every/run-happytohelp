-- NULL preserves an administrator's existing deployed help-host mapping.
-- Empty text explicitly selects built-in paths; a hostname selects one approved host.
ALTER TABLE knowledge_experience ADD COLUMN published_host TEXT;
ALTER TABLE knowledge_experience ADD COLUMN link_color TEXT NOT NULL DEFAULT '';
