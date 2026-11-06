-- Mailgun route forwards are signed with a one-time token. A token is claimed when its
-- signature verifies and freed if the forward is not answered 200, so a replay of an
-- accepted forward is refused while Mailgun's retry of a failed one succeeds. Only a
-- hash of the token and its receipt time are kept; no personal data. Pruned by email
-- maintenance and never exported.
CREATE TABLE mailgun_inbound_tokens(
 token_hash TEXT PRIMARY KEY,
 received_at INTEGER NOT NULL
) WITHOUT ROWID;
