CREATE TABLE ticket_handle_sessions(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 started_at INTEGER NOT NULL,
 ended_at INTEGER CHECK(ended_at IS NULL OR ended_at>=started_at),
 adjusted_duration_ms INTEGER CHECK(adjusted_duration_ms IS NULL OR (ended_at IS NOT NULL AND adjusted_duration_ms>=0)),
 adjustment_reason TEXT,
 adjusted_by TEXT REFERENCES users(id),
 adjusted_at INTEGER
);
CREATE UNIQUE INDEX ticket_handle_running ON ticket_handle_sessions(project_id,conversation_id,user_id) WHERE ended_at IS NULL;
CREATE INDEX ticket_handle_report ON ticket_handle_sessions(project_id,started_at,ended_at);
CREATE INDEX ticket_handle_conversation ON ticket_handle_sessions(project_id,conversation_id);
CREATE TRIGGER ticket_handle_start_history AFTER INSERT ON ticket_handle_sessions BEGIN
 INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json)
 VALUES('timer:start:'||NEW.id,NEW.project_id,NEW.conversation_id,NEW.user_id,'user','dashboard',NEW.started_at,json_object('handle_timer',json_object('session_id',NEW.id,'user_id',NEW.user_id,'started_at',NEW.started_at)));
END;
CREATE TRIGGER ticket_handle_stop_history AFTER UPDATE OF ended_at ON ticket_handle_sessions WHEN OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL BEGIN
 INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json)
 SELECT 'timer:stop:'||NEW.id,NEW.project_id,NEW.conversation_id,
 CASE WHEN c.status_category IN ('solved','closed') THEN c.ticket_actor_id ELSE NEW.user_id END,
 CASE WHEN c.status_category IN ('solved','closed') THEN c.ticket_actor_type ELSE 'user' END,
 CASE WHEN c.status_category IN ('solved','closed') THEN c.ticket_source ELSE 'dashboard' END,
 NEW.ended_at,json_object('handle_timer',json_object('session_id',NEW.id,'user_id',NEW.user_id,'started_at',NEW.started_at,'ended_at',NEW.ended_at,'reason',CASE WHEN c.status_category IN ('solved','closed') THEN 'solved' ELSE 'operator' END))
 FROM conversations c WHERE c.id=NEW.conversation_id AND c.project_id=NEW.project_id;
END;
-- Every writer (dashboard, API, rules, AI and bulk jobs) reaches this stop.
CREATE TRIGGER ticket_handle_stop_on_solve AFTER UPDATE OF status_category ON conversations WHEN NEW.status_category IN ('solved','closed') BEGIN
 UPDATE ticket_handle_sessions SET ended_at=max(started_at,CASE WHEN NEW.resolved_at>=started_at THEN NEW.resolved_at ELSE NEW.updated_at END)
 WHERE project_id=NEW.project_id AND conversation_id=NEW.id AND ended_at IS NULL;
END;

CREATE TABLE report_schedules(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 created_by TEXT NOT NULL REFERENCES users(id),
 name TEXT NOT NULL,
 frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly')),
 hour INTEGER NOT NULL CHECK(hour BETWEEN 0 AND 23),
 weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6),
 team_id TEXT,
 brand_id TEXT,
 include_imported INTEGER NOT NULL DEFAULT 0 CHECK(include_imported IN (0,1)),
 paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)),
 timezone TEXT NOT NULL,
 window_date TEXT NOT NULL,
 next_run_at INTEGER NOT NULL,
 last_dispatched_at INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX report_schedules_due ON report_schedules(paused,next_run_at,last_dispatched_at);
CREATE TABLE report_schedule_recipients(
 schedule_id TEXT NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(schedule_id,user_id)
);
-- No CSV, customer address or provider payload is retained here. A claimed or
-- unknown delivery is terminal: a Worker crash can never replay an external send.
CREATE TABLE report_schedule_deliveries(
 id TEXT PRIMARY KEY,
 schedule_id TEXT NOT NULL REFERENCES report_schedules(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id),
 window_date TEXT NOT NULL,
 recipient_id TEXT NOT NULL REFERENCES users(id),
 state TEXT NOT NULL CHECK(state IN ('claimed','sent','suppressed','unknown','skipped')),
 claimed_at INTEGER NOT NULL,
 finished_at INTEGER,
 UNIQUE(schedule_id,window_date,recipient_id)
);
CREATE INDEX report_schedule_deliveries_project ON report_schedule_deliveries(project_id,schedule_id,window_date);
CREATE TRIGGER report_schedule_delivery_claim_audit AFTER INSERT ON report_schedule_deliveries BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('report-claim:'||NEW.id,NEW.project_id,NEW.claimed_at,'data','reports.schedule.claimed',CASE WHEN NEW.state='skipped' THEN 'refused' ELSE 'succeeded' END,'system',NULL,'system','report_schedule',NEW.schedule_id,json_object('window',NEW.window_date,'recipient_id',NEW.recipient_id,'state',NEW.state));
END;
CREATE TRIGGER report_schedule_delivery_outcome_audit AFTER UPDATE OF state ON report_schedule_deliveries WHEN NEW.state<>OLD.state BEGIN
 INSERT INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 VALUES('report-outcome:'||NEW.id,NEW.project_id,coalesce(NEW.finished_at,NEW.claimed_at),'data','reports.schedule.delivered',CASE WHEN NEW.state IN ('sent','suppressed') THEN 'succeeded' WHEN NEW.state='skipped' THEN 'refused' ELSE 'failed' END,'system',NULL,'system','report_schedule',NEW.schedule_id,json_object('window',NEW.window_date,'recipient_id',NEW.recipient_id,'state',NEW.state));
END;

CREATE TRIGGER ticket_handle_adjust_history AFTER UPDATE OF adjusted_at ON ticket_handle_sessions WHEN NEW.adjusted_at IS NOT NULL BEGIN
 INSERT INTO ticket_history(id,project_id,conversation_id,actor_id,actor_type,source,at,changes_json)
 VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.conversation_id,NEW.adjusted_by,'user','dashboard',NEW.adjusted_at,json_object('handle_timer_adjustment',json_object('session_id',NEW.id,'user_id',NEW.user_id,'from_ms',coalesce(OLD.adjusted_duration_ms,OLD.ended_at-OLD.started_at),'to_ms',NEW.adjusted_duration_ms,'reason',NEW.adjustment_reason)));
END;
