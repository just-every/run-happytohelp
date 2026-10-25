-- Each reviewed link or unlink keeps its reviewer, time and evidence after the
-- association itself is removed. Erasure removes rows naming the erased customer.
CREATE TABLE customer_identity_link_history (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 contact_id TEXT NOT NULL REFERENCES contacts(id),
 linked_contact_id TEXT NOT NULL REFERENCES contacts(id),
 action TEXT NOT NULL CHECK(action IN ('linked','unlinked')),
 provenance TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 at INTEGER NOT NULL,
 CHECK(contact_id<linked_contact_id)
);
CREATE INDEX customer_identity_link_history_contact ON customer_identity_link_history(project_id,contact_id,at);
CREATE INDEX customer_identity_link_history_linked ON customer_identity_link_history(project_id,linked_contact_id,at);
