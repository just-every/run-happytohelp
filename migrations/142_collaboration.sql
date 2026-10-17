-- Mention identities only: note text stays in conversation_notes and is never copied here.
CREATE TABLE conversation_note_mentions (
 note_id TEXT NOT NULL REFERENCES conversation_notes(id) ON DELETE CASCADE,
 user_id TEXT NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 PRIMARY KEY(note_id,user_id)
);
CREATE INDEX conversation_note_mentions_user ON conversation_note_mentions(user_id,note_id);
-- Private note attachments retain the canonical media bytes and their original ownership.
CREATE TABLE conversation_note_media (
 note_id TEXT NOT NULL REFERENCES conversation_notes(id) ON DELETE CASCADE,
 media_id TEXT NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
 PRIMARY KEY(note_id,media_id)
);
