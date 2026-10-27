-- Published translation bytes remain detector sources after a later review.
-- Draft edit history is deliberately separate and never seeds this table.
CREATE TABLE knowledge_translation_publications(
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 article_id TEXT NOT NULL,
 locale TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
 created_at INTEGER NOT NULL
);
CREATE INDEX knowledge_translation_publications_article ON knowledge_translation_publications(project_id,article_id,locale,created_at);
INSERT INTO knowledge_translation_publications(id,project_id,article_id,locale,snapshot_json,created_at)
 SELECT lower(hex(randomblob(16))),a.project_id,t.article_id,t.locale,t.published_json,coalesce(t.reviewed_at,t.updated_at)
 FROM knowledge_translations t JOIN knowledge_articles a ON a.id=t.article_id
 WHERE t.published_json IS NOT NULL;

CREATE TRIGGER knowledge_translation_publication_insert AFTER INSERT ON knowledge_translations
 WHEN NEW.published_json IS NOT NULL BEGIN
 INSERT INTO knowledge_translation_publications(id,project_id,article_id,locale,snapshot_json,created_at)
  SELECT lower(hex(randomblob(16))),a.project_id,NEW.article_id,NEW.locale,NEW.published_json,coalesce(NEW.reviewed_at,NEW.updated_at)
  FROM knowledge_articles a WHERE a.id=NEW.article_id;
END;
CREATE TRIGGER knowledge_translation_publication_update AFTER UPDATE OF published_json ON knowledge_translations
 WHEN NEW.published_json IS NOT OLD.published_json BEGIN
 INSERT INTO knowledge_translation_publications(id,project_id,article_id,locale,snapshot_json,created_at)
  SELECT lower(hex(randomblob(16))),a.project_id,OLD.article_id,OLD.locale,OLD.published_json,coalesce(OLD.reviewed_at,OLD.updated_at)
  FROM knowledge_articles a WHERE a.id=OLD.article_id AND OLD.published_json IS NOT NULL;
 INSERT INTO knowledge_translation_publications(id,project_id,article_id,locale,snapshot_json,created_at)
  SELECT lower(hex(randomblob(16))),a.project_id,NEW.article_id,NEW.locale,NEW.published_json,coalesce(NEW.reviewed_at,NEW.updated_at)
  FROM knowledge_articles a WHERE a.id=NEW.article_id AND NEW.published_json IS NOT NULL;
END;
CREATE TRIGGER knowledge_translation_publication_dirty AFTER INSERT ON knowledge_translation_publications BEGIN
 INSERT INTO knowledge_index_dirty(project_id,source_id,stamp)
  VALUES(NEW.project_id,'article:'||NEW.article_id,lower(hex(randomblob(16))))
  ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;
-- Revisit seed snapshots even if the previous index had already consumed them.
INSERT INTO knowledge_index_dirty(project_id,source_id,stamp)
 SELECT DISTINCT project_id,'article:'||article_id,lower(hex(randomblob(16))) FROM knowledge_translation_publications WHERE 1
 ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;

-- Ingestion inserts documents before publication. An earlier canonicalisation
-- may consume their insert markers, so publication must dirty them again.
CREATE TRIGGER knowledge_index_dataset_publication AFTER UPDATE OF published_version ON knowledge_datasets
 WHEN NEW.published_version IS NOT OLD.published_version BEGIN
 INSERT INTO knowledge_index_dirty(project_id,source_id,stamp)
  SELECT NEW.project_id,'knowledge:'||f.id,lower(hex(randomblob(16)))
  FROM knowledge_documents f JOIN knowledge_versions v ON v.id=f.version_id
  WHERE v.dataset_id=NEW.id AND f.version_id=NEW.published_version
  ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
END;
INSERT INTO knowledge_index_dirty(project_id,source_id,stamp)
 SELECT d.project_id,'knowledge:'||f.id,lower(hex(randomblob(16)))
 FROM knowledge_datasets d JOIN knowledge_versions v ON v.dataset_id=d.id AND v.id=d.published_version
 JOIN knowledge_documents f ON f.version_id=v.id WHERE 1
 ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp;
