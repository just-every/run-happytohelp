/** Token operations must not revive a contact's erased conversation. */
export const contactAvailableSql=(conversation='c')=>`EXISTS(SELECT 1 FROM contacts privacy_contact WHERE privacy_contact.id=${conversation}.contact_id AND privacy_contact.project_id=${conversation}.project_id AND COALESCE(json_extract(privacy_contact.metadata_json,'$.is_erasing'),0)!=1 AND COALESCE(json_extract(privacy_contact.metadata_json,'$.is_erased'),0)!=1)`

/** A machine's customer message obeys current contact and address/domain blocks.
 * Reuse this predicate at admission so a block during attachment I/O also wins. */
export const customerUnblockedSql=(conversation='c')=>`EXISTS(SELECT 1 FROM contacts sender WHERE sender.id=${conversation}.contact_id AND sender.project_id=${conversation}.project_id AND coalesce(json_extract(sender.metadata_json,'$.is_blocked'),0)!=1 AND NOT EXISTS(SELECT 1 FROM email_sender_rules rule WHERE rule.project_id=sender.project_id AND rule.action='block' AND rule.address IN (lower(sender.email),substr(lower(sender.email),instr(sender.email,'@')))))`
