-- Team changes invalidate a queued reply just as operator changes do. Keep this
-- frontier in the admission transaction so reassignment after claim is fenced.
ALTER TABLE workflow_schedules ADD COLUMN expected_group_id TEXT;
UPDATE workflow_schedules SET expected_group_id=(SELECT group_id FROM conversations WHERE id=workflow_schedules.conversation_id) WHERE state IN ('pending','sending');
DROP TRIGGER workflow_schedule_cancel;
CREATE TRIGGER workflow_schedule_cancel AFTER UPDATE OF revision,assigned_to,group_id ON conversations WHEN NEW.assigned_to IS NOT OLD.assigned_to OR NEW.group_id IS NOT OLD.group_id OR NEW.revision<>OLD.revision AND (SELECT actor_role FROM messages WHERE id=NEW.last_message_id)='contact' BEGIN
 UPDATE workflow_schedules SET state=CASE WHEN kind='snooze' AND NEW.revision<>OLD.revision THEN 'woken' ELSE 'cancelled' END,reason=CASE WHEN NEW.assigned_to IS NOT OLD.assigned_to OR NEW.group_id IS NOT OLD.group_id THEN 'Ticket reassigned' ELSE 'Customer replied' END,updated_at=NEW.updated_at,version=version+1 WHERE conversation_id=NEW.id AND state='pending';
END;
