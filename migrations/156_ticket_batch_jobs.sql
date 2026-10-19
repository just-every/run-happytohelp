-- Ticket work is accepted in D1 before a queue wakeup or a queued response.
CREATE TABLE ticket_batch_jobs (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 actor_json TEXT NOT NULL,
 authority_json TEXT NOT NULL,
 operation_json TEXT NOT NULL,
 selection_json TEXT NOT NULL,
 results_json TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','complete','failed')),
 cursor INTEGER NOT NULL DEFAULT 0,
 attempts INTEGER NOT NULL DEFAULT 0,
 recovery_ticks INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX ticket_batch_jobs_pending ON ticket_batch_jobs(state,updated_at,id);
