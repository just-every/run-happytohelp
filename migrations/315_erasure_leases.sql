-- One erasure of a contact at a time, and no legacy delta while an erasure of its workspace runs.
-- contact_erasure_leases: a row exists from the moment an erasure of that contact takes its lease until
-- an erasure of that contact completes (its final batch deletes it). A row whose expires_at has passed
-- belongs to an interrupted erasure: any request may take it over, and deltas still treat the contact
-- as being erased. legacy_delta_leases: one live row while a delta package is applied to the workspace.
-- expires_at is the database's clock in epoch milliseconds; no other clock decides who holds a lease.
-- Holds no personal data beyond the contact's id. Additive only.
CREATE TABLE IF NOT EXISTS contact_erasure_leases (
  project_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, contact_id)
);
CREATE TABLE IF NOT EXISTS legacy_delta_leases (
  project_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
