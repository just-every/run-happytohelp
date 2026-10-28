-- Capture API erasure counts before privacy triggers redact the source rows.
CREATE TABLE api_erasure_inventory(project_id TEXT NOT NULL,contact_id TEXT NOT NULL,requests INTEGER NOT NULL,appends INTEGER NOT NULL,notes INTEGER NOT NULL,pending_payloads INTEGER NOT NULL,held_requests INTEGER NOT NULL,PRIMARY KEY(project_id,contact_id));
