-- How each participant joined a ticket. A Cc header alone never proves an address:
-- requester notices reach a participant only once it is independently proven
-- (integrations/participant-proof.ts). Earlier rows have no record, so they stay unproven.
ALTER TABLE conversation_participants ADD COLUMN joined_via TEXT NOT NULL DEFAULT 'cc_header' CHECK(joined_via IN ('cc_header','operator','self'));
