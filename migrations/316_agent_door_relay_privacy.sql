-- Old relay triggers can assign an old Business's approval execution to a new
-- Business. Any seed that applied 0040 and re-paired with a pending approval can
-- already contain these rows. Remove only provable cross-Business memberships;
-- retain every audit and do not infer missing historical membership.
-- Count affected memberships before applying:
-- SELECT COUNT(*) FROM agent_door_relay r JOIN agent_door_audit a ON a.id=r.decision_id
-- WHERE EXISTS(SELECT 1 FROM agent_door_relay parent
--   WHERE parent.decision_id=json_extract(a.row,'$.decision_id') AND parent.business<>r.business);
DELETE FROM agent_door_relay
WHERE sequence IN (
  SELECT r.sequence FROM agent_door_relay r JOIN agent_door_audit a ON a.id=r.decision_id
  WHERE EXISTS(SELECT 1 FROM agent_door_relay parent
    WHERE parent.decision_id=json_extract(a.row,'$.decision_id') AND parent.business<>r.business)
);

-- Recreate even on databases where the shipped triggers already exist.
DROP TRIGGER IF EXISTS agent_door_relay_audit_insert;
DROP TRIGGER IF EXISTS agent_door_relay_audit_update;
-- Executions inherit only their decision's membership, including no membership.
-- Erasure drops the link, door and consent; preserve its existing membership.
-- Plain INSERT then DELETE: an outer UPSERT's conflict policy overrides a trigger's.
CREATE TRIGGER IF NOT EXISTS agent_door_relay_audit_insert AFTER INSERT ON agent_door_audit
WHEN json_extract(NEW.row,'$.door')='mcp' AND json_extract(NEW.row,'$.consent') IS NOT NULL
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT NEW.id,business FROM (SELECT CASE WHEN json_extract(NEW.row,'$.decision_id') IS NOT NULL THEN
      (SELECT business FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id') ORDER BY sequence DESC LIMIT 1)
    ELSE COALESCE((SELECT business FROM agent_door_relay WHERE decision_id=NEW.id ORDER BY sequence DESC LIMIT 1),
      (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1)) END AS business)
    WHERE business IS NOT NULL;
  DELETE FROM agent_door_relay WHERE decision_id=NEW.id AND (
    sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=NEW.id)
    OR (json_extract(NEW.row,'$.decision_id') IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id'))));
END;
CREATE TRIGGER IF NOT EXISTS agent_door_relay_audit_update AFTER UPDATE ON agent_door_audit
WHEN EXISTS(SELECT 1 FROM agent_door_relay WHERE decision_id=NEW.id)
  OR (json_extract(NEW.row,'$.door')='mcp' AND json_extract(NEW.row,'$.consent') IS NOT NULL)
BEGIN
  INSERT INTO agent_door_relay(decision_id,business)
    SELECT NEW.id,business FROM (SELECT CASE WHEN json_extract(NEW.row,'$.decision_id') IS NOT NULL THEN
      (SELECT business FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id') ORDER BY sequence DESC LIMIT 1)
    ELSE COALESCE((SELECT business FROM agent_door_relay WHERE decision_id=NEW.id ORDER BY sequence DESC LIMIT 1),
      (SELECT json_extract(envelope,'$.business') FROM agent_door_state WHERE id=1)) END AS business)
    WHERE business IS NOT NULL;
  DELETE FROM agent_door_relay WHERE decision_id=NEW.id AND (
    sequence<(SELECT MAX(sequence) FROM agent_door_relay WHERE decision_id=NEW.id)
    OR (json_extract(NEW.row,'$.decision_id') IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM agent_door_relay WHERE decision_id=json_extract(NEW.row,'$.decision_id'))));
END;
