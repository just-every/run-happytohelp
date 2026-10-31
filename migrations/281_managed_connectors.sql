-- API-001: managed connectors retain metadata only. No connection is enabled by migration.
ALTER TABLE native_integration_destinations ADD COLUMN connector TEXT NOT NULL DEFAULT 'native';
CREATE TRIGGER managed_revoke_destinations AFTER UPDATE OF revoked_at ON api_credentials WHEN NEW.revoked_at IS NOT NULL BEGIN
 UPDATE native_integration_destinations SET enabled=0 WHERE project_id=NEW.namespace AND credential_id=NEW.id;
END;
-- Zapier's workspace grants subscribe to the workspace. Machine grants retain
-- the existing origin-credential filter; native destination filters are unchanged.
DROP TRIGGER api_destination_filter;
CREATE TRIGGER api_destination_filter BEFORE INSERT ON native_integration_intents
WHEN EXISTS(SELECT 1 FROM native_integration_destinations d JOIN native_integration_events e ON e.id=NEW.event_id
 WHERE d.id=NEW.destination_id AND e.event<>'integration.test' AND (
 (d.credential_id IS NOT NULL AND NOT (d.connector='zapier' AND EXISTS(SELECT 1 FROM api_credentials c WHERE c.namespace=d.project_id AND c.id=d.credential_id AND c.source_product IS NULL)) AND NOT EXISTS(SELECT 1 FROM api_conversations a WHERE a.conversation_id=e.conversation_id AND a.credential_id=d.credential_id))
 OR (d.source_product IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api_conversations a WHERE a.conversation_id=e.conversation_id AND a.source_product=d.source_product))))
BEGIN SELECT RAISE(IGNORE); END;
CREATE TABLE helpscout_connections(
 project_id TEXT PRIMARY KEY REFERENCES projects(id), mailbox_id TEXT NOT NULL,
 secret_ciphertext TEXT, revision INTEGER NOT NULL DEFAULT 1, cursor TEXT, next_page TEXT, scan_started_at TEXT,
 last_pull_at INTEGER, error_class TEXT, claim TEXT, claim_until INTEGER,
 waiting_events INTEGER NOT NULL DEFAULT 0, last_run_id TEXT, skipped_erased INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE helpscout_events(project_id TEXT NOT NULL REFERENCES helpscout_connections(project_id) ON DELETE CASCADE,digest TEXT NOT NULL,received_at INTEGER NOT NULL,PRIMARY KEY(project_id,digest));
-- Preserve contact/article service semantics; identifier-only events are in the
-- successful domain transaction. Historical migration writes remain inert.
CREATE TRIGGER managed_contact_created AFTER INSERT ON contacts
WHEN coalesce(NEW.external_id,'') NOT LIKE 'import:%' AND coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=0 BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NEW.id,'contact.created',json_object('contact_id',NEW.id),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),NULL);
END;
CREATE TRIGGER managed_contact_updated AFTER UPDATE OF name,email,external_id,metadata_json ON contacts
WHEN coalesce(NEW.external_id,'') NOT LIKE 'import:%' AND coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=0 AND coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=0 AND (NEW.name IS NOT OLD.name OR NEW.email IS NOT OLD.email OR NEW.external_id IS NOT OLD.external_id OR NEW.metadata_json IS NOT OLD.metadata_json) BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NEW.id,'contact.updated',json_object('contact_id',NEW.id),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),NULL);
END;
CREATE TRIGGER managed_article_created AFTER INSERT ON knowledge_articles WHEN NEW.status='published' AND NEW.slug NOT LIKE 'import-%' BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NULL,'article.published',json_object('article_id',NEW.id),NEW.updated_at,NULL);
END;
CREATE TRIGGER managed_article_published AFTER UPDATE OF status ON knowledge_articles WHEN NEW.status='published' AND OLD.status<>'published' AND NEW.slug NOT LIKE 'import-%' BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NULL,'article.published',json_object('article_id',NEW.id),NEW.updated_at,NULL);
END;
