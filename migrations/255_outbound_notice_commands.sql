-- Durable command fences are retained for the workspace lifetime, independently
-- of security-log retention. Only hashes and recovery IDs are retained here.
CREATE TABLE outbound_notice_commands(
 id TEXT NOT NULL,
 project_id TEXT NOT NULL REFERENCES projects(id),
 actor_id TEXT NOT NULL,
 intent_key TEXT,
 created_at INTEGER NOT NULL,
 outcome TEXT NOT NULL CHECK(outcome IN ('succeeded','refused')),
 detail_json TEXT NOT NULL,
 receipts_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY(project_id,id),
 UNIQUE(project_id,intent_key)
);
-- Upgrade retained r6 confirmations/refusals without changing send identities.
INSERT INTO outbound_notice_commands(id,project_id,actor_id,created_at,outcome,detail_json)
 SELECT id,project_id,actor_id,at,outcome,json_object('fingerprint',json_extract(detail_json,'$.fingerprint'),'error',CASE WHEN outcome='refused' THEN 'This notice was refused before any tickets were created' ELSE NULL END)
 FROM audit_events WHERE action IN ('ticket.notice_confirmed','ticket.notice_refused') AND target_type='notice_batch';
CREATE TRIGGER outbound_notice_command_identity BEFORE UPDATE OF id,project_id,actor_id,intent_key,created_at,outcome,detail_json ON outbound_notice_commands
BEGIN
 SELECT RAISE(ABORT,'notice_command_immutable');
END;
CREATE TRIGGER outbound_notice_command_audit AFTER INSERT ON outbound_notice_commands
BEGIN
 INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES(NEW.id,NEW.project_id,NEW.created_at,'data',CASE WHEN NEW.outcome='refused' THEN 'ticket.notice_refused' ELSE 'ticket.notice_confirmed' END,NEW.outcome,'user',NEW.actor_id,'dashboard','notice_batch',NEW.id,NEW.detail_json);
END;
