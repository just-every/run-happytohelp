-- Preserve the resolution trigger byte-for-byte except whitespace at CASE boundaries.
-- The pinned Wrangler SQL splitter requires that boundary before punctuation.
DROP TRIGGER conversation_record_resolution;
CREATE TRIGGER conversation_record_resolution AFTER UPDATE OF resolved_at ON conversations WHEN NEW.resolved_at IS NOT NULL AND (OLD.resolved_at IS NULL OR NEW.revision>OLD.revision) AND EXISTS(SELECT 1 FROM conversation_tracking WHERE conversation_id=NEW.id) BEGIN
 UPDATE conversation_resolutions SET reopened_at=NEW.updated_at WHERE OLD.resolved_at IS NOT NULL AND conversation_id=NEW.id AND ordinal=(SELECT MAX(ordinal) FROM conversation_resolutions WHERE conversation_id=NEW.id) AND reopened_at IS NULL;
 INSERT INTO conversation_resolutions(id,project_id,conversation_id,contact_id,ordinal,resolved_at,resolved_revision,cycle_start_revision,outcome,evidence_json)
 SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.id,NEW.contact_id,COALESCE((SELECT MAX(ordinal)+1 FROM conversation_resolutions WHERE conversation_id=NEW.id),1),NEW.resolved_at,NEW.revision,t.cycle_start_revision,
 CASE
  WHEN EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=NEW.id AND m.revision>t.cycle_start_revision AND m.revision<=NEW.revision AND a.kind='assisted' AND COALESCE(a.source_kind,'')<>'insight') THEN 'assisted'
  WHEN EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=NEW.id AND m.revision>t.cycle_start_revision AND m.revision<=NEW.revision AND a.kind='human' AND COALESCE(a.source_kind,'')<>'insight') THEN 'human'
  WHEN t.cycle_history_complete=1 AND NEW.assigned_to IS NULL
   AND EXISTS(SELECT 1 FROM messages m JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=NEW.id AND m.revision>t.cycle_start_revision AND m.revision<=NEW.revision AND a.kind='ai' AND COALESCE(a.source_kind,'')<>'insight')
   AND NOT EXISTS(SELECT 1 FROM messages m LEFT JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=NEW.id AND m.revision>t.cycle_start_revision AND m.revision<=NEW.revision AND m.actor_role<>'contact' AND COALESCE(a.source_kind,'')<>'insight' AND COALESCE(a.kind,'unknown')<>'ai')
   AND NOT EXISTS(SELECT 1 FROM conversation_handoffs h WHERE h.conversation_id=NEW.id AND h.cycle_epoch=t.cycle_epoch) THEN 'ai'
  ELSE 'unknown' END ,
 json_object('historyComplete',t.cycle_history_complete,'messages',json((SELECT json_group_array(json_object('id',m.id,'kind',COALESCE(a.kind,'unknown'),'source',a.source_kind,'sourceId',a.source_id)) FROM messages m LEFT JOIN message_authorship a ON a.message_id=m.id WHERE m.conversation_id=NEW.id AND m.revision>t.cycle_start_revision AND m.revision<=NEW.revision AND m.actor_role<>'contact' AND COALESCE(a.source_kind,'')<>'insight')))
 FROM conversation_tracking t WHERE t.conversation_id=NEW.id;
 UPDATE conversation_tracking SET first_resolved_at= CASE WHEN initial_history_complete=1 THEN COALESCE(first_resolved_at,NEW.resolved_at) ELSE first_resolved_at END ,cycle_start_revision=NEW.revision,cycle_start_at=NEW.resolved_at,cycle_history_complete=1 WHERE conversation_id=NEW.id;
END;
