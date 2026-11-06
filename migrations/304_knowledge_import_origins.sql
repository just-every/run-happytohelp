-- Which articles the Article import page's API import (Intercom, Freshdesk) wrote. A workspace whose
-- published help is only imported stays out of search indexes until a member publishes (public-site).
CREATE TABLE knowledge_import_origins(project_id TEXT NOT NULL,article_id TEXT NOT NULL,import_id TEXT NOT NULL,platform TEXT NOT NULL,PRIMARY KEY(project_id,article_id)) WITHOUT ROWID;
