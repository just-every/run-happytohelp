-- Receipts for the Amazon SES S3 reader (src/modules/integrations/legacy-mail-s3). One row per listed object key,
-- whatever happens to the object, so a later legacy delta can skip every message whose SES message id is held here and
-- the reader never admits an object twice. ses_message_id is the key's last path segment. source is the prefix the key
-- was listed under: 'ses' objects were written by SES, 'replay' objects by an operator and are never authenticated.
-- States: pending, processing, retry, pending_mailbox, complete, held (with reason), failed, setup_notice, duplicate.
-- raw_key names the encrypted private transport copy while it exists; error holds a short fixed phrase, never message
-- text or an address. Additive only; the reader stays off until its inputs are set.
CREATE TABLE legacy_mail_s3_receipts(
 object_key TEXT PRIMARY KEY,
 ses_message_id TEXT NOT NULL,
 source TEXT NOT NULL CHECK(source IN ('ses','replay')),
 size INTEGER NOT NULL,
 state TEXT NOT NULL,
 reason TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_at INTEGER NOT NULL DEFAULT 0,
 claimed_at INTEGER,
 project_id TEXT,
 conversation_id TEXT,
 raw_key TEXT,
 body_sha256 TEXT,
 sender_address TEXT,
 error TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX legacy_mail_s3_receipts_message ON legacy_mail_s3_receipts(ses_message_id);
CREATE INDEX legacy_mail_s3_receipts_due ON legacy_mail_s3_receipts(state,next_at);
-- The retention sweep finds the few receipts that still hold a private transport copy without reading the rest.
CREATE INDEX legacy_mail_s3_receipts_copy ON legacy_mail_s3_receipts(updated_at) WHERE raw_key IS NOT NULL;
-- The reader's own list bookkeeping: the last successful list and the last list failure. Installation-private.
CREATE TABLE legacy_mail_s3_state(
 id INTEGER PRIMARY KEY CHECK(id=1),
 last_listed_at INTEGER,
 last_list_error TEXT
);
