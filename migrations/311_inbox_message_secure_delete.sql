-- Message search removes the terms of a deleted or rewritten message (an erased message's content)
-- from the index's storage rather than masking them until segments merge, as the contact index does
-- (310_inbox_contact_search.sql). It applies to deletes from now on; nothing is rebuilt or rewritten.
INSERT INTO inbox_message_search(inbox_message_search,rank) VALUES('secure-delete',1);
