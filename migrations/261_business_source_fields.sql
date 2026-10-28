-- Explicit CRM source fields; lifecycle and community level never imply support rights.
ALTER TABLE business_connections ADD COLUMN fields_json TEXT NOT NULL DEFAULT '{}';
