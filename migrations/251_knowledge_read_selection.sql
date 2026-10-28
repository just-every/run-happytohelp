-- NULL retains workspace-wide read authority; [] explicitly selects no articles.
ALTER TABLE project_roles ADD COLUMN knowledge_article_ids TEXT CHECK(knowledge_article_ids IS NULL OR (json_valid(knowledge_article_ids) AND json_type(knowledge_article_ids)='array'));
