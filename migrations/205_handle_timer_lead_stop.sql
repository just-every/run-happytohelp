-- Who ended a running handle timer. A member's own stop records the member; a lead (owner or admin)
-- stopping a teammate's named session is recorded as the lead's stop in ticket history (and so in its
-- ticket.updated audit row) with reason 'lead', plus an audit event naming lead, member, ticket and session.
-- Solving a ticket and losing ticket access (removal, role change) leave ended_by NULL, as before.
ALTER TABLE ticket_handle_sessions ADD COLUMN ended_by TEXT REFERENCES users(id);
DROP TRIGGER ticket_handle_stop_history;
CREATE TRIGGER ticket_handle_stop_history AFTER UPDATE OF ended_at ON ticket_handle_sessions WHEN OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL BEGIN
 INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json)
 SELECT 'timer:stop:'||NEW.id,NEW.project_id,NEW.conversation_id,
 CASE WHEN c.status_category IN ('solved','closed') THEN c.ticket_actor_id ELSE coalesce(NEW.ended_by,NEW.user_id) END,
 CASE WHEN c.status_category IN ('solved','closed') THEN c.ticket_actor_type ELSE 'user' END,
 CASE WHEN c.status_category IN ('solved','closed') THEN c.ticket_source ELSE 'dashboard' END,
 NEW.ended_at,json_object('handle_timer',json_object('session_id',NEW.id,'user_id',NEW.user_id,'started_at',NEW.started_at,'ended_at',NEW.ended_at,'reason',CASE WHEN c.status_category IN ('solved','closed') THEN 'solved' WHEN NEW.ended_by IS NOT NULL AND NEW.ended_by<>NEW.user_id THEN 'lead' ELSE 'operator' END))
 FROM conversations c WHERE c.id=NEW.conversation_id AND c.project_id=NEW.project_id;
END;
CREATE TRIGGER ticket_handle_lead_stop_audit AFTER UPDATE OF ended_at ON ticket_handle_sessions WHEN OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND NEW.ended_by IS NOT NULL AND NEW.ended_by<>NEW.user_id BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('timer-lead-stop:'||NEW.id,NEW.project_id,NEW.ended_at,'data','ticket.handle_timer.lead_stopped','succeeded','user',NEW.ended_by,'dashboard','conversation',NEW.conversation_id,json_object('session_id',NEW.id,'member_id',NEW.user_id));
END;
