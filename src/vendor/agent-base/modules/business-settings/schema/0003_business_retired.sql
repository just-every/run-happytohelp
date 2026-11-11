-- Value-free tombstones of people erased from the installation: domain-separated SHA-256 digests of the roster
-- address and the Business member id, with the invite number they had. Never a name, address or id.
CREATE TABLE bs_retired (
  digest TEXT PRIMARY KEY,
  invite INTEGER NOT NULL CHECK(invite >= 0),
  erasure_id TEXT NOT NULL
);
