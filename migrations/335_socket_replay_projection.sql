-- Raw replay data follows the native rows; visibility and knowledge rendering
-- remain read-time decisions. Nullable columns allow deferred-FK archive restore.
ALTER TABLE conversation_outbox ADD COLUMN message_json TEXT;
ALTER TABLE conversation_outbox ADD COLUMN media_json TEXT;

UPDATE conversation_outbox SET (message_json,media_json)=(
 SELECT json_object(
  'id',m.id,'project_id',m.project_id,'conversation_id',m.conversation_id,
  'local_id',m.local_id,'actor_id',m.actor_id,'actor_role',m.actor_role,
  'content',m.content,'revision',m.revision,'created_at',m.created_at,
  'intent_hash',m.intent_hash,'bucket_id',m.bucket_id,'erased_at',m.erased_at,
  'citations_json',m.citations_json,'content_raw',m.content_raw
 ),(
  SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
  FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=m.id ORDER BY rowid)
 ) FROM messages m WHERE m.id=conversation_outbox.message_id
);

CREATE TRIGGER socket_replay_outbox_insert AFTER INSERT ON conversation_outbox BEGIN
 UPDATE conversation_outbox SET (message_json,media_json)=(
  SELECT json_object(
   'id',m.id,'project_id',m.project_id,'conversation_id',m.conversation_id,
   'local_id',m.local_id,'actor_id',m.actor_id,'actor_role',m.actor_role,
   'content',m.content,'revision',m.revision,'created_at',m.created_at,
   'intent_hash',m.intent_hash,'bucket_id',m.bucket_id,'erased_at',m.erased_at,
   'citations_json',m.citations_json,'content_raw',m.content_raw
  ),(
   SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
   FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=m.id ORDER BY rowid)
  ) FROM messages m WHERE m.id=conversation_outbox.message_id
 ) WHERE id=NEW.id;
END;

-- Imports may insert the outbox before its message. Read the current table on
-- updates too, so nested native erasure triggers cannot restore stale raw text.
CREATE TRIGGER socket_replay_message_insert AFTER INSERT ON messages BEGIN
 UPDATE conversation_outbox SET (message_json,media_json)=(
  SELECT json_object(
   'id',m.id,'project_id',m.project_id,'conversation_id',m.conversation_id,
   'local_id',m.local_id,'actor_id',m.actor_id,'actor_role',m.actor_role,
   'content',m.content,'revision',m.revision,'created_at',m.created_at,
   'intent_hash',m.intent_hash,'bucket_id',m.bucket_id,'erased_at',m.erased_at,
   'citations_json',m.citations_json,'content_raw',m.content_raw
  ),(
   SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
   FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=m.id ORDER BY rowid)
  ) FROM messages m WHERE m.id=conversation_outbox.message_id
 ) WHERE message_id=NEW.id;
END;

CREATE TRIGGER socket_replay_message_update AFTER UPDATE ON messages BEGIN
 UPDATE conversation_outbox SET (message_json,media_json)=(
  SELECT json_object(
   'id',m.id,'project_id',m.project_id,'conversation_id',m.conversation_id,
   'local_id',m.local_id,'actor_id',m.actor_id,'actor_role',m.actor_role,
   'content',m.content,'revision',m.revision,'created_at',m.created_at,
   'intent_hash',m.intent_hash,'bucket_id',m.bucket_id,'erased_at',m.erased_at,
   'citations_json',m.citations_json,'content_raw',m.content_raw
  ),(
   SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
   FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=m.id ORDER BY rowid)
  ) FROM messages m WHERE m.id=conversation_outbox.message_id
 ) WHERE message_id=NEW.id;
END;

CREATE TRIGGER socket_replay_media_insert AFTER INSERT ON media WHEN NEW.message_id IS NOT NULL BEGIN
 UPDATE conversation_outbox SET media_json=(
  SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
  FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=conversation_outbox.message_id ORDER BY rowid)
 ) WHERE message_id=NEW.message_id;
END;

CREATE TRIGGER socket_replay_media_update AFTER UPDATE ON media WHEN OLD.message_id IS NOT NULL OR NEW.message_id IS NOT NULL BEGIN
 UPDATE conversation_outbox SET media_json=(
  SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
  FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=conversation_outbox.message_id ORDER BY rowid)
 ) WHERE message_id IN (OLD.message_id,NEW.message_id);
END;

CREATE TRIGGER socket_replay_media_delete AFTER DELETE ON media WHEN OLD.message_id IS NOT NULL BEGIN
 UPDATE conversation_outbox SET media_json=(
  SELECT json_group_array(json_object('id',id,'filename',filename,'content_type',content_type,'size',size))
  FROM (SELECT id,filename,content_type,size FROM media WHERE message_id=conversation_outbox.message_id ORDER BY rowid)
 ) WHERE message_id=OLD.message_id;
END;
