-- Business roster erasure (rer 0.2.107, Base default-seed/migrations/core/0044_business_retired.sql).
-- Value-free tombstones of people erased from the installation: domain-separated SHA-256 digests of the roster
-- address and the Business member id, with the invite number they had. Never a name, address or id.
-- Additive only: the table starts empty; no roster row is read, moved or deleted here. Erasing a team member
-- writes it, and the Business's next signed revision that still lists that person applies them as retired.
CREATE TABLE bs_retired (
  digest TEXT PRIMARY KEY,
  invite INTEGER NOT NULL CHECK(invite >= 0),
  erasure_id TEXT NOT NULL
);
