-- Before rer 0.2.104, Business MCP admission saved consent but no source tag.
-- Local credentials never carry consent; embedded invocations are not MCP.
-- Use the saved admission, not the current pairing or relay membership, so a
-- stopped/detached Business cannot leave its old approvals outside the stop guard.
-- Only the principal's missing source is added. Audits and terminal approvals
-- remain untouched, and applying this update again changes no rows.
UPDATE agent_door_approvals
SET saved=json_set(saved,'$.principal.source','business')
WHERE state='pending'
  AND json_type(saved,'$.principal')='object'
  AND json_type(saved,'$.principal.source') IS NULL
  AND json_extract(saved,'$.door')='mcp'
  AND json_type(saved,'$.principal.consent')='text'
  AND length(trim(json_extract(saved,'$.principal.consent')))>0;
