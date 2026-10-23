-- Give each reviewed translation an independent immutable retrieval identity.
ALTER TABLE knowledge_translations ADD COLUMN publication_version TEXT;
UPDATE knowledge_translations SET publication_version=lower(hex(randomblob(16))) WHERE published_json IS NOT NULL;
CREATE TRIGGER knowledge_translation_publication_insert AFTER INSERT ON knowledge_translations WHEN NEW.published_json IS NOT NULL BEGIN
 UPDATE knowledge_translations SET publication_version=lower(hex(randomblob(16))) WHERE article_id=NEW.article_id AND locale=NEW.locale;
END;
CREATE TRIGGER knowledge_translation_publication_update AFTER UPDATE OF published_json,published_source_version ON knowledge_translations WHEN NEW.published_json IS NOT OLD.published_json OR NEW.published_source_version IS NOT OLD.published_source_version BEGIN
 UPDATE knowledge_translations SET publication_version=CASE WHEN NEW.published_json IS NULL THEN NULL ELSE lower(hex(randomblob(16))) END WHERE article_id=NEW.article_id AND locale=NEW.locale;
END;
