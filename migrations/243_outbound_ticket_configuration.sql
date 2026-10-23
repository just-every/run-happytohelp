-- Operator-created tickets retain a selected form independently of customer submissions.
ALTER TABLE conversations ADD COLUMN request_form_id TEXT;
ALTER TABLE operator_ticket_commands ADD COLUMN service_notice_id TEXT;
CREATE TABLE operator_service_notices (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 actor_id TEXT NOT NULL REFERENCES users(id),
 local_id TEXT NOT NULL,
 intent_hash TEXT NOT NULL,
 plan_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 UNIQUE(project_id,actor_id,local_id)
);
-- A preview contains requester destinations. Erasure removes it and cannot recreate its id.
CREATE TRIGGER service_notice_erasure AFTER UPDATE OF metadata_json ON contacts
WHEN coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=1 OR coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=1
BEGIN
 DELETE FROM operator_service_notices WHERE project_id=NEW.project_id AND EXISTS(SELECT 1 FROM json_each(plan_json,'$.recipients') recipient WHERE json_extract(recipient.value,'$.id')=NEW.id);
END;
