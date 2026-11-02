-- Base 8b925fa5ffaa577df9f2e4ebab6ede8af5155baa: modules/agent-door/schema/replay-aliases.sql
-- and default-seed migrations 0039_agent_replay_window.sql / 0040_agent_door_relay.sql.
-- Agent door 0.2.96: preserve prior migrations, calls and retention.
ALTER TABLE agent_door_agents ADD COLUMN tombstone TEXT;
-- Installation-private replay custody, never included in an archive or export.
-- The call's fixed replay horizon bounds the alias; deletion is atomic below.
CREATE TABLE IF NOT EXISTS agent_door_replay_aliases (
  agent TEXT NOT NULL, alias TEXT NOT NULL, call_id TEXT NOT NULL, tombstone TEXT NOT NULL,
  PRIMARY KEY(agent,alias)
);

CREATE TRIGGER IF NOT EXISTS agent_door_delete_replay_aliases AFTER DELETE ON agent_door_calls
BEGIN
  DELETE FROM agent_door_replay_aliases WHERE agent=OLD.agent AND call_id=OLD.decision_id;
END;
CREATE INDEX IF NOT EXISTS agent_door_replay_aliases_call ON agent_door_replay_aliases(agent,call_id);

-- Fixed Base replay window; no installation or seed override.
ALTER TABLE agent_door_calls ADD COLUMN expires_at INTEGER;
-- Older completed claims have no completion timestamp: use their recorded start,
-- never migration/erasure time, so upgrading cannot extend their retention.
UPDATE agent_door_calls SET expires_at=created_at + 30*24*60*60*1000
WHERE state NOT IN ('running','pending');
CREATE INDEX agent_door_calls_expiry ON agent_door_calls(expires_at);

CREATE TRIGGER IF NOT EXISTS agent_door_delete_replay_aliases AFTER DELETE ON agent_door_calls
BEGIN
  DELETE FROM agent_door_replay_aliases WHERE agent=OLD.agent AND call_id=OLD.decision_id;
END;
CREATE INDEX IF NOT EXISTS agent_door_replay_aliases_call ON agent_door_replay_aliases(agent,call_id);

CREATE TABLE IF NOT EXISTS agent_door_relay (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, decision_id TEXT NOT NULL, business TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_door_relay_business ON agent_door_relay(business,sequence);
CREATE INDEX IF NOT EXISTS agent_door_relay_decision ON agent_door_relay(decision_id,sequence);
-- Plain INSERT then DELETE, never INSERT OR REPLACE: an outer UPSERT's conflict policy overrides a trigger's.
CREATE TRIGGER IF NOT EXISTS agent_door_relay_audit_insert AFTER INSERT ON agent_door_audit
WHEN json_extract(NEW.row,'$.door')='mcp' AND json_extract(NEW.row,'$.consent') IS NOT NULL
 AND (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1) IS NOT NULL
BEGIN
  INSERT INTO agent_door_relay(decision_id,business) VALUES(NEW.id,
    COALESCE((SELECT business FROM agent_door_relay WHERE decision_id=NEW.id ORDER BY sequence DESC LIMIT 1),
             (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1)));
  DELETE FROM agent_door_relay WHERE decision_id=NEW.id AND sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=NEW.id);
END;
-- Membership survives erasure, which drops door and consent from the row.
CREATE TRIGGER IF NOT EXISTS agent_door_relay_audit_update AFTER UPDATE ON agent_door_audit
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=NEW.id)
  OR (json_extract(NEW.row,'$.door')='mcp' AND json_extract(NEW.row,'$.consent') IS NOT NULL
      AND (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1) IS NOT NULL)
BEGIN
  INSERT INTO agent_door_relay(decision_id,business) VALUES(NEW.id,
    COALESCE((SELECT business FROM agent_door_relay WHERE decision_id=NEW.id ORDER BY sequence DESC LIMIT 1),
             (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1)));
  DELETE FROM agent_door_relay WHERE decision_id=NEW.id AND sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS agent_door_relay_approval AFTER UPDATE OF state ON agent_door_approvals
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'))
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT decision_id,business FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id') ORDER BY sequence DESC LIMIT 1;
  DELETE FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id')
    AND sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'));
END;
CREATE TRIGGER IF NOT EXISTS agent_door_relay_review AFTER UPDATE OF state ON agent_door_reviews
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'))
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT decision_id,business FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id') ORDER BY sequence DESC LIMIT 1;
  DELETE FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id')
    AND sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=json_extract(NEW.saved,'$.decision_id'));
END;
-- 0040 only, once: pre-existing Business-token rows, attributed to the current envelope's Business (platform P11 drops pre-join history).
INSERT INTO agent_door_relay(decision_id,business)
  SELECT id,(SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1) FROM agent_door_audit
  WHERE json_extract(row,'$.door')='mcp' AND json_extract(row,'$.consent') IS NOT NULL
    AND (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1) IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM agent_door_relay r WHERE r.decision_id=agent_door_audit.id)
  ORDER BY sequence;
