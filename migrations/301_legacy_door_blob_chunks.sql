-- SQL-only legacy effects commit their rows and bytes under the existing kit journal.
CREATE TABLE legacy_door_blob_chunks(project_id TEXT NOT NULL,media_id TEXT NOT NULL,object_key TEXT NOT NULL,file_name TEXT NOT NULL,sha256 TEXT NOT NULL,ordinal INTEGER NOT NULL,total_chunks INTEGER NOT NULL,total_bytes INTEGER NOT NULL,chunk_sha256 TEXT NOT NULL,identity_json TEXT NOT NULL,base64 TEXT NOT NULL,PRIMARY KEY(project_id,media_id,ordinal));
CREATE TABLE legacy_door_targets(project_id TEXT NOT NULL,target_id TEXT NOT NULL,table_name TEXT NOT NULL,keys_json TEXT NOT NULL,revision TEXT NOT NULL,source_json TEXT NOT NULL,value_json TEXT,PRIMARY KEY(project_id,target_id));
CREATE INDEX legacy_door_targets_table ON legacy_door_targets(project_id,table_name);
CREATE TABLE legacy_door_holds(project_id TEXT NOT NULL,source_table TEXT NOT NULL,source_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(project_id,source_table,source_id,reason));
-- This row exists only within one atomic target mutation. Ordinary requests
-- never observe it. Historical effects explicitly supply their dependent rows;
-- live mutation triggers would otherwise create unjournaled history or authority.
CREATE TABLE legacy_door_native_fence(singleton INTEGER PRIMARY KEY CHECK(singleton=1));

DROP TRIGGER ai_contact_changed;
CREATE TRIGGER ai_contact_changed AFTER UPDATE OF name,email ON contacts WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.id; END;

DROP TRIGGER ai_note_added;
CREATE TRIGGER ai_note_added AFTER INSERT ON conversation_notes WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE (project_id,subject_id) IN (SELECT project_id,contact_id FROM conversations WHERE id=NEW.conversation_id); END;

DROP TRIGGER ai_note_changed;
CREATE TRIGGER ai_note_changed AFTER UPDATE ON conversation_notes WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE (project_id,subject_id) IN (SELECT project_id,contact_id FROM conversations WHERE id IN (OLD.conversation_id,NEW.conversation_id)); END;

DROP TRIGGER ai_note_removed;
CREATE TRIGGER ai_note_removed AFTER DELETE ON conversation_notes WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE (project_id,subject_id) IN (SELECT project_id,contact_id FROM conversations WHERE id=OLD.conversation_id); END;

DROP TRIGGER ai_profile_configuration_changed;
CREATE TRIGGER ai_profile_configuration_changed AFTER UPDATE ON ai_profiles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id IN (OLD.project_id,NEW.project_id); END;

DROP TRIGGER ai_project_settings_added;
CREATE TRIGGER ai_project_settings_added AFTER INSERT ON project_settings WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id; END;

DROP TRIGGER ai_project_settings_changed;
CREATE TRIGGER ai_project_settings_changed AFTER UPDATE ON project_settings WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id; END;

DROP TRIGGER ai_project_settings_removed;
CREATE TRIGGER ai_project_settings_removed AFTER DELETE ON project_settings WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=OLD.project_id; END;

DROP TRIGGER api_assignment_event;
CREATE TRIGGER api_assignment_event AFTER UPDATE OF assigned_to ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.assigned_to IS NOT OLD.assigned_to) BEGIN
 INSERT INTO native_integration_events SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.id,NEW.contact_id,'conversation.assigned',json_object('conversation_id',NEW.id,'assigned_to',NEW.assigned_to,'source_product',a.source_product,'source_ref',a.source_ref),NEW.updated_at,NULL FROM (SELECT 1) LEFT JOIN api_conversations a ON a.conversation_id=NEW.id;
END;

DROP TRIGGER api_status_event;
CREATE TRIGGER api_status_event AFTER UPDATE OF status_id,status_category ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status_id<>OLD.status_id OR NEW.status_category<>OLD.status_category) BEGIN
 INSERT INTO native_integration_events SELECT lower(hex(randomblob(16))),NEW.project_id,NEW.id,NEW.contact_id,'conversation.status_changed',json_object('conversation_id',NEW.id,'previous_status_id',OLD.status_id,'previous_status_category',OLD.status_category,'status_id',NEW.status_id,'status_category',NEW.status_category,'source_product',a.source_product,'source_ref',a.source_ref),NEW.updated_at,NULL FROM (SELECT 1) LEFT JOIN api_conversations a ON a.conversation_id=NEW.id;
END;

DROP TRIGGER context_action_added;
CREATE TRIGGER context_action_added AFTER INSERT ON context_actions WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; UPDATE context_collectors SET actions_count=actions_count+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_action_changed;
CREATE TRIGGER context_action_changed AFTER UPDATE ON context_actions WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_action_removed;
CREATE TRIGGER context_action_removed AFTER DELETE ON context_actions WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=OLD.project_id AND subject_id=OLD.subject_id; END;

DROP TRIGGER context_consent_changed;
CREATE TRIGGER context_consent_changed AFTER UPDATE OF consent,help_types,bot_enabled ON context_subjects WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_conversation_created;
CREATE TRIGGER context_conversation_created AFTER INSERT ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 INSERT OR IGNORE INTO context_subjects(project_id,subject_id) VALUES(NEW.project_id,NEW.contact_id);
END;

DROP TRIGGER context_customer_created;
CREATE TRIGGER context_customer_created AFTER INSERT ON contacts WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 INSERT OR IGNORE INTO context_subjects(project_id,subject_id) VALUES(NEW.project_id,NEW.id);
END;

DROP TRIGGER context_dataset_removed;
CREATE TRIGGER context_dataset_removed BEFORE DELETE ON knowledge_datasets WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=OLD.project_id; END;

DROP TRIGGER context_document_added;
CREATE TRIGGER context_document_added AFTER INSERT ON knowledge_documents WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id IN (SELECT project_id FROM knowledge_datasets WHERE published_version=NEW.version_id); END;

DROP TRIGGER context_document_changed;
CREATE TRIGGER context_document_changed AFTER UPDATE ON knowledge_documents WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id IN (SELECT project_id FROM knowledge_datasets WHERE published_version IN (OLD.version_id,NEW.version_id)); END;

DROP TRIGGER context_document_removed;
CREATE TRIGGER context_document_removed BEFORE DELETE ON knowledge_documents WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id IN (SELECT project_id FROM knowledge_datasets WHERE published_version=OLD.version_id); END;

DROP TRIGGER context_evidence_added;
CREATE TRIGGER context_evidence_added AFTER INSERT ON context_evidence WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_evidence_changed;
CREATE TRIGGER context_evidence_changed AFTER UPDATE ON context_evidence WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_evidence_removed;
CREATE TRIGGER context_evidence_removed AFTER DELETE ON context_evidence WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=OLD.project_id AND subject_id=OLD.subject_id; END;

DROP TRIGGER context_insight_added;
CREATE TRIGGER context_insight_added AFTER INSERT ON context_insights WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_insight_dismissed;
CREATE TRIGGER context_insight_dismissed AFTER UPDATE OF dismissed_at ON context_insights WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_knowledge_published;
CREATE TRIGGER context_knowledge_published AFTER UPDATE OF published_version ON knowledge_datasets WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id; END;

DROP TRIGGER context_message_added;
CREATE TRIGGER context_message_added AFTER INSERT ON messages WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.conversation_id)) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id IN (SELECT contact_id FROM conversations WHERE id=NEW.conversation_id AND project_id=NEW.project_id UNION SELECT NEW.actor_id); END;

DROP TRIGGER context_message_changed;
CREATE TRIGGER context_message_changed AFTER UPDATE OF content ON messages WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id; END;

DROP TRIGGER context_message_removed;
CREATE TRIGGER context_message_removed AFTER DELETE ON messages WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=OLD.project_id AND f.conversation_id=OLD.conversation_id)) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=OLD.project_id; END;

DROP TRIGGER context_profile_changed;
CREATE TRIGGER context_profile_changed AFTER UPDATE OF profile ON context_profiles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_project_changed;
CREATE TRIGGER context_project_changed AFTER UPDATE OF name ON projects WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.id; END;

DROP TRIGGER context_summary_added;
CREATE TRIGGER context_summary_added AFTER INSERT ON context_summaries WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_summary_changed;
CREATE TRIGGER context_summary_changed AFTER UPDATE ON context_summaries WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=NEW.project_id AND subject_id=NEW.subject_id; END;

DROP TRIGGER context_summary_removed;
CREATE TRIGGER context_summary_removed AFTER DELETE ON context_summaries WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE context_subjects SET revision=revision+1 WHERE project_id=OLD.project_id AND subject_id=OLD.subject_id; END;

DROP TRIGGER edition_article_category_delete;
CREATE TRIGGER edition_article_category_delete AFTER DELETE ON knowledge_article_categories WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE knowledge_articles SET source_revision=source_revision+1 WHERE id=OLD.article_id; END;

DROP TRIGGER edition_article_category_insert;
CREATE TRIGGER edition_article_category_insert AFTER INSERT ON knowledge_article_categories WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE knowledge_articles SET source_revision=source_revision+1 WHERE id=NEW.article_id; END;

DROP TRIGGER edition_article_category_update;
CREATE TRIGGER edition_article_category_update AFTER UPDATE ON knowledge_article_categories WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE knowledge_articles SET source_revision=source_revision+1 WHERE id IN (OLD.article_id,NEW.article_id); END;

DROP TRIGGER edition_article_incarnation;
CREATE TRIGGER edition_article_incarnation AFTER INSERT ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE knowledge_articles SET source_incarnation=lower(hex(randomblob(16))) WHERE id=NEW.id; END;

DROP TRIGGER edition_article_revision;
CREATE TRIGGER edition_article_revision AFTER UPDATE ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.source_revision=OLD.source_revision) BEGIN UPDATE knowledge_articles SET source_revision=source_revision+1 WHERE id=NEW.id; END;

DROP TRIGGER edition_category_delete;
CREATE TRIGGER edition_category_delete BEFORE DELETE ON knowledge_categories WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 UPDATE knowledge_articles SET source_revision=source_revision+1
 WHERE project_id=OLD.project_id AND (
  category_id IN (WITH RECURSIVE descendants(id) AS (SELECT OLD.id UNION SELECT c.id FROM knowledge_categories c JOIN descendants d ON c.parent_id=d.id WHERE c.project_id=OLD.project_id) SELECT id FROM descendants)
  OR id IN (SELECT article_id FROM knowledge_article_categories WHERE category_id IN (WITH RECURSIVE descendants(id) AS (SELECT OLD.id UNION SELECT c.id FROM knowledge_categories c JOIN descendants d ON c.parent_id=d.id WHERE c.project_id=OLD.project_id) SELECT id FROM descendants))
 );
END;

DROP TRIGGER edition_category_update;
CREATE TRIGGER edition_category_update AFTER UPDATE ON knowledge_categories WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE knowledge_articles SET source_revision=source_revision+1 WHERE project_id IN (OLD.project_id,NEW.project_id); END;

DROP TRIGGER edition_member_delete;
CREATE TRIGGER edition_member_delete AFTER DELETE ON memberships WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE edition_audiences SET revision=revision+1 WHERE project_id=OLD.project_id; END;

DROP TRIGGER edition_member_insert;
CREATE TRIGGER edition_member_insert AFTER INSERT ON memberships WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE edition_audiences SET revision=revision+1 WHERE project_id=NEW.project_id; END;

DROP TRIGGER edition_member_update;
CREATE TRIGGER edition_member_update AFTER UPDATE ON memberships WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE edition_audiences SET revision=revision+1 WHERE project_id IN (OLD.project_id,NEW.project_id); END;

DROP TRIGGER knowledge_article_slug_redirect;
CREATE TRIGGER knowledge_article_slug_redirect AFTER UPDATE OF slug ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.slug<>NEW.slug) BEGIN
 INSERT INTO knowledge_slug_redirects VALUES(NEW.project_id,OLD.slug,NEW.id,NEW.updated_at) ON CONFLICT(project_id,slug) DO UPDATE SET article_id=excluded.article_id,created_at=excluded.created_at;
 DELETE FROM knowledge_slug_redirects WHERE project_id=NEW.project_id AND slug=NEW.slug AND article_id=NEW.id;
END;

DROP TRIGGER knowledge_article_snapshot_insert;
CREATE TRIGGER knowledge_article_snapshot_insert AFTER INSERT ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 INSERT INTO knowledge_article_history VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.id,json_object('slug',NEW.slug,'title',NEW.title,'content',NEW.content,'summary',NEW.summary,'status',NEW.status),NEW.editor_id,NEW.updated_at);
END;

DROP TRIGGER knowledge_article_snapshot_update;
CREATE TRIGGER knowledge_article_snapshot_update AFTER UPDATE OF slug,title,content,summary,status ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.slug<>NEW.slug OR OLD.title<>NEW.title OR OLD.content<>NEW.content OR OLD.summary<>NEW.summary OR OLD.status<>NEW.status) BEGIN
 INSERT INTO knowledge_article_history VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.id,json_object('slug',NEW.slug,'title',NEW.title,'content',NEW.content,'summary',NEW.summary,'status',NEW.status),NEW.editor_id,NEW.updated_at);
END;

DROP TRIGGER knowledge_category_audience_revision;
CREATE TRIGGER knowledge_category_audience_revision AFTER UPDATE OF audience,allowed_domains ON knowledge_categories WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 UPDATE knowledge_articles SET source_revision=source_revision+1 WHERE project_id=NEW.project_id;
END;

DROP TRIGGER knowledge_index_answer_insert;
CREATE TRIGGER knowledge_index_answer_insert AFTER INSERT ON knowledge_reply_blocks WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.kind='answer') BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'generation:'||NEW.generation_id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

DROP TRIGGER knowledge_index_article_delete;
CREATE TRIGGER knowledge_index_article_delete BEFORE DELETE ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.status='published' OR EXISTS(SELECT 1 FROM knowledge_source_index WHERE project_id=OLD.project_id AND source_id='article:'||OLD.id) OR EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=OLD.project_id AND article_id=OLD.id) OR EXISTS(SELECT 1 FROM knowledge_translation_publications WHERE project_id=OLD.project_id AND article_id=OLD.id)) BEGIN
 INSERT INTO knowledge_index_dirty VALUES(OLD.project_id,'article:'||OLD.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;

DROP TRIGGER knowledge_index_article_insert;
CREATE TRIGGER knowledge_index_article_insert AFTER INSERT ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status='published') BEGIN
 INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'article:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;

DROP TRIGGER knowledge_index_article_update;
CREATE TRIGGER knowledge_index_article_update AFTER UPDATE ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status='published' OR OLD.status='published' OR EXISTS(SELECT 1 FROM knowledge_source_index WHERE project_id=NEW.project_id AND source_id='article:'||NEW.id) OR EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=NEW.project_id AND article_id=NEW.id) OR EXISTS(SELECT 1 FROM knowledge_translation_publications WHERE project_id=NEW.project_id AND article_id=NEW.id)) BEGIN
 INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'article:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;

DROP TRIGGER knowledge_index_dataset_publication;
CREATE TRIGGER knowledge_index_dataset_publication AFTER UPDATE OF published_version ON knowledge_datasets
 WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.published_version IS NOT OLD.published_version) BEGIN
 INSERT INTO knowledge_index_dirty(project_id,source_id,stamp)
  SELECT NEW.project_id,'knowledge:'||f.id,lower(hex(randomblob(16)))
  FROM knowledge_documents f JOIN knowledge_versions v ON v.id=f.version_id
  WHERE v.dataset_id=NEW.id AND f.version_id=NEW.published_version
  ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;

DROP TRIGGER knowledge_index_document_insert;
CREATE TRIGGER knowledge_index_document_insert AFTER INSERT ON knowledge_documents WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'knowledge:'||NEW.id,lower(hex(randomblob(16))) FROM knowledge_datasets d JOIN knowledge_versions v ON v.dataset_id=d.id WHERE v.id=NEW.version_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

DROP TRIGGER knowledge_index_document_update;
CREATE TRIGGER knowledge_index_document_update AFTER UPDATE ON knowledge_documents WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'knowledge:'||NEW.id,lower(hex(randomblob(16))) FROM knowledge_datasets d JOIN knowledge_versions v ON v.dataset_id=d.id WHERE v.id=NEW.version_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

DROP TRIGGER knowledge_index_generation_output;
CREATE TRIGGER knowledge_index_generation_output AFTER UPDATE OF output_json ON ai_generations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.output_json IS NOT NULL AND EXISTS(SELECT 1 FROM ai_generation_sources WHERE generation_id=NEW.id)) BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'generation:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

DROP TRIGGER knowledge_index_translation_insert;
CREATE TRIGGER knowledge_index_translation_insert AFTER INSERT ON knowledge_translations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'article:'||id,lower(hex(randomblob(16))) FROM knowledge_articles WHERE id=NEW.article_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

DROP TRIGGER knowledge_index_translation_update;
CREATE TRIGGER knowledge_index_translation_update AFTER UPDATE ON knowledge_translations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'article:'||id,lower(hex(randomblob(16))) FROM knowledge_articles WHERE id=NEW.article_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

DROP TRIGGER macro_saved_reply_insert;
CREATE TRIGGER macro_saved_reply_insert AFTER INSERT ON macros WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 INSERT INTO macro_heads(macro_id) VALUES(NEW.id);
 INSERT INTO macro_versions(macro_id,project_id,version,title,content,created_by,created_at) VALUES(NEW.id,NEW.project_id,1,NEW.title,NEW.content,NEW.created_by,NEW.updated_at);
END;

DROP TRIGGER ticket_conversation_defaults;
CREATE TRIGGER ticket_conversation_defaults AFTER INSERT ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 UPDATE conversations SET brand_id=NEW.project_id,requester_id=NEW.contact_id,submitter_id=COALESCE(NEW.submitter_id,NEW.contact_id),status_id= CASE WHEN EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) THEN NEW.status_id WHEN NEW.resolved_at IS NOT NULL THEN 'solved' ELSE NEW.status_id END ,status_category= CASE WHEN EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) THEN NEW.status_category WHEN NEW.resolved_at IS NOT NULL THEN 'solved' ELSE NEW.status_category END WHERE id=NEW.id;
END;

DROP TRIGGER ticket_history_update;
CREATE TRIGGER ticket_history_update AFTER UPDATE OF status_id,subject,priority,channel,brand_id,group_id,requester_id,submitter_id,submitter_type ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NOT EXISTS(SELECT 1 FROM ticket_history WHERE conversation_id=NEW.id AND at=NEW.updated_at AND actor_id IS NEW.ticket_actor_id AND source=NEW.ticket_source) AND (NEW.status_id<>OLD.status_id OR NEW.subject<>OLD.subject OR NEW.priority<>OLD.priority OR NEW.channel<>OLD.channel OR NEW.brand_id IS NOT OLD.brand_id OR NEW.group_id IS NOT OLD.group_id OR NEW.requester_id IS NOT OLD.requester_id OR NEW.submitter_id IS NOT OLD.submitter_id OR NEW.submitter_type<>OLD.submitter_type)) BEGIN
 INSERT INTO ticket_history VALUES(lower(hex(randomblob(16))),NEW.project_id,NEW.id,NEW.ticket_actor_id,NEW.ticket_actor_type,NEW.ticket_source,NEW.updated_at,json_object('status_id',json_object('from',OLD.status_id,'to',NEW.status_id),'status_category',json_object('from',OLD.status_category,'to',NEW.status_category),'subject',json_object('from',OLD.subject,'to',NEW.subject),'priority',json_object('from',OLD.priority,'to',NEW.priority),'channel',json_object('from',OLD.channel,'to',NEW.channel),'brand_id',json_object('from',OLD.brand_id,'to',NEW.brand_id),'group_id',json_object('from',OLD.group_id,'to',NEW.group_id),'requester_id',json_object('from',OLD.requester_id,'to',NEW.requester_id),'submitter_id',json_object('from',OLD.submitter_id,'to',NEW.submitter_id),'submitter_type',json_object('from',OLD.submitter_type,'to',NEW.submitter_type)));
END;

DROP TRIGGER ticket_legacy_resolution;
CREATE TRIGGER ticket_legacy_resolution AFTER UPDATE OF resolved_at ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status_id=OLD.status_id AND NEW.status_category=OLD.status_category AND ((NEW.resolved_at IS NULL AND OLD.resolved_at IS NOT NULL) OR (NEW.resolved_at IS NOT NULL AND OLD.resolved_at IS NULL))) BEGIN
 UPDATE conversations SET status_id= CASE WHEN NEW.resolved_at IS NULL THEN 'open' ELSE 'solved' END ,status_category= CASE WHEN NEW.resolved_at IS NULL THEN 'open' ELSE 'solved' END WHERE id=NEW.id;
END;

DROP TRIGGER ticket_version_update;
CREATE TRIGGER ticket_version_update AFTER UPDATE OF updated_at,revision ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN UPDATE conversations SET ticket_version=OLD.ticket_version+1 WHERE id=NEW.id; END;

DROP TRIGGER workflow_schedule_cancel;
CREATE TRIGGER workflow_schedule_cancel AFTER UPDATE OF revision,assigned_to,group_id ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.assigned_to IS NOT OLD.assigned_to OR NEW.group_id IS NOT OLD.group_id OR NEW.revision<>OLD.revision AND (SELECT actor_role FROM messages WHERE id=NEW.last_message_id)='contact') BEGIN
 UPDATE workflow_schedules SET state=CASE WHEN kind='snooze' AND NEW.revision<>OLD.revision THEN 'woken' ELSE 'cancelled' END,reason=CASE WHEN NEW.assigned_to IS NOT OLD.assigned_to OR NEW.group_id IS NOT OLD.group_id THEN 'Ticket reassigned' ELSE 'Customer replied' END,updated_at=NEW.updated_at,version=version+1 WHERE conversation_id=NEW.id AND state='pending';
END;

-- Byte comparison stays exact without sending the complete object back as a
-- SELECT parameter. The immutable journal image and every native edit share an
-- invalidating revision; kit writes replace both inside their atomic fence.
CREATE TRIGGER legacy_door_blob_changed AFTER UPDATE ON legacy_door_blob_chunks WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 UPDATE legacy_door_targets SET revision='native-edit:'||lower(hex(randomblob(16))) WHERE project_id=NEW.project_id AND table_name='legacy_door_blob_chunks' AND json_extract(keys_json,'$[0]')=NEW.project_id AND json_extract(keys_json,'$[1]')=NEW.media_id AND json_extract(keys_json,'$[2]')=NEW.ordinal;
END;
CREATE TRIGGER legacy_door_blob_removed AFTER DELETE ON legacy_door_blob_chunks WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) BEGIN
 UPDATE legacy_door_targets SET revision='native-edit:'||lower(hex(randomblob(16))) WHERE project_id=OLD.project_id AND table_name='legacy_door_blob_chunks' AND json_extract(keys_json,'$[0]')=OLD.project_id AND json_extract(keys_json,'$[1]')=OLD.media_id AND json_extract(keys_json,'$[2]')=OLD.ordinal;
END;
CREATE TRIGGER legacy_door_custody_changed AFTER UPDATE ON legacy_door_targets WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND NEW.revision NOT LIKE 'native-edit:%' BEGIN
 UPDATE legacy_door_targets SET revision='native-edit:'||lower(hex(randomblob(16))) WHERE project_id=NEW.project_id AND target_id=NEW.target_id;
END;

DROP TRIGGER workflow_created;
CREATE TRIGGER workflow_created AFTER UPDATE OF last_message_id ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.last_message_id IS NULL AND NEW.last_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=NEW.project_id AND e.contact_id=NEW.contact_id)) BEGIN
 INSERT OR IGNORE INTO workflow_events(id,event_key,project_id,conversation_id,kind,at,source,revision,last_message_id,ticket_version,after_json) VALUES((SELECT next_id FROM workflow_event_sequence WHERE id=1),'created:'||NEW.id,NEW.project_id,NEW.id,'created',NEW.updated_at,NEW.ticket_source,NEW.revision,NEW.last_message_id,NEW.ticket_version,json_object('status_id',NEW.status_id,'status_category',NEW.status_category,'assigned_to',NEW.assigned_to,'group_id',NEW.group_id,'subject',NEW.subject,'priority',NEW.priority,'channel',NEW.channel,'brand_id',NEW.brand_id,'requester_id',NEW.requester_id,'contact_id',NEW.contact_id,'revision',NEW.revision,'last_message_id',NEW.last_message_id,'ticket_version',NEW.ticket_version,'actor_role',(SELECT actor_role FROM messages WHERE id=NEW.last_message_id)));
END;

DROP TRIGGER workflow_changed;
CREATE TRIGGER workflow_changed AFTER UPDATE OF revision,status_id,status_category,priority,assigned_to,group_id,subject,channel ON conversations WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.last_message_id IS NOT NULL AND NEW.last_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM move_in_native_fences f WHERE f.project_id=NEW.project_id AND f.conversation_id=NEW.id) AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=NEW.project_id AND e.contact_id=NEW.contact_id) AND ((NEW.revision<>OLD.revision AND (SELECT actor_role FROM messages WHERE id=NEW.last_message_id) IS NOT 'system') OR NEW.status_id<>OLD.status_id OR NEW.status_category<>OLD.status_category OR NEW.priority<>OLD.priority OR NEW.assigned_to IS NOT OLD.assigned_to OR NEW.group_id IS NOT OLD.group_id OR NEW.subject<>OLD.subject OR NEW.channel<>OLD.channel)) BEGIN
 INSERT OR IGNORE INTO workflow_events(id,event_key,project_id,conversation_id,kind,at,source,revision,last_message_id,ticket_version,before_json,after_json) VALUES((SELECT next_id FROM workflow_event_sequence WHERE id=1),CASE WHEN NEW.revision<>OLD.revision THEN 'message:'||NEW.last_message_id ELSE 'changed:'||lower(hex(randomblob(16))) END,NEW.project_id,NEW.id,CASE WHEN NEW.revision<>OLD.revision AND (SELECT actor_role FROM messages WHERE id=NEW.last_message_id)='contact' THEN 'customer_reply' WHEN NEW.revision<>OLD.revision AND (SELECT actor_role FROM messages WHERE id=NEW.last_message_id) IS NOT 'system' THEN 'operator_reply' ELSE 'changed' END,NEW.updated_at,NEW.ticket_source,NEW.revision,NEW.last_message_id,NEW.ticket_version,json_object('status_id',OLD.status_id,'status_category',OLD.status_category,'assigned_to',OLD.assigned_to,'group_id',OLD.group_id,'subject',OLD.subject,'priority',OLD.priority,'channel',OLD.channel,'brand_id',OLD.brand_id,'requester_id',OLD.requester_id,'contact_id',OLD.contact_id,'revision',OLD.revision,'last_message_id',OLD.last_message_id,'ticket_version',OLD.ticket_version),json_patch(json_object('status_id',NEW.status_id,'status_category',NEW.status_category,'assigned_to',NEW.assigned_to,'group_id',NEW.group_id,'subject',NEW.subject,'priority',NEW.priority,'channel',NEW.channel,'brand_id',NEW.brand_id,'requester_id',NEW.requester_id,'contact_id',NEW.contact_id,'revision',NEW.revision,'last_message_id',NEW.last_message_id,'ticket_version',NEW.ticket_version),json_object('message_id',CASE WHEN NEW.revision<>OLD.revision THEN NEW.last_message_id ELSE NULL END,'actor_role',CASE WHEN NEW.revision<>OLD.revision THEN (SELECT actor_role FROM messages WHERE id=NEW.last_message_id) ELSE NULL END,'is_note',0)));
END;

DROP TRIGGER managed_revoke_destinations;
CREATE TRIGGER managed_revoke_destinations AFTER UPDATE OF revoked_at ON api_credentials WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.revoked_at IS NOT NULL) BEGIN
 UPDATE native_integration_destinations SET enabled=0 WHERE project_id=NEW.namespace AND credential_id=NEW.id;
END;

DROP TRIGGER managed_contact_created;
CREATE TRIGGER managed_contact_created AFTER INSERT ON contacts
WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (coalesce(NEW.external_id,'') NOT LIKE 'import:%' AND coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=0) BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NEW.id,'contact.created',json_object('contact_id',NEW.id),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),NULL);
END;

DROP TRIGGER managed_contact_updated;
CREATE TRIGGER managed_contact_updated AFTER UPDATE OF name,email,external_id,metadata_json ON contacts
WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (coalesce(NEW.external_id,'') NOT LIKE 'import:%' AND coalesce(json_extract(NEW.metadata_json,'$.is_erased'),0)=0 AND coalesce(json_extract(NEW.metadata_json,'$.is_erasing'),0)=0 AND (NEW.name IS NOT OLD.name OR NEW.email IS NOT OLD.email OR NEW.external_id IS NOT OLD.external_id OR NEW.metadata_json IS NOT OLD.metadata_json)) BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NEW.id,'contact.updated',json_object('contact_id',NEW.id),CAST((julianday('now')-2440587.5)*86400000 AS INTEGER),NULL);
END;

DROP TRIGGER managed_article_created;
CREATE TRIGGER managed_article_created AFTER INSERT ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status='published' AND NEW.slug NOT LIKE 'import-%') BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NULL,'article.published',json_object('article_id',NEW.id),NEW.updated_at,NULL);
END;

DROP TRIGGER managed_article_published;
CREATE TRIGGER managed_article_published AFTER UPDATE OF status ON knowledge_articles WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status='published' AND OLD.status<>'published' AND NEW.slug NOT LIKE 'import-%') BEGIN
 INSERT INTO native_integration_events VALUES(lower(hex(randomblob(16))),NEW.project_id,NULL,NULL,'article.published',json_object('article_id',NEW.id),NEW.updated_at,NULL);
END;

CREATE TABLE legacy_door_package_audits(project_id TEXT NOT NULL,installation_id TEXT NOT NULL,upload_id TEXT NOT NULL,bundle_sha256 TEXT NOT NULL,PRIMARY KEY(installation_id,upload_id));
CREATE TABLE legacy_door_object_identities(project_id TEXT NOT NULL,bundle_sha256 TEXT NOT NULL,object_id_digest TEXT NOT NULL,object_digest TEXT NOT NULL,identity_json TEXT NOT NULL,PRIMARY KEY(project_id,bundle_sha256,object_id_digest));

DROP TRIGGER knowledge_article_publication_before_update;
CREATE TRIGGER knowledge_article_publication_before_update BEFORE UPDATE ON knowledge_articles
 WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.status='published') BEGIN
 INSERT INTO knowledge_article_publications SELECT OLD.project_id,OLD.id,OLD.publication_version,json_object('title',OLD.title,'slug',OLD.slug,'content',OLD.content,'summary',OLD.summary),OLD.updated_at WHERE NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=OLD.project_id AND article_id=OLD.id AND source_version=OLD.publication_version);
END;

DROP TRIGGER knowledge_article_publication_insert;
CREATE TRIGGER knowledge_article_publication_insert AFTER INSERT ON knowledge_articles
 WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status='published') BEGIN
 INSERT INTO knowledge_article_publications SELECT NEW.project_id,NEW.id,NEW.publication_version,json_object('title',NEW.title,'slug',NEW.slug,'content',NEW.content,'summary',NEW.summary),NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=NEW.project_id AND article_id=NEW.id AND source_version=NEW.publication_version);
END;

DROP TRIGGER knowledge_article_publication_update;
CREATE TRIGGER knowledge_article_publication_update AFTER UPDATE ON knowledge_articles
 WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (NEW.status='published') BEGIN
 INSERT INTO knowledge_article_publications SELECT NEW.project_id,NEW.id,NEW.publication_version,json_object('title',NEW.title,'slug',NEW.slug,'content',NEW.content,'summary',NEW.summary),NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=NEW.project_id AND article_id=NEW.id AND source_version=NEW.publication_version);
END;

DROP TRIGGER knowledge_article_retire;
CREATE TRIGGER knowledge_article_retire BEFORE DELETE ON knowledge_articles
 WHEN NOT EXISTS(SELECT 1 FROM legacy_door_native_fence) AND (OLD.status='published' OR EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=OLD.project_id AND article_id=OLD.id) OR EXISTS(SELECT 1 FROM knowledge_shingles WHERE project_id=OLD.project_id AND source_id='article:'||OLD.id)) BEGIN
 INSERT OR IGNORE INTO knowledge_retired_articles VALUES(OLD.id,OLD.project_id,OLD.source_incarnation,unixepoch()*1000);
END;
