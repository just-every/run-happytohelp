-- Historical identities retain their provenance; all live requester references use
-- canonical_id. Filled only inside successful mailbox verification's transaction.
CREATE TABLE mailbox_contact_aliases(
 project_id TEXT NOT NULL REFERENCES projects(id),
 contact_id TEXT NOT NULL REFERENCES contacts(id),
 canonical_id TEXT NOT NULL REFERENCES contacts(id),
 PRIMARY KEY(project_id,contact_id),
 CHECK(contact_id<>canonical_id)
);
CREATE INDEX mailbox_aliases_canonical ON mailbox_contact_aliases(project_id,canonical_id);
