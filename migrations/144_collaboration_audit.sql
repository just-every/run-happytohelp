-- Record R4 business operations without retaining reply text, addresses or file names.
ALTER TABLE macro_heads ADD COLUMN archived_by TEXT;
CREATE TRIGGER macro_version_audit AFTER INSERT ON macro_versions BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('macro-version:'||NEW.macro_id||':'||NEW.version,NEW.project_id,NEW.created_at,'data','macro.version_saved','succeeded','user',NEW.created_by,'dashboard','macro',NEW.macro_id,json_object('version',NEW.version));
END;
CREATE TRIGGER macro_archive_audit AFTER UPDATE OF archived_at ON macro_heads WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'macro-archive:'||NEW.macro_id,m.project_id,NEW.archived_at,'data','macro.archived','succeeded',CASE WHEN NEW.archived_by IS NULL THEN 'system' ELSE 'user' END,NEW.archived_by,'dashboard','macro',m.id,json_object('version',NEW.version) FROM macros m JOIN macro_versions v ON v.macro_id=m.id AND v.version=NEW.version WHERE m.id=NEW.macro_id;
END;
CREATE TRIGGER macro_apply_audit AFTER INSERT ON macro_usage BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('macro-apply:'||NEW.id,NEW.project_id,NEW.created_at,'data','macro.applied','succeeded','user',NEW.actor_id,'dashboard','conversation',NEW.conversation_id,json_object('macro_id',NEW.macro_id,'version',NEW.version,'usage_id',NEW.id));
END;
CREATE TRIGGER notification_claim_audit AFTER INSERT ON notification_trigger_claims BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('notice-claim:'||NEW.id,NEW.project_id,NEW.created_at,'data','notifications.event_claimed','succeeded','system',NULL,'system','conversation',NEW.conversation_id,json_object('event',NEW.event,'state',NEW.state));
END;
CREATE TRIGGER notification_outcome_audit AFTER UPDATE OF state ON notification_trigger_claims WHEN NEW.state<>OLD.state BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('notice-outcome:'||lower(hex(randomblob(16))),NEW.project_id,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),'data','notifications.delivery_outcome',CASE WHEN NEW.state IN ('failed','uncertain') THEN 'failed' ELSE 'succeeded' END,'system',NULL,'system','conversation',NEW.conversation_id,json_object('event',NEW.event,'from',OLD.state,'state',NEW.state));
END;
CREATE TRIGGER notification_inbox_audit AFTER INSERT ON notification_inbox BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('notice-inbox:'||NEW.id,NEW.project_id,NEW.created_at,'data','notifications.teammate_created','succeeded','system',NULL,'system','conversation',NEW.conversation_id,json_object('kind',NEW.kind,'user_id',NEW.user_id,'inbox',NEW.inbox,'email',NEW.email));
END;
