-- Business credentials are installation custody and excluded from portable archives.
CREATE TABLE business_connections (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),provider TEXT NOT NULL,
 account TEXT NOT NULL,host TEXT NOT NULL,token_cipher TEXT,scopes_json TEXT NOT NULL,
 limit_cents INTEGER NOT NULL DEFAULT 0,expires_at INTEGER,version INTEGER NOT NULL DEFAULT 1,updated_at INTEGER NOT NULL,
 UNIQUE(project_id,provider,account)
);
CREATE TABLE business_links (
 connection_id TEXT NOT NULL REFERENCES business_connections(id),project_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),contact_id TEXT NOT NULL,source_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1,context_json TEXT,fetched_at INTEGER,error TEXT,
 PRIMARY KEY(connection_id,conversation_id)
);
CREATE INDEX business_links_contact ON business_links(project_id,contact_id);
CREATE TABLE business_actions (
 id TEXT PRIMARY KEY,project_id TEXT NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id),
 connection_id TEXT NOT NULL REFERENCES business_connections(id),connection_version INTEGER NOT NULL,
 link_version INTEGER NOT NULL,source_id TEXT NOT NULL,request_key TEXT NOT NULL,kind TEXT NOT NULL,target_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,reason TEXT NOT NULL,preview_json TEXT NOT NULL,state TEXT NOT NULL,
 remote_id TEXT,result_json TEXT,approved_by TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,
 UNIQUE(connection_id,conversation_id,request_key)
);
-- A changed browser request key cannot bypass an unresolved operation on the same provider record.
CREATE UNIQUE INDEX business_action_inflight ON business_actions(connection_id,target_id) WHERE state IN ('prepared','approved','sending','uncertain');
CREATE INDEX business_actions_ticket ON business_actions(project_id,conversation_id);
