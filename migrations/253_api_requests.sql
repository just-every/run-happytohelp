-- One authority entity; Base bearer rows are its secrets and scope projection.
CREATE TABLE api_credentials(namespace TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,source_product TEXT,scopes TEXT NOT NULL,reach_json TEXT NOT NULL DEFAULT '{}',values_json TEXT NOT NULL DEFAULT '{}',create_minute INTEGER NOT NULL DEFAULT 20,create_day INTEGER NOT NULL DEFAULT 1000,issuer_id TEXT,created_at INTEGER NOT NULL,expires_at INTEGER,revoked_at INTEGER,policy_revision INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(namespace,id));
INSERT INTO api_credentials(namespace,id,name,scopes,created_at,expires_at,revoked_at) SELECT namespace,id,name,scopes,created_at,expires_at,revoked_at FROM integration_tokens;
ALTER TABLE integration_tokens ADD COLUMN credential_id TEXT;
ALTER TABLE integration_tokens ADD COLUMN display_prefix TEXT;
UPDATE integration_tokens SET credential_id=id,display_prefix=substr(id,1,8);
CREATE INDEX api_secret_credential ON integration_tokens(namespace,credential_id);
CREATE TRIGGER api_secret_insert BEFORE INSERT ON integration_tokens WHEN NOT EXISTS(SELECT 1 FROM api_credentials c WHERE c.namespace=NEW.namespace AND c.id=NEW.credential_id AND c.scopes=NEW.scopes) BEGIN SELECT RAISE(ABORT,'credential scope mismatch'); END;
CREATE TRIGGER api_secret_update BEFORE UPDATE OF scopes,credential_id,namespace ON integration_tokens WHEN NOT EXISTS(SELECT 1 FROM api_credentials c WHERE c.namespace=NEW.namespace AND c.id=NEW.credential_id AND c.scopes=NEW.scopes) BEGIN SELECT RAISE(ABORT,'credential scope mismatch'); END;
CREATE TRIGGER api_credential_scopes AFTER UPDATE OF scopes ON api_credentials BEGIN UPDATE integration_tokens SET scopes=NEW.scopes WHERE namespace=NEW.namespace AND credential_id=NEW.id; END;
CREATE TRIGGER api_credential_policy AFTER UPDATE OF name,source_product,scopes,reach_json,values_json,create_minute,create_day,expires_at,revoked_at ON api_credentials BEGIN UPDATE api_credentials SET policy_revision=OLD.policy_revision+1 WHERE namespace=NEW.namespace AND id=NEW.id; END;
CREATE INDEX api_contact_key_0 ON contacts(project_id,lower(trim(email)));
CREATE INDEX api_contact_key_1 ON contacts(project_id,lower(trim(json_extract(metadata_json,'$.provided_email'))));
CREATE INDEX api_contact_key_2 ON contacts(project_id,json_extract(metadata_json,'$.phone'));
CREATE INDEX api_contact_key_3 ON contacts(project_id,external_id);
CREATE INDEX api_contact_key_4 ON contacts(project_id,json_extract(metadata_json,'$.api_external_id'));
CREATE VIEW api_contact_keys AS SELECT project_id,id contact_id,'email' kind,lower(trim(email)) value FROM contacts WHERE lower(trim(email)) IS NOT NULL AND lower(trim(email))<>'' UNION ALL SELECT project_id,id contact_id,'email' kind,lower(trim(json_extract(metadata_json,'$.provided_email'))) value FROM contacts WHERE lower(trim(json_extract(metadata_json,'$.provided_email'))) IS NOT NULL AND lower(trim(json_extract(metadata_json,'$.provided_email')))<>'' UNION ALL SELECT project_id,id contact_id,'phone' kind,json_extract(metadata_json,'$.phone') value FROM contacts WHERE json_extract(metadata_json,'$.phone') IS NOT NULL AND json_extract(metadata_json,'$.phone')<>'' UNION ALL SELECT project_id,id contact_id,'external' kind,external_id value FROM contacts WHERE external_id IS NOT NULL AND external_id<>'' UNION ALL SELECT project_id,id contact_id,'external' kind,json_extract(metadata_json,'$.api_external_id') value FROM contacts WHERE json_extract(metadata_json,'$.api_external_id') IS NOT NULL AND json_extract(metadata_json,'$.api_external_id')<>'';
CREATE TABLE api_requests(project_id TEXT NOT NULL,source_product TEXT NOT NULL,key_digest TEXT NOT NULL,body_digest TEXT NOT NULL,claim TEXT NOT NULL,created_at INTEGER NOT NULL,conversation_id TEXT,contact_id TEXT,status INTEGER,response_json TEXT,erased INTEGER NOT NULL DEFAULT 0,held_id TEXT,PRIMARY KEY(project_id,source_product,key_digest));
CREATE TABLE api_conversations(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),project_id TEXT NOT NULL,credential_id TEXT NOT NULL,form_id TEXT,credential_name TEXT NOT NULL,source_product TEXT NOT NULL,source_ref TEXT,source_url TEXT,UNIQUE(project_id,source_product,source_ref));
CREATE TABLE api_requester_keys(project_id TEXT NOT NULL,digest TEXT NOT NULL,contact_id TEXT NOT NULL,PRIMARY KEY(project_id,digest,contact_id));
CREATE TABLE api_erased_keys(project_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project_id,digest));
CREATE TRIGGER api_request_erasure AFTER UPDATE OF metadata_json ON contacts WHEN json_extract(NEW.metadata_json,'$.is_erasing')=1 OR json_extract(NEW.metadata_json,'$.is_erased')=1 BEGIN
 INSERT OR IGNORE INTO api_erased_keys SELECT project_id,digest FROM api_requester_keys WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 UPDATE api_requests SET response_json=NULL,erased=1 WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 UPDATE api_conversations SET source_url=NULL WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 DELETE FROM api_requester_keys WHERE project_id=NEW.project_id AND contact_id=NEW.id;
END;
CREATE TABLE api_uploads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,credential_id TEXT NOT NULL,object_key TEXT NOT NULL,filename TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,expires_at INTEGER NOT NULL,contact_id TEXT);
CREATE TABLE api_appends(project_id TEXT NOT NULL,conversation_id TEXT NOT NULL,credential_id TEXT NOT NULL,local_id TEXT NOT NULL,body_digest TEXT NOT NULL,response_json TEXT,contact_id TEXT NOT NULL,PRIMARY KEY(project_id,conversation_id,credential_id,local_id));
CREATE TABLE api_notes(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),user_id TEXT NOT NULL,name TEXT NOT NULL,content TEXT NOT NULL,created_at INTEGER NOT NULL);
CREATE TABLE api_note_media(note_id TEXT NOT NULL REFERENCES api_notes(id) ON DELETE CASCADE,media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,PRIMARY KEY(note_id,media_id));
CREATE TRIGGER api_append_erasure AFTER UPDATE OF metadata_json ON contacts WHEN json_extract(NEW.metadata_json,'$.is_erasing')=1 OR json_extract(NEW.metadata_json,'$.is_erased')=1 BEGIN
 DELETE FROM api_appends WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 DELETE FROM api_notes WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
END;
ALTER TABLE native_integration_destinations ADD COLUMN credential_id TEXT;
ALTER TABLE native_integration_destinations ADD COLUMN source_product TEXT;
CREATE TRIGGER api_destination_filter BEFORE INSERT ON native_integration_intents
WHEN EXISTS(SELECT 1 FROM native_integration_destinations d JOIN native_integration_events e ON e.id=NEW.event_id
 WHERE d.id=NEW.destination_id AND e.event<>'integration.test' AND (
 (d.credential_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api_conversations a WHERE a.conversation_id=e.conversation_id AND a.credential_id=d.credential_id))
 OR (d.source_product IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api_conversations a WHERE a.conversation_id=e.conversation_id AND a.source_product=d.source_product))))
BEGIN SELECT RAISE(IGNORE); END;
CREATE TRIGGER api_status_event AFTER UPDATE OF status_id,status_category ON conversations WHEN NEW.status_id<>OLD.status_id OR NEW.status_category<>OLD.status_category BEGIN
 INSERT INTO native_integration_events SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.id,NEW.contact_id,'conversation.status_changed',json_object('conversation_id',NEW.id,'previous_status_id',OLD.status_id,'previous_status_category',OLD.status_category,'status_id',NEW.status_id,'status_category',NEW.status_category,'source_product',a.source_product,'source_ref',a.source_ref),NEW.updated_at,NULL FROM (SELECT 1) LEFT JOIN api_conversations a ON a.conversation_id=NEW.id;
END;
CREATE TRIGGER api_assignment_event AFTER UPDATE OF assigned_to ON conversations WHEN NEW.assigned_to IS NOT OLD.assigned_to BEGIN
 INSERT INTO native_integration_events SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.id,NEW.contact_id,'conversation.assigned',json_object('conversation_id',NEW.id,'assigned_to',NEW.assigned_to,'source_product',a.source_product,'source_ref',a.source_ref),NEW.updated_at,NULL FROM (SELECT 1) LEFT JOIN api_conversations a ON a.conversation_id=NEW.id;
END;

CREATE TRIGGER api_hold_erasure AFTER UPDATE OF metadata_json ON contacts WHEN json_extract(NEW.metadata_json,'$.is_erasing')=1 OR json_extract(NEW.metadata_json,'$.is_erased')=1 BEGIN
 INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT NEW.project_id,NEW.id,'media',json_extract(file.value,'$.id'),json_extract(file.value,'$.objectKey') FROM suspended_emails held JOIN api_requests r ON r.held_id=held.id,json_each(held.input_json,'$.attachments') file WHERE r.project_id=NEW.project_id AND r.contact_id=NEW.id;
 DELETE FROM suspended_emails WHERE id IN (SELECT held_id FROM api_requests WHERE project_id=NEW.project_id AND contact_id=NEW.id);
END;

CREATE TRIGGER api_upload_erasure AFTER UPDATE OF metadata_json ON contacts WHEN json_extract(NEW.metadata_json,'$.is_erasing')=1 OR json_extract(NEW.metadata_json,'$.is_erased')=1 BEGIN
 INSERT OR IGNORE INTO contact_erasure_objects(project_id,contact_id,kind,source_id,object_key) SELECT project_id,NEW.id,'media',id,object_key FROM api_uploads WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 DELETE FROM api_uploads WHERE project_id=NEW.project_id AND contact_id=NEW.id;
END;
CREATE TABLE api_denial_counts(project_id TEXT NOT NULL,credential_id TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(project_id,credential_id,window));
CREATE TRIGGER api_token_usage_audit AFTER INSERT ON integration_token_usage WHEN NEW.token_id IS NOT NULL BEGIN
 INSERT INTO api_denial_counts SELECT NEW.namespace,c.id,CAST(NEW.at/60000 AS INTEGER),1 FROM api_credentials c JOIN integration_tokens t ON t.namespace=c.namespace AND t.credential_id=c.id WHERE t.namespace=NEW.namespace AND t.id=NEW.token_id AND NEW.allowed=0
 ON CONFLICT(project_id,credential_id,window) DO UPDATE SET count=count+1;
 INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'api:first:'||NEW.namespace||':'||c.id,NEW.namespace,NEW.at,'access','credential.first_used','succeeded','api',c.id,'api','credential',c.id,json_object('credential_name',c.name,'source_product',c.source_product) FROM api_credentials c JOIN integration_tokens t ON t.namespace=c.namespace AND t.credential_id=c.id WHERE t.namespace=NEW.namespace AND t.id=NEW.token_id AND NEW.allowed=1;
 INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'api:denied:'||NEW.namespace||':'||c.id||':'||CAST(NEW.at/60000 AS INTEGER),NEW.namespace,NEW.at,'access','credential.denied','refused','api',c.id,'api','credential',c.id,json_object('count',1,'credential_name',c.name,'source_product',c.source_product) FROM api_credentials c JOIN integration_tokens t ON t.namespace=c.namespace AND t.credential_id=c.id WHERE t.namespace=NEW.namespace AND t.id=NEW.token_id AND NEW.allowed=0;
END;
CREATE TABLE api_upload_disposals(object_key TEXT PRIMARY KEY);
CREATE TRIGGER api_upload_dispose AFTER DELETE ON api_uploads BEGIN INSERT OR IGNORE INTO api_upload_disposals VALUES(OLD.object_key); END;
