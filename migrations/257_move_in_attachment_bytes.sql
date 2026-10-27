-- Explicit small export payloads share the native media lifetime and authorization.
CREATE TABLE move_in_attachment_bytes (
 media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL REFERENCES conversations(id),
 note_id TEXT REFERENCES move_in_notes(id) ON DELETE CASCADE,
 sha256 TEXT NOT NULL,
 base64 TEXT NOT NULL
);
CREATE INDEX move_in_attachment_conversation ON move_in_attachment_bytes(project_id,conversation_id);
CREATE INDEX move_in_attachment_note ON move_in_attachment_bytes(note_id);
