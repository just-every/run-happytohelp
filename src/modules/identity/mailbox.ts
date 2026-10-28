/** The identity binding, rather than a mutable metadata flag, proves portal mail. */
export const portalMailboxSql=(alias:string)=>`EXISTS(SELECT 1 FROM portal_identities mailbox WHERE mailbox.project_id=${alias}.project_id AND mailbox.contact_id=${alias}.id AND mailbox.email=lower(trim(${alias}.email)))`
export const signedMailboxSql=(alias:string)=>`(${alias}.is_verified=1 AND lower(trim(${alias}.external_id))=lower(trim(${alias}.email)))`
// Preserve R7b's existing receipt proof: the committed contact-authored message
// proves admission even if receipt completion was interrupted afterwards.
const authenticatedMailboxSql=(alias:string)=>`EXISTS(
 SELECT 1 FROM messages message CROSS JOIN inbound_emails receipt ON receipt.project_id=message.project_id AND receipt.message_id=message.id
 WHERE message.project_id=${alias}.project_id AND message.actor_role='contact' AND message.actor_id=${alias}.id
 AND json_extract(receipt.evidence_json,'$.sender_verified')=1
 AND lower(trim(CASE WHEN instr(json_extract(receipt.evidence_json,'$.header_from'),'<')>0
 THEN substr(json_extract(receipt.evidence_json,'$.header_from'),instr(json_extract(receipt.evidence_json,'$.header_from'),'<')+1,instr(json_extract(receipt.evidence_json,'$.header_from'),'>')-instr(json_extract(receipt.evidence_json,'$.header_from'),'<')-1)
 ELSE json_extract(receipt.evidence_json,'$.header_from') END))=lower(trim(${alias}.email)))`
/** A typed/imported address alone, an unverified sender or a thread grant is never proof. */
export const mailboxProofSql=(alias:string)=>`(coalesce(json_extract(${alias}.metadata_json,'$.email_unproven'),0)!=1 AND coalesce(json_extract(${alias}.metadata_json,'$.unverified_sender'),0)!=1 AND coalesce(json_extract(${alias}.metadata_json,'$.unusable_from'),0)!=1 AND (${signedMailboxSql(alias)} OR ${portalMailboxSql(alias)} OR ${authenticatedMailboxSql(alias)}))`
