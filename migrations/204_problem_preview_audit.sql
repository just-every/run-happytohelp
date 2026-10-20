CREATE TRIGGER ticket_problem_preview_audit AFTER INSERT ON ticket_problem_previews BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('problem-preview:'||NEW.id,NEW.project_id,NEW.created_at,'data','ticket.problem_previewed','succeeded','user',NEW.actor_id,'dashboard','conversation',NEW.problem_id,json_object('preview_id',NEW.id,'incident_count',json_array_length(NEW.plan_json,'$.tickets')));
END;
CREATE TRIGGER ticket_problem_attempt_audit AFTER INSERT ON ticket_problem_attempts BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'problem-attempt:'||NEW.id,NEW.project_id,NEW.created_at,'data','ticket.problem_reply_claimed','succeeded','user',p.actor_id,'dashboard','conversation',NEW.incident_id,json_object('preview_id',NEW.preview_id,'problem_id',NEW.problem_id) FROM ticket_problem_previews p WHERE p.id=NEW.preview_id;
END;
