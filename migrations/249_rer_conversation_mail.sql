-- Routing history survives renames, rotation and workspace retirement. No live keys.
CREATE TABLE rer_mailboxes (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), allocation_key TEXT NOT NULL UNIQUE,
 mailbox_id TEXT UNIQUE, address TEXT UNIQUE, generation INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL DEFAULT 'pending', configured INTEGER NOT NULL DEFAULT 0,
 route_active INTEGER NOT NULL DEFAULT 0, last_inbound_at INTEGER, last_outbound_at INTEGER,
 error TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE rer_mailbox_outbox (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), action TEXT NOT NULL DEFAULT 'bind',
 state TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0, claim_token TEXT, claimed_at INTEGER, error TEXT
);
CREATE TABLE rer_mail_ingress (
 delivery_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 mailbox_id TEXT NOT NULL, generation INTEGER NOT NULL, body_sha256 TEXT NOT NULL,
 raw_key TEXT NOT NULL, metadata_json TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'stored',
 result_json TEXT, sender_address TEXT, error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX rer_mail_ingress_workspace ON rer_mail_ingress(project_id,updated_at);
CREATE TRIGGER rer_mail_retire_workspace AFTER UPDATE OF settings_json ON project_settings
 WHEN json_extract(NEW.settings_json,'$.deleted_at') IS NOT NULL AND EXISTS(SELECT 1 FROM rer_mailboxes WHERE project_id=NEW.project_id)
 BEGIN
 UPDATE rer_mailboxes SET state='revoked',route_active=0,updated_at=NEW.updated_at WHERE project_id=NEW.project_id;
 INSERT INTO rer_mailbox_outbox(project_id,action) VALUES(NEW.project_id,'retire')
 ON CONFLICT(project_id) DO UPDATE SET action='retire',state='pending',attempts=0,next_at=0,claim_token=NULL,error=NULL;
 END;

CREATE TABLE rer_mail_raw_objects (
 delivery_id TEXT NOT NULL REFERENCES rer_mail_ingress(delivery_id),
 body_sha256 TEXT NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id), object_key TEXT NOT NULL,
 PRIMARY KEY(delivery_id,body_sha256)
);
-- Redacted command/thread routing metadata, never a runnable effect or payload.
CREATE TABLE rer_mail_commands (
 command_id TEXT PRIMARY KEY REFERENCES email_deliveries(id), project_id TEXT NOT NULL REFERENCES projects(id),
 mailbox_id TEXT NOT NULL, generation INTEGER NOT NULL, message_key TEXT NOT NULL UNIQUE,
 conversation_id TEXT, message_id TEXT, accepted_at INTEGER
);
