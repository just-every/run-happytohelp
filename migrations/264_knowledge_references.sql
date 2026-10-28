-- Knowledge bytes have one owner. Other text stores carry opaque references.
CREATE TABLE knowledge_company_entitlements(
 project_id TEXT NOT NULL REFERENCES projects(id), category_id TEXT NOT NULL REFERENCES knowledge_categories(id) ON DELETE CASCADE,
 company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE, granted_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,category_id,company_id)
);
CREATE TABLE knowledge_reply_blocks(
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL CHECK(kind IN ('text','link','copy','answer')),
 payload_json TEXT NOT NULL, sources_json TEXT NOT NULL, generation_id TEXT, author_contact_id TEXT, created_at INTEGER NOT NULL, fingerprint TEXT NOT NULL, UNIQUE(project_id,fingerprint)
);
-- General model provenance belongs to knowledge, independently of the engine's
-- job lifecycle. Support IDs remain stable; other engines namespace attempt IDs.
CREATE TABLE knowledge_generation_sources(
 generation_id TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),source_id TEXT NOT NULL,source_version TEXT NOT NULL,
 PRIMARY KEY(project_id,generation_id,source_id,source_version)
) WITHOUT ROWID;
INSERT OR IGNORE INTO knowledge_generation_sources SELECT generation_id,project_id,source_id,source_version FROM ai_generation_sources;
CREATE INDEX knowledge_blocks_project ON knowledge_reply_blocks(project_id);
CREATE TABLE knowledge_source_index(
 project_id TEXT NOT NULL, source_id TEXT NOT NULL, version TEXT NOT NULL, fingerprint TEXT NOT NULL,
 PRIMARY KEY(project_id,source_id,version)
);
CREATE TABLE knowledge_shingles(
 project_id TEXT NOT NULL, hash TEXT NOT NULL, words TEXT NOT NULL, source_id TEXT NOT NULL,
 PRIMARY KEY(project_id,hash,words,source_id)
) WITHOUT ROWID;
-- Cross-workspace writes look up incoming shingles first, without scanning each
-- project's corpus for every word window.
CREATE INDEX knowledge_shingles_lookup ON knowledge_shingles(hash,words,project_id,source_id);
CREATE TABLE knowledge_index_dirty(project_id TEXT NOT NULL,source_id TEXT NOT NULL,stamp TEXT NOT NULL DEFAULT '',PRIMARY KEY(project_id,source_id));
CREATE TABLE knowledge_write_guards(id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE knowledge_canonicalisation_receipts(
 project_id TEXT NOT NULL, table_name TEXT NOT NULL, row_key TEXT NOT NULL, fingerprint TEXT NOT NULL, canonicalised_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,table_name,row_key)
);
CREATE TABLE knowledge_upgrade_reports(project_id TEXT PRIMARY KEY,report_json TEXT NOT NULL,completed_at INTEGER);
INSERT INTO knowledge_upgrade_reports SELECT id,json_object('unpublishedArticles',json((SELECT json_group_array(id) FROM knowledge_articles a WHERE a.project_id=p.id AND EXISTS(WITH RECURSIVE lineage(id) AS (SELECT a.category_id UNION SELECT category_id FROM knowledge_article_categories WHERE article_id=a.id UNION SELECT k.parent_id FROM knowledge_categories k JOIN lineage l ON l.id=k.id WHERE k.parent_id IS NOT NULL) SELECT 1 FROM lineage JOIN knowledge_categories k USING(id) WHERE k.is_published<>1)))) ,NULL FROM projects p;
UPDATE knowledge_categories SET audience='signed-in',requires_entitlement=1 WHERE audience='domains';
INSERT INTO knowledge_index_dirty(project_id,source_id) SELECT project_id,'article:'||id FROM knowledge_articles;
INSERT OR IGNORE INTO knowledge_index_dirty(project_id,source_id) SELECT d.project_id,'knowledge:'||f.id FROM knowledge_documents f JOIN knowledge_versions v ON v.id=f.version_id JOIN knowledge_datasets d ON d.id=v.dataset_id;
INSERT OR IGNORE INTO knowledge_index_dirty(project_id,source_id) SELECT DISTINCT project_id,'generation:'||generation_id FROM knowledge_generation_sources;
CREATE TRIGGER knowledge_support_sources_insert AFTER INSERT ON ai_generation_sources BEGIN INSERT OR IGNORE INTO knowledge_generation_sources VALUES(NEW.generation_id,NEW.project_id,NEW.source_id,NEW.source_version); END;
CREATE TRIGGER knowledge_generation_sources_insert AFTER INSERT ON knowledge_generation_sources BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'generation:'||NEW.generation_id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_article_insert AFTER INSERT ON knowledge_articles BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'article:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_article_update AFTER UPDATE ON knowledge_articles BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'article:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_article_delete BEFORE DELETE ON knowledge_articles BEGIN INSERT INTO knowledge_index_dirty VALUES(OLD.project_id,'article:'||OLD.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_translation_insert AFTER INSERT ON knowledge_translations BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'article:'||id,lower(hex(randomblob(16))) FROM knowledge_articles WHERE id=NEW.article_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_translation_update AFTER UPDATE ON knowledge_translations BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'article:'||id,lower(hex(randomblob(16))) FROM knowledge_articles WHERE id=NEW.article_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_document_insert AFTER INSERT ON knowledge_documents BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'knowledge:'||NEW.id,lower(hex(randomblob(16))) FROM knowledge_datasets d JOIN knowledge_versions v ON v.dataset_id=d.id WHERE v.id=NEW.version_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_document_update AFTER UPDATE ON knowledge_documents BEGIN INSERT INTO knowledge_index_dirty SELECT project_id,'knowledge:'||NEW.id,lower(hex(randomblob(16))) FROM knowledge_datasets d JOIN knowledge_versions v ON v.dataset_id=d.id WHERE v.id=NEW.version_id ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;
CREATE TRIGGER knowledge_index_generation_output AFTER UPDATE OF output_json ON ai_generations WHEN NEW.output_json IS NOT NULL AND EXISTS(SELECT 1 FROM ai_generation_sources WHERE generation_id=NEW.id) BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'generation:'||NEW.id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

CREATE TRIGGER knowledge_index_answer_insert AFTER INSERT ON knowledge_reply_blocks WHEN NEW.kind='answer' BEGIN INSERT INTO knowledge_index_dirty VALUES(NEW.project_id,'generation:'||NEW.generation_id,lower(hex(randomblob(16)))) ON CONFLICT(project_id,source_id) DO UPDATE SET stamp=excluded.stamp; END;

-- A one-row upgrade permit changes representation, never a published command's
-- business definition. It is removed in the same transaction as its receipt.
CREATE TABLE knowledge_upgrade_permits(project_id TEXT NOT NULL,table_name TEXT NOT NULL,row_key TEXT NOT NULL,PRIMARY KEY(project_id,table_name,row_key));
DROP TRIGGER workflow_version_immutable;
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE ON workflow_rule_versions WHEN NOT EXISTS(SELECT 1 FROM knowledge_upgrade_permits WHERE project_id=OLD.project_id AND table_name='workflow_rule_versions' AND row_key=json_array(OLD.rule_id,OLD.version)) BEGIN SELECT RAISE(ABORT,'Published workflow versions are immutable'); END;
DROP TRIGGER outbound_notice_command_identity;
CREATE TRIGGER outbound_notice_command_identity BEFORE UPDATE OF id,project_id,actor_id,intent_key,created_at,outcome,detail_json ON outbound_notice_commands WHEN NOT EXISTS(SELECT 1 FROM knowledge_upgrade_permits WHERE project_id=OLD.project_id AND table_name='outbound_notice_commands' AND row_key=json_array(OLD.id,OLD.project_id)) BEGIN SELECT RAISE(ABORT,'notice_command_immutable'); END;
