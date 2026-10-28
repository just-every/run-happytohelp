CREATE TABLE voice_numbers(
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), provider TEXT NOT NULL CHECK(provider IN ('twilio','aircall')),
 provider_id TEXT NOT NULL, account_id TEXT NOT NULL, phone TEXT NOT NULL, token_cipher TEXT, webhook_hash TEXT,
 settings_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, enabled INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL,
 UNIQUE(project_id,provider,provider_id)
);
CREATE TABLE voice_identities(
 project_id TEXT NOT NULL REFERENCES projects(id), phone_hash TEXT NOT NULL, contact_id TEXT NOT NULL REFERENCES contacts(id),
 phone_cipher TEXT, erased INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(project_id,phone_hash)
);
CREATE TABLE voice_calls(
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), number_id TEXT NOT NULL REFERENCES voice_numbers(id),
 conversation_id TEXT NOT NULL REFERENCES conversations(id), contact_id TEXT NOT NULL REFERENCES contacts(id), remote_cipher TEXT,
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound')), state TEXT NOT NULL DEFAULT 'ringing', consent TEXT NOT NULL DEFAULT 'unknown' CHECK(consent IN ('unknown','granted','declined')),
 recording_cipher TEXT, transcript TEXT, summary TEXT NOT NULL DEFAULT '', follow_up INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, erased INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX voice_call_history ON voice_calls(project_id,conversation_id,created_at);
CREATE TABLE voice_steps(call_id TEXT NOT NULL REFERENCES voice_calls(id), step TEXT NOT NULL, input_hash TEXT NOT NULL, response_xml TEXT NOT NULL, PRIMARY KEY(call_id,step));
CREATE TABLE voice_commands(
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), conversation_id TEXT NOT NULL REFERENCES conversations(id), number_id TEXT NOT NULL REFERENCES voice_numbers(id),
 call_id TEXT REFERENCES voice_calls(id), kind TEXT NOT NULL CHECK(kind IN ('callback','transfer')), intent_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('sending','accepted','rejected','uncertain','erased')), created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
