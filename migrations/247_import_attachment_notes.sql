-- Imported private attachments remain canonical media, without a public message.
CREATE TABLE move_in_note_media(
 project_id TEXT NOT NULL REFERENCES projects(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
 note_id TEXT NOT NULL REFERENCES move_in_notes(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
 PRIMARY KEY(note_id,media_id)
);
-- Reserve canonical bytes before guarded publication, including interrupted
-- imports. A mixed source's original custody never owns another ticket's bytes.
CREATE TABLE move_in_attachment_objects(
 media_id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id),
 run_id TEXT NOT NULL REFERENCES move_in_runs(id),
 conversation_id TEXT NOT NULL,
 contact_id TEXT NOT NULL,
 uploaded_by TEXT NOT NULL,
 object_key TEXT NOT NULL UNIQUE,
 sha256 TEXT NOT NULL,
 size INTEGER NOT NULL
);
CREATE INDEX move_in_attachment_objects_run ON move_in_attachment_objects(run_id);
CREATE INDEX move_in_attachment_objects_contact ON move_in_attachment_objects(project_id,contact_id);
