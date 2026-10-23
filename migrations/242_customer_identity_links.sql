-- Operator-reviewed associations do not confer authentication or shared history.
CREATE TABLE customer_identity_links (
 project_id TEXT NOT NULL REFERENCES projects(id),
 contact_id TEXT NOT NULL REFERENCES contacts(id),
 linked_contact_id TEXT NOT NULL REFERENCES contacts(id),
 provenance TEXT NOT NULL,
 actor_id TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,contact_id,linked_contact_id),
 CHECK(contact_id<linked_contact_id)
);
CREATE INDEX customer_identity_links_reverse ON customer_identity_links(project_id,linked_contact_id);
