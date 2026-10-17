-- Form configuration refers to the native typed ticket-field catalogue.
CREATE TABLE request_forms (
 project_id TEXT NOT NULL REFERENCES projects(id),
 id TEXT NOT NULL,
 config_json TEXT NOT NULL CHECK(json_valid(config_json)),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,id)
);
CREATE INDEX request_forms_public ON request_forms(project_id,enabled);
-- Command receipts prevent a retry from creating another native conversation.
-- No message, field value, address, token or challenge response is copied here.
CREATE TABLE request_form_submissions (
 project_id TEXT NOT NULL REFERENCES projects(id),
 contact_id TEXT NOT NULL REFERENCES contacts(id),
 local_id TEXT NOT NULL,
 form_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
 intent_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,contact_id,local_id)
);
