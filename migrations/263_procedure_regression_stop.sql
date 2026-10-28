-- A bounded advice rollout uses a conservative zero-reopening regression gate.
-- The native resolution cycle, not a provider success or an attempted answer,
-- stops its exact released procedure and restores human responsibility.
ALTER TABLE procedure_releases ADD COLUMN regression_resolution_id TEXT REFERENCES conversation_resolutions(id);
CREATE TRIGGER procedure_reopening_stop AFTER UPDATE OF reopened_at ON conversation_resolutions WHEN OLD.reopened_at IS NULL AND NEW.reopened_at IS NOT NULL BEGIN
 UPDATE procedure_releases SET state='stopped',stopped_at=NEW.reopened_at,regression_resolution_id=NEW.id WHERE project_id=NEW.project_id AND state='active' AND id IN (
  SELECT pg.release_id FROM procedure_generation pg JOIN ai_generations g ON g.id=pg.generation_id JOIN messages m ON m.project_id=g.project_id AND m.conversation_id=g.conversation_id AND m.local_id='generation:'||g.id AND m.actor_role='ai'
  WHERE g.project_id=NEW.project_id AND g.conversation_id=NEW.conversation_id AND m.revision>=NEW.cycle_start_revision AND m.revision<=NEW.resolved_revision
 );
 UPDATE ai_generations SET state='cancelled',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ',NEW.reopened_at/1000.0,'unixepoch') WHERE project_id=NEW.project_id AND state IN ('queued','running') AND conversation_id IN (SELECT pc.conversation_id FROM procedure_cohort pc JOIN procedure_releases r ON r.id=pc.release_id AND r.project_id=pc.project_id WHERE r.project_id=NEW.project_id AND r.state='stopped' AND r.regression_resolution_id=NEW.id);
 UPDATE conversations SET assigned_to=(SELECT user_id FROM memberships WHERE project_id=NEW.project_id ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,user_id LIMIT 1),updated_at=NEW.reopened_at WHERE project_id=NEW.project_id AND assigned_to IS NULL AND id IN (SELECT pc.conversation_id FROM procedure_cohort pc JOIN procedure_releases r ON r.id=pc.release_id AND r.project_id=pc.project_id WHERE r.project_id=NEW.project_id AND r.state='stopped' AND r.regression_resolution_id=NEW.id);
 UPDATE conversation_ai SET ai_id=NULL WHERE conversation_id IN (SELECT pc.conversation_id FROM procedure_cohort pc JOIN procedure_releases r ON r.id=pc.release_id AND r.project_id=pc.project_id WHERE r.project_id=NEW.project_id AND r.state='stopped' AND r.regression_resolution_id=NEW.id);
END;
