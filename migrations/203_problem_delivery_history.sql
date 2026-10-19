CREATE TRIGGER ticket_problem_attempt_history AFTER UPDATE OF state ON ticket_problem_attempts WHEN OLD.state<>NEW.state AND NEW.state<>'erased' BEGIN
 INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json)
 SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.incident_id,p.actor_id,'user','dashboard',NEW.updated_at,json_object('problem_delivery',json_object('problem_id',NEW.problem_id,'preview_id',NEW.preview_id,'from',OLD.state,'to',NEW.state,'reason',NEW.reason)) FROM ticket_problem_previews p WHERE p.id=NEW.preview_id;
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.updated_at,'data','ticket.problem_delivery',CASE WHEN NEW.state IN ('failed','uncertain','blocked') THEN 'failed' ELSE 'succeeded' END,'system',NULL,'system','conversation',NEW.incident_id,json_object('problem_id',NEW.problem_id,'preview_id',NEW.preview_id,'state',NEW.state));
END;
