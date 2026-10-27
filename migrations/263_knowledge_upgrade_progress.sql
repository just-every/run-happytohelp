-- Existing workspaces are converted in bounded, durable queue steps. The
-- report remains incomplete until every scoped table cursor is exhausted.
CREATE TABLE knowledge_upgrade_progress(
 project_id TEXT PRIMARY KEY REFERENCES projects(id),
 table_name TEXT NOT NULL DEFAULT '',row_key TEXT NOT NULL DEFAULT '',
 schema_json TEXT NOT NULL DEFAULT '[]',schema_cursor INTEGER NOT NULL DEFAULT 0,
 canonicalised_rows INTEGER NOT NULL DEFAULT 0,changed_rows INTEGER NOT NULL DEFAULT 0,
 lease_token TEXT,lease_expires_at INTEGER,queued_at INTEGER,updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO knowledge_upgrade_reports(project_id,report_json,completed_at)
 SELECT id,json_object('unpublishedArticles',json('[]'),'status','pending'),NULL FROM projects;
INSERT INTO knowledge_upgrade_progress(project_id,updated_at)
 SELECT project_id,unixepoch()*1000 FROM knowledge_upgrade_reports WHERE completed_at IS NULL;

-- A project born after this migration has no historical transcript to scan.
-- Subsequent writes use the normal knowledge write boundary.
CREATE TRIGGER knowledge_upgrade_new_project AFTER INSERT ON projects BEGIN
 INSERT INTO knowledge_upgrade_reports(project_id,report_json,completed_at)
 VALUES(NEW.id,json_object('unpublishedArticles',json('[]'),'canonicalisedRows',0,'changedRows',0,'status','completed'),unixepoch()*1000);
END;
