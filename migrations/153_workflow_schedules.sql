CREATE TABLE workflow_schedules(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,kind TEXT NOT NULL CHECK(kind IN ('snooze','reply')),due_at INTEGER,timezone TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',owner_id TEXT NOT NULL,sender_id TEXT NOT NULL,sender_role TEXT NOT NULL,sender_role_key TEXT,sender_role_updated_at INTEGER,dependency_id TEXT REFERENCES conversations(id),expected_revision INTEGER NOT NULL,expected_last_message_id TEXT,expected_assignee TEXT,state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','woken','cancelled','failed','uncertain')),reason TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,attempted_at INTEGER,message_id TEXT,version INTEGER NOT NULL DEFAULT 1);
CREATE INDEX workflow_schedules_due ON workflow_schedules(state,due_at);
CREATE INDEX workflow_schedules_ticket ON workflow_schedules(project_id,conversation_id,state);
-- A customer reply wakes snoozes immediately and cancels unsent replies. A
-- reassignment fences the old sender, even before the next cron invocation.
CREATE TRIGGER workflow_schedule_cancel AFTER UPDATE OF revision,assigned_to ON conversations WHEN NEW.assigned_to IS NOT OLD.assigned_to OR NEW.revision<>OLD.revision AND (SELECT actor_role FROM messages WHERE id=NEW.last_message_id)='contact' BEGIN
 UPDATE workflow_schedules SET state=CASE WHEN kind='snooze' AND NEW.revision<>OLD.revision THEN 'woken' ELSE 'cancelled' END,reason=CASE WHEN NEW.assigned_to IS NOT OLD.assigned_to THEN 'Ticket reassigned' ELSE 'Customer replied' END,updated_at=NEW.updated_at,version=version+1 WHERE conversation_id=NEW.id AND state='pending';
END;
CREATE TRIGGER workflow_schedule_audit_insert AFTER INSERT ON workflow_schedules BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES('schedule-created:'||NEW.id,NEW.project_id,NEW.created_at,'data','workflow.schedule.created','succeeded','user',NEW.sender_id,'dashboard','conversation',NEW.conversation_id,json_object('schedule_id',NEW.id,'kind',NEW.kind));
END;
CREATE TRIGGER workflow_schedule_audit_state AFTER UPDATE OF state ON workflow_schedules WHEN OLD.state<>NEW.state BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.updated_at,'data','workflow.schedule.'||NEW.state,CASE WHEN NEW.state IN ('failed','uncertain') THEN 'failed' ELSE 'succeeded' END,'system',NEW.sender_id,'system','conversation',NEW.conversation_id,json_object('schedule_id',NEW.id,'kind',NEW.kind));
END;

CREATE TRIGGER workflow_schedule_audit_edit AFTER UPDATE OF due_at,timezone,body,owner_id,dependency_id ON workflow_schedules WHEN NEW.due_at IS NOT OLD.due_at OR NEW.timezone<>OLD.timezone OR NEW.body<>OLD.body OR NEW.owner_id<>OLD.owner_id OR NEW.dependency_id IS NOT OLD.dependency_id BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json) VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.updated_at,'data','workflow.schedule.edited','succeeded','user',NEW.sender_id,'dashboard','conversation',NEW.conversation_id,json_object('schedule_id',NEW.id));
END;
