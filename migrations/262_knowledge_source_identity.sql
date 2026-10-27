-- A publication identifies pinned text; current article/collection visibility
-- remains authoritative. Main's older edit history did not record versions,
-- so seed only publications whose identity can be proved exactly.
CREATE TABLE knowledge_article_publications(
 project_id TEXT NOT NULL,
 article_id TEXT NOT NULL,
 source_version TEXT NOT NULL,
 snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json) AND json_type(snapshot_json)='object'),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,article_id,source_version)
) WITHOUT ROWID;
INSERT INTO knowledge_article_publications
 SELECT project_id,id,publication_version,json_object('title',title,'slug',slug,'content',content,'summary',summary),updated_at
 FROM knowledge_articles WHERE status='published';

-- Keep the old snapshot before a content or metadata update can advance the
-- edition revision. Nested incarnation/revision triggers also retain the final
-- version that a later search can issue. Existing snapshots never change.
CREATE TRIGGER knowledge_article_publication_before_update BEFORE UPDATE ON knowledge_articles
 WHEN OLD.status='published' BEGIN
 INSERT INTO knowledge_article_publications SELECT OLD.project_id,OLD.id,OLD.publication_version,json_object('title',OLD.title,'slug',OLD.slug,'content',OLD.content,'summary',OLD.summary),OLD.updated_at WHERE NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=OLD.project_id AND article_id=OLD.id AND source_version=OLD.publication_version);
END;
CREATE TRIGGER knowledge_article_publication_insert AFTER INSERT ON knowledge_articles
 WHEN NEW.status='published' BEGIN
 INSERT INTO knowledge_article_publications SELECT NEW.project_id,NEW.id,NEW.publication_version,json_object('title',NEW.title,'slug',NEW.slug,'content',NEW.content,'summary',NEW.summary),NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=NEW.project_id AND article_id=NEW.id AND source_version=NEW.publication_version);
END;
CREATE TRIGGER knowledge_article_publication_update AFTER UPDATE ON knowledge_articles
 WHEN NEW.status='published' BEGIN
 INSERT INTO knowledge_article_publications SELECT NEW.project_id,NEW.id,NEW.publication_version,json_object('title',NEW.title,'slug',NEW.slug,'content',NEW.content,'summary',NEW.summary),NEW.updated_at WHERE NOT EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=NEW.project_id AND article_id=NEW.id AND source_version=NEW.publication_version);
END;

-- Source IDs cannot be recycled into a new article with different authority.
-- No foreign key to the live article: retirement must survive its deletion.
CREATE TABLE knowledge_retired_articles(
 article_id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 source_incarnation TEXT,
 retired_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO knowledge_retired_articles(article_id,project_id,retired_at)
 SELECT substr(source_id,9),project_id,unixepoch()*1000 FROM (
  SELECT project_id,source_id FROM knowledge_generation_sources
  UNION SELECT project_id,source_id FROM knowledge_shingles
  UNION SELECT project_id,source_id FROM knowledge_source_index
  UNION SELECT project_id,source_id FROM knowledge_index_dirty
  UNION SELECT b.project_id,s.value source_id FROM knowledge_reply_blocks b,json_each(b.sources_json) s
 ) retained WHERE source_id LIKE 'article:%'
 AND NOT EXISTS(SELECT 1 FROM knowledge_articles a WHERE a.id=substr(retained.source_id,9));
CREATE TRIGGER knowledge_article_retire BEFORE DELETE ON knowledge_articles
 WHEN OLD.status='published' OR EXISTS(SELECT 1 FROM knowledge_article_publications WHERE project_id=OLD.project_id AND article_id=OLD.id) OR EXISTS(SELECT 1 FROM knowledge_shingles WHERE project_id=OLD.project_id AND source_id='article:'||OLD.id) BEGIN
 INSERT OR IGNORE INTO knowledge_retired_articles VALUES(OLD.id,OLD.project_id,OLD.source_incarnation,unixepoch()*1000);
END;
CREATE TRIGGER knowledge_article_retired_insert BEFORE INSERT ON knowledge_articles
 WHEN EXISTS(SELECT 1 FROM knowledge_retired_articles WHERE article_id=NEW.id) BEGIN
 SELECT RAISE(ABORT,'knowledge_article_id_retired');
END;
CREATE TRIGGER knowledge_article_identity_update BEFORE UPDATE OF id,project_id ON knowledge_articles
 WHEN NEW.id<>OLD.id OR NEW.project_id<>OLD.project_id BEGIN
 SELECT RAISE(ABORT,'knowledge_article_identity_immutable');
END;
