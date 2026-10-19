CREATE TABLE ticket_problems (
 project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 version INTEGER NOT NULL DEFAULT 1,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,conversation_id)
);
CREATE TABLE ticket_problem_incidents (
 project_id TEXT NOT NULL,
 problem_id TEXT NOT NULL,
 incident_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,incident_id),
 FOREIGN KEY(project_id,problem_id) REFERENCES ticket_problems(project_id,conversation_id) ON DELETE CASCADE,
 CHECK(problem_id<>incident_id)
);
CREATE INDEX ticket_problem_children ON ticket_problem_incidents(project_id,problem_id,incident_id);
CREATE TRIGGER ticket_problem_tenant BEFORE INSERT ON ticket_problems BEGIN
 SELECT RAISE(ABORT,'Problem must be a workspace ticket and cannot be an incident') WHERE NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id) OR EXISTS(SELECT 1 FROM ticket_problem_incidents WHERE project_id=NEW.project_id AND incident_id=NEW.conversation_id);
END;
CREATE TRIGGER ticket_problem_incident_tenant BEFORE INSERT ON ticket_problem_incidents BEGIN
 SELECT RAISE(ABORT,'Incident must be a workspace ticket and cannot be a problem') WHERE NOT EXISTS(SELECT 1 FROM conversations WHERE id=NEW.incident_id AND project_id=NEW.project_id) OR EXISTS(SELECT 1 FROM ticket_problems WHERE project_id=NEW.project_id AND conversation_id=NEW.incident_id);
END;
CREATE TRIGGER ticket_problem_link_version AFTER INSERT ON ticket_problem_incidents BEGIN
 UPDATE ticket_problems SET version=version+1 WHERE project_id=NEW.project_id AND conversation_id=NEW.problem_id;
END;
CREATE TRIGGER ticket_problem_unlink_version AFTER DELETE ON ticket_problem_incidents BEGIN
 UPDATE ticket_problems SET version=version+1 WHERE project_id=OLD.project_id AND conversation_id=OLD.problem_id;
END;
CREATE TABLE ticket_problem_previews (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 problem_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 actor_id TEXT NOT NULL,
 problem_version INTEGER NOT NULL,
 problem_ticket_version INTEGER NOT NULL,
 problem_revision INTEGER NOT NULL,
 problem_last_message_id TEXT,
 plan_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'preview' CHECK(state IN ('preview','executing','complete','erased'))
);
CREATE INDEX ticket_problem_preview_owner ON ticket_problem_previews(project_id,problem_id,actor_id,created_at);
CREATE TABLE ticket_problem_attempts (
 id TEXT PRIMARY KEY,
 preview_id TEXT NOT NULL REFERENCES ticket_problem_previews(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id),
 problem_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 incident_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 local_id TEXT NOT NULL UNIQUE,
 message_id TEXT,
 state TEXT NOT NULL CHECK(state IN ('claimed','ready','sending','sent','failed','uncertain','blocked','solved','updated','erased')),
 reason TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 UNIQUE(preview_id,incident_id)
);
CREATE INDEX ticket_problem_attempt_message ON ticket_problem_attempts(project_id,message_id);
