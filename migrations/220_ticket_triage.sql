CREATE TABLE triage_settings(project_id TEXT PRIMARY KEY REFERENCES projects(id),enabled INTEGER NOT NULL DEFAULT 0,threshold REAL NOT NULL DEFAULT 0.8,default_group_id TEXT,routing_enabled INTEGER NOT NULL DEFAULT 0,taxonomy_json TEXT NOT NULL,version INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE TABLE triage_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),message_id TEXT NOT NULL UNIQUE,source_revision INTEGER NOT NULL,settings_version INTEGER NOT NULL,state TEXT NOT NULL DEFAULT 'pending',reason TEXT,model TEXT,predictions_json TEXT,usage_json TEXT,provider_started INTEGER NOT NULL DEFAULT 0,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX triage_pending ON triage_jobs(state,created_at);
CREATE INDEX triage_ticket ON triage_jobs(project_id,conversation_id,source_revision);
CREATE TABLE triage_labels(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),job_id TEXT NOT NULL REFERENCES triage_jobs(id),field TEXT NOT NULL,value TEXT NOT NULL,prediction_json TEXT,actor_id TEXT NOT NULL,at INTEGER NOT NULL);
CREATE INDEX triage_label_ticket ON triage_labels(project_id,conversation_id,at);
CREATE TABLE triage_usage(job_id TEXT NOT NULL REFERENCES triage_jobs(id),request_id TEXT NOT NULL,usage_json TEXT,PRIMARY KEY(job_id,request_id));
-- The message journal is written atomically by every native admission door.
-- Historical imports never enter this journal. No model work runs in admission.
CREATE TRIGGER triage_admission AFTER INSERT ON workflow_events WHEN NEW.kind IN ('created','customer_reply') AND EXISTS(SELECT 1 FROM triage_settings s WHERE s.project_id=NEW.project_id AND s.enabled=1) AND EXISTS(SELECT 1 FROM messages m WHERE m.id=NEW.last_message_id AND m.actor_role='contact' AND m.erased_at IS NULL) BEGIN
 INSERT OR IGNORE INTO triage_jobs(id,project_id,conversation_id,message_id,source_revision,settings_version,created_at,updated_at) SELECT 'triage:'||NEW.last_message_id,NEW.project_id,NEW.conversation_id,NEW.last_message_id,NEW.revision,s.version,NEW.at,NEW.at FROM triage_settings s WHERE s.project_id=NEW.project_id;
END;
-- Clear the previous fields outside the workflow journal's INSERT trigger so
-- nested field-change events receive their own sequence IDs before admission.
CREATE TRIGGER triage_clear_fields AFTER UPDATE OF last_message_id ON conversations WHEN NEW.last_message_id IS NOT OLD.last_message_id AND EXISTS(SELECT 1 FROM triage_settings s WHERE s.project_id=NEW.project_id AND s.enabled=1) AND EXISTS(SELECT 1 FROM messages m WHERE m.id=NEW.last_message_id AND m.actor_role='contact' AND m.erased_at IS NULL) BEGIN
 DELETE FROM ticket_field_values WHERE project_id=NEW.project_id AND conversation_id=NEW.id AND field_id IN ('triage_intent','triage_sentiment','triage_language','triage_intent_confidence','triage_sentiment_confidence','triage_language_confidence','triage_intent_quote','triage_sentiment_quote','triage_language_quote');
END;
