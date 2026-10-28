-- Commitments are proposals until a teammate accepts them. Quotes remain in the
-- original message; erasure never leaves a second copy of customer content here.
CREATE TABLE followup_obligations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
 quote_start INTEGER NOT NULL, quote_end INTEGER NOT NULL,
 owner_id TEXT NOT NULL, due_at INTEGER NOT NULL, stop_condition TEXT NOT NULL,
 dependency_id TEXT REFERENCES escalation_issues(id),
 state TEXT NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','open','completed','cancelled')),
 version INTEGER NOT NULL DEFAULT 1, accepted_by TEXT, accepted_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX followup_due ON followup_obligations(state,due_at);
CREATE TABLE followup_changes (
 id TEXT PRIMARY KEY, obligation_id TEXT NOT NULL REFERENCES followup_obligations(id) ON DELETE CASCADE,
 version INTEGER NOT NULL, owner_id TEXT NOT NULL, due_at INTEGER NOT NULL,
 accepted_by TEXT NOT NULL, accepted_at INTEGER NOT NULL, UNIQUE(obligation_id,version)
);
CREATE TRIGGER followup_contact_erasure AFTER UPDATE OF metadata_json ON contacts
 WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
 BEGIN DELETE FROM followup_obligations WHERE conversation_id IN (SELECT id FROM conversations WHERE contact_id=NEW.id AND project_id=NEW.project_id); END;
