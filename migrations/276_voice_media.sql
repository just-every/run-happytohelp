-- Consent withdrawal fences media immediately, independently of the provider outcome.
ALTER TABLE voice_calls ADD COLUMN media_expires_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE voice_calls ADD COLUMN media_withdrawn_at INTEGER;
ALTER TABLE voice_calls ADD COLUMN provider_stop_state TEXT;
UPDATE voice_calls SET media_expires_at=created_at+86400000;
CREATE INDEX voice_media_expiry ON voice_calls(media_expires_at) WHERE erased=0;
CREATE TABLE voice_transcript_segments(
 call_id TEXT NOT NULL REFERENCES voice_calls(id), sequence INTEGER NOT NULL,
 track TEXT NOT NULL, content TEXT NOT NULL, digest TEXT NOT NULL,
 PRIMARY KEY(call_id,sequence)
);
CREATE TABLE voice_context_links(
 project_id TEXT NOT NULL REFERENCES projects(id), contact_id TEXT NOT NULL REFERENCES contacts(id),
 linked_contact_id TEXT NOT NULL REFERENCES contacts(id), linked_by TEXT NOT NULL REFERENCES users(id), linked_at INTEGER NOT NULL,
 PRIMARY KEY(project_id,contact_id), CHECK(contact_id<>linked_contact_id)
);
