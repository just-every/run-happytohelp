-- Imported legacy files that have no conversation: a workspace's logo and widget background, its team's and assistants'
-- avatars and its article images (src/modules/legacy-import/media-index.ts). A legacy import that rewrites a legacy
-- storage URL naming such a file writes one row here, keyed by the workspace and the legacy media id, and the URL
-- becomes /api/imported-files/<workspace>/<media id> (file-door.ts). audience 'public' (a file legacy linked to the
-- workspace, a teammate or an assistant) is served to anyone, so the widget shows it on the customer's own site;
-- 'article' (a file legacy linked to an article) is served to the workspace's members and to whoever may read an
-- article that holds its URL. A conversation's files keep their native media rows and route; no row here names one.
-- Additive only: the table starts empty and existing rows are untouched. A workspace imported earlier gets its rows
-- from scripts/legacy-import/upgrade.mjs.
CREATE TABLE legacy_import_files(project_id TEXT NOT NULL,media_id TEXT NOT NULL,object_key TEXT NOT NULL,content_type TEXT NOT NULL,filename TEXT NOT NULL,audience TEXT NOT NULL CHECK(audience IN ('public','article')),PRIMARY KEY(project_id,media_id)) WITHOUT ROWID;
