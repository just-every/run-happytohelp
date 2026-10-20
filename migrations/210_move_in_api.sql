-- Provider authority is separate from portable source custody.
CREATE TABLE move_in_connections(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),vendor TEXT NOT NULL,base_url TEXT NOT NULL,created_by TEXT NOT NULL,created_at INTEGER NOT NULL,watermark INTEGER,cutover_at INTEGER,retry_at INTEGER);
CREATE TABLE move_in_credentials(connection_id TEXT PRIMARY KEY REFERENCES move_in_connections(id) ON DELETE CASCADE,cipher TEXT NOT NULL);
CREATE TABLE move_in_api_runs(run_id TEXT PRIMARY KEY REFERENCES move_in_runs(id),connection_id TEXT NOT NULL REFERENCES move_in_connections(id),mode TEXT NOT NULL,since INTEGER,watermark INTEGER NOT NULL,cursor_json TEXT,counts_json TEXT NOT NULL DEFAULT '{}',cutover_at INTEGER);
CREATE INDEX move_in_api_connection ON move_in_api_runs(connection_id,watermark);
CREATE TABLE move_in_api_agents(run_id TEXT NOT NULL REFERENCES move_in_runs(id),source_id TEXT NOT NULL,name TEXT NOT NULL,email TEXT,deleted INTEGER NOT NULL,member_id TEXT,PRIMARY KEY(run_id,source_id));
CREATE TABLE move_in_api_files(run_id TEXT NOT NULL REFERENCES move_in_runs(id),ticket_id TEXT NOT NULL,contact_id TEXT,part_id TEXT NOT NULL,source_id TEXT NOT NULL,filename TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER,private INTEGER NOT NULL,object_key TEXT,error TEXT,PRIMARY KEY(run_id,ticket_id,part_id,source_id));
CREATE INDEX move_in_api_files_source ON move_in_api_files(ticket_id,part_id,source_id);
CREATE TABLE move_in_assignment(conversation_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,vendor TEXT NOT NULL,source_agent_id TEXT,member_id TEXT);
