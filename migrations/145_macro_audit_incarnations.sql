-- Undo keeps the audit trail while an import can recreate the same macro id.
-- Audit events identify an occurrence, rather than one incarnation's version.
DROP TRIGGER macro_version_audit;
CREATE TRIGGER macro_version_audit AFTER INSERT ON macro_versions BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('macro-version:'||lower(hex(randomblob(16))),NEW.project_id,NEW.created_at,'data','macro.version_saved','succeeded','user',NEW.created_by,'dashboard','macro',NEW.macro_id,json_object('version',NEW.version));
END;
DROP TRIGGER macro_archive_audit;
CREATE TRIGGER macro_archive_audit AFTER UPDATE OF archived_at ON macro_heads WHEN OLD.archived_at IS NULL AND NEW.archived_at IS NOT NULL BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'macro-archive:'||lower(hex(randomblob(16))),m.project_id,NEW.archived_at,'data','macro.archived','succeeded',CASE WHEN NEW.archived_by IS NULL THEN 'system' ELSE 'user' END,NEW.archived_by,'dashboard','macro',m.id,json_object('version',NEW.version) FROM macros m JOIN macro_versions v ON v.macro_id=m.id AND v.version=NEW.version WHERE m.id=NEW.macro_id;
END;
