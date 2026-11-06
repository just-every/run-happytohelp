-- Explicit account grants are independent of verified email-domain audiences.
ALTER TABLE knowledge_categories ADD COLUMN requires_entitlement INTEGER NOT NULL DEFAULT 0 CHECK(requires_entitlement IN (0,1));
CREATE TABLE knowledge_collection_entitlements (
 project_id TEXT NOT NULL REFERENCES projects(id),
 category_id TEXT NOT NULL REFERENCES knowledge_categories(id) ON DELETE CASCADE,
 contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 granted_by TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,category_id,contact_id)
);
-- Opaque, short-lived receipts are carried only by an explicit request link.
CREATE TABLE knowledge_read_receipts (
 token TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 article_id TEXT NOT NULL REFERENCES knowledge_articles(id) ON DELETE CASCADE,
 locale TEXT NOT NULL,
 brand TEXT NOT NULL,
 contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL,
 conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE CASCADE
);
