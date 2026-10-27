-- Never-published drafts have no detector corpus. Keeping them out of the dirty
-- queue bounds unrelated writes without omitting any retained published bytes.
DROP TRIGGER knowledge_index_article_insert;
CREATE TRIGGER knowledge_index_article_insert AFTER INSERT ON knowledge_articles WHEN NEW.status='published' BEGIN
 INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'article:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;
DROP TRIGGER knowledge_index_article_update;
CREATE TRIGGER knowledge_index_article_update AFTER UPDATE ON knowledge_articles WHEN NEW.status='published' OR OLD.status='published' OR EXISTS(SELECT 1 FROM knowledge_source_index WHERE project_id=NEW.project_id AND source_id='article:'||NEW.id) OR EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=NEW.project_id AND article_id=NEW.id) OR EXISTS(SELECT 1 FROM knowledge_translation_publications WHERE project_id=NEW.project_id AND article_id=NEW.id) BEGIN
 INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'article:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;
DROP TRIGGER knowledge_index_article_delete;
CREATE TRIGGER knowledge_index_article_delete BEFORE DELETE ON knowledge_articles WHEN OLD.status='published' OR EXISTS(SELECT 1 FROM knowledge_source_index WHERE project_id=OLD.project_id AND source_id='article:'||OLD.id) OR EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=OLD.project_id AND article_id=OLD.id) OR EXISTS(SELECT 1 FROM knowledge_translation_publications WHERE project_id=OLD.project_id AND article_id=OLD.id) BEGIN
 INSERT INTO knowledge_index_dirty VALUES(OLD.project_id,'article:'||OLD.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;
DELETE FROM knowledge_index_dirty AS dirty WHERE source_id LIKE 'article:%'
 AND EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.project_id=dirty.project_id AND a.id=substr(dirty.source_id,9) AND a.status<>'published')
 AND NOT EXISTS(SELECT 1 FROM knowledge_source_index WHERE project_id=dirty.project_id AND source_id=dirty.source_id)
 AND NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=dirty.project_id AND article_id=substr(dirty.source_id,9))
 AND NOT EXISTS(SELECT 1 FROM knowledge_article_history WHERE project_id=dirty.project_id AND article_id=substr(dirty.source_id,9) AND json_extract(snapshot_json,'$.status')='published')
 AND NOT EXISTS(SELECT 1 FROM knowledge_translations WHERE article_id=substr(dirty.source_id,9) AND published_json IS NOT NULL)
 AND NOT EXISTS(SELECT 1 FROM knowledge_translation_publications WHERE project_id=dirty.project_id AND article_id=substr(dirty.source_id,9));
