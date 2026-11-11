-- The knowledge reference policy (src/modules/knowledge/reference-policy.ts, documentCurrent) decides whether a cited
-- crawled page is still current. A page of the published version is current; a page of an older crawl version is
-- current only if the published version holds a page at the same URL. That second lookup is
-- `SELECT 1 FROM knowledge_documents WHERE version_id=<published version> AND url=<the older page's url>`, and the only
-- index on knowledge_documents holding version_id was knowledge_documents_version(version_id), so it walked every
-- page of the published version for each cited source whose URL is no longer published: 644 rows per source, about
-- 2.6 million rows to evaluate 16 copied passages of 255 older-version sources on a large imported workspace.
-- This index holds both columns, so the lookup searches (version_id,url) and reads only the pages at that URL.
-- Additive: no row, column or statement changes; the lookup's matches are unchanged.
CREATE INDEX IF NOT EXISTS knowledge_documents_version_url ON knowledge_documents(version_id,url);
