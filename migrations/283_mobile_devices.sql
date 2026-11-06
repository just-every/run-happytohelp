-- Mobile capabilities are separate from native sessions and cannot enter other APIs.
CREATE TABLE mobile_devices (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 parent_session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 platform TEXT NOT NULL CHECK(platform IN ('ios','android')),
 scopes_json TEXT NOT NULL,
 authority_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 push_enabled INTEGER NOT NULL DEFAULT 0 CHECK(push_enabled IN (0,1))
);
CREATE INDEX mobile_devices_user ON mobile_devices(project_id,user_id,revoked_at);
CREATE TABLE mobile_frontiers (
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL,
 last_message_id TEXT,
 ticket_version INTEGER NOT NULL,
 schedules_json TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX mobile_frontiers_device ON mobile_frontiers(device_id,expires_at);
CREATE TABLE mobile_commands (
 device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 local_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 intent_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('uncertain','complete','refused')),
 resource_id TEXT,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(device_id,local_id)
);
CREATE TABLE mobile_links (
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL REFERENCES mobile_devices(id) ON DELETE CASCADE,
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 notice_id TEXT NOT NULL,
 expires_at INTEGER NOT NULL,
 UNIQUE(device_id,notice_id)
);
-- Persist revocation, including a change away and back while the device is offline.
CREATE TRIGGER mobile_parent_revoked AFTER UPDATE OF revoked_at,expires_at,role,project_id ON sessions
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE parent_session_hash=OLD.token_hash;
 DELETE FROM mobile_frontiers WHERE device_id IN (SELECT id FROM mobile_devices WHERE parent_session_hash=OLD.token_hash);
 DELETE FROM mobile_links WHERE device_id IN (SELECT id FROM mobile_devices WHERE parent_session_hash=OLD.token_hash);
END;
CREATE TRIGGER mobile_member_removed AFTER DELETE ON memberships
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id AND user_id=OLD.user_id;
END;
CREATE TRIGGER mobile_member_changed AFTER UPDATE OF role ON memberships WHEN OLD.role<>NEW.role
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id AND user_id=OLD.user_id;
END;
CREATE TRIGGER mobile_role_assigned AFTER INSERT ON member_roles
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=NEW.project_id AND user_id=NEW.user_id;
END;
CREATE TRIGGER mobile_role_changed AFTER UPDATE ON member_roles
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id AND user_id=OLD.user_id;
END;
CREATE TRIGGER mobile_role_removed AFTER DELETE ON member_roles
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id AND user_id=OLD.user_id;
END;
CREATE TRIGGER mobile_role_definition AFTER UPDATE ON project_roles
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id AND user_id IN (SELECT user_id FROM member_roles WHERE project_id=OLD.project_id AND role_key=OLD.id);
END;
CREATE TRIGGER mobile_role_definition_removed BEFORE DELETE ON project_roles
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id AND user_id IN (SELECT user_id FROM member_roles WHERE project_id=OLD.project_id AND role_key=OLD.id);
END;
CREATE TRIGGER mobile_factor_added AFTER INSERT ON user_factors
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER mobile_factor_changed AFTER UPDATE ON user_factors
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER mobile_factor_removed AFTER DELETE ON user_factors
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER mobile_factor_policy AFTER UPDATE OF settings_json ON project_settings
WHEN json_extract(OLD.settings_json,'$.two_factor_roles') IS NOT json_extract(NEW.settings_json,'$.two_factor_roles') OR json_extract(NEW.settings_json,'$.deleted_at') IS NOT NULL
BEGIN
 UPDATE mobile_devices SET revoked_at=coalesce(revoked_at,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)),push_enabled=0 WHERE project_id=OLD.project_id;
END;
CREATE TRIGGER mobile_device_retired AFTER UPDATE OF revoked_at ON mobile_devices WHEN NEW.revoked_at IS NOT NULL
BEGIN
 DELETE FROM mobile_frontiers WHERE device_id=NEW.id;
 DELETE FROM mobile_links WHERE device_id=NEW.id;
END;
