-- Machine credentials extend the existing bearer grants; no second secret store.
ALTER TABLE integration_tokens ADD COLUMN source_product TEXT;
ALTER TABLE integration_tokens ADD COLUMN bindings_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE integration_tokens ADD COLUMN issuer_id TEXT;
ALTER TABLE integration_tokens ADD COLUMN display_prefix TEXT;
ALTER TABLE integration_tokens ADD COLUMN family_id TEXT;
ALTER TABLE integration_tokens ADD COLUMN create_minute INTEGER NOT NULL DEFAULT 20;
ALTER TABLE integration_tokens ADD COLUMN create_day INTEGER NOT NULL DEFAULT 1000;
CREATE TABLE api_requests(project_id TEXT NOT NULL,source_product TEXT NOT NULL,key_digest TEXT NOT NULL,body_digest TEXT NOT NULL,claim TEXT NOT NULL,created_at INTEGER NOT NULL,conversation_id TEXT,contact_id TEXT,status INTEGER,response_json TEXT,erased INTEGER NOT NULL DEFAULT 0,held_id TEXT,PRIMARY KEY(project_id,source_product,key_digest));
CREATE TABLE api_conversations(conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),project_id TEXT NOT NULL,credential_id TEXT NOT NULL,family_id TEXT NOT NULL,credential_name TEXT NOT NULL,source_product TEXT NOT NULL,source_ref TEXT,source_url TEXT,UNIQUE(project_id,source_product,source_ref));
CREATE TABLE api_requester_keys(project_id TEXT NOT NULL,digest TEXT NOT NULL,contact_id TEXT NOT NULL,PRIMARY KEY(project_id,digest,contact_id));
CREATE TABLE api_erased_keys(project_id TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(project_id,digest));
CREATE TRIGGER api_request_erasure AFTER UPDATE OF metadata_json ON contacts WHEN json_extract(NEW.metadata_json,'$.is_erasing')=1 OR json_extract(NEW.metadata_json,'$.is_erased')=1 BEGIN
 INSERT OR IGNORE INTO api_erased_keys SELECT project_id,digest FROM api_requester_keys WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 UPDATE api_requests SET response_json=NULL,erased=1 WHERE project_id=NEW.project_id AND contact_id=NEW.id;
 UPDATE api_conversations SET source_url=NULL WHERE conversation_id IN (SELECT id FROM conversations WHERE project_id=NEW.project_id AND contact_id=NEW.id);
 DELETE FROM api_requester_keys WHERE project_id=NEW.project_id AND contact_id=NEW.id;
END;
CREATE TABLE api_uploads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,family_id TEXT NOT NULL,object_key TEXT NOT NULL,filename TEXT NOT NULL,content_type TEXT NOT NULL,size INTEGER NOT NULL,expires_at INTEGER NOT NULL,contact_id TEXT);
CREATE TABLE api_appends(project_id TEXT NOT NULL,conversation_id TEXT NOT NULL,family_id TEXT NOT NULL,local_id TEXT NOT NULL,body_digest TEXT NOT NULL,response_json TEXT,contact_id TEXT NOT NULL,PRIMARY KEY(project_id,conversation_id,family_id,local_id));
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
 WHERE d.id=NEW.destination_id AND (
 (d.credential_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM api_conversations a WHERE a.conversation_id=e.conversation_id AND a.family_id=(SELECT family_id FROM integration_tokens WHERE namespace=d.project_id AND id=d.credential_id)))
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
CREATE TABLE api_denial_counts(project_id TEXT NOT NULL,token_id TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(project_id,token_id,window));
CREATE TRIGGER api_token_usage_audit AFTER INSERT ON integration_token_usage WHEN NEW.token_id IS NOT NULL BEGIN
 INSERT INTO api_denial_counts SELECT NEW.namespace,NEW.token_id,CAST(NEW.at/60000 AS INTEGER),1 FROM integration_tokens WHERE namespace=NEW.namespace AND id=NEW.token_id AND source_product IS NOT NULL AND NEW.allowed=0
 ON CONFLICT(project_id,token_id,window) DO UPDATE SET count=count+1;
 INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'api:first:'||NEW.namespace||':'||NEW.token_id,NEW.namespace,NEW.at,'access','credential.first_used','succeeded','api',NEW.token_id,'api','credential',NEW.token_id,json_object('credential_name',name,'source_product',source_product) FROM integration_tokens WHERE namespace=NEW.namespace AND id=NEW.token_id AND source_product IS NOT NULL AND NEW.allowed=1;
 INSERT OR IGNORE INTO audit_events(id,project_id,at,category,action,outcome,actor_type,actor_id,source,target_type,target_id,detail_json)
 SELECT 'api:denied:'||NEW.namespace||':'||NEW.token_id||':'||CAST(NEW.at/60000 AS INTEGER),NEW.namespace,NEW.at,'access','credential.denied','refused','api',NEW.token_id,'api','credential',NEW.token_id,json_object('count',1,'credential_name',name,'source_product',source_product) FROM integration_tokens WHERE namespace=NEW.namespace AND id=NEW.token_id AND source_product IS NOT NULL AND NEW.allowed=0;
END;
