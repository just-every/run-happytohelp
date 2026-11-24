-- Scheduled discovery reads only work that can still be due. Partial indexes keep
-- solved, closed, imported and settled history off these minute-by-minute paths,
-- so each run reads the same rows however much history a workspace keeps.

-- SLA backstop: open tickets, and tickets with an open alert, in cursor order.
CREATE INDEX IF NOT EXISTS conversations_sla_open
 ON conversations(project_id,id) WHERE status_category NOT IN ('solved','closed');
CREATE INDEX IF NOT EXISTS sla_alerts_open_ticket
 ON sla_alerts(project_id,conversation_id) WHERE state='open';

-- Integration discovery: intents still to prepare, and deliveries still queued or
-- claimed. Settled intents and accepted or rejected deliveries are never walked.
CREATE INDEX IF NOT EXISTS native_integration_intents_unprepared
 ON native_integration_intents(project_id,id) WHERE prepared_at IS NULL;
CREATE INDEX IF NOT EXISTS integration_deliveries_live
 ON integration_deliveries(namespace,next_at) WHERE state IN ('queued','sending');

-- Survey discovery walks resolutions once, in resolved order, from a stored cursor.
-- It still revisits each resolution until its invitation would be due.
CREATE INDEX IF NOT EXISTS conversation_resolutions_survey_walk
 ON conversation_resolutions(resolved_at,id) WHERE reopened_at IS NULL;
CREATE TABLE IF NOT EXISTS csat_discovery_cursor(id INTEGER PRIMARY KEY CHECK(id=1),resolved_at INTEGER NOT NULL,resolution_id TEXT NOT NULL);
