/** Issuing a reply address is not proof. A committed customer message must have
 * arrived through that grant, issued to this exact current canonical mailbox.
 * The receipt belongs to the resulting ticket, including a Closed follow-up.
 * Admission already checks whether the issuing ticket may authorize that reply. */
export const consumedReplyGrantSql=(ct:string,conversation:string)=>`EXISTS(
 SELECT 1 FROM messages own JOIN inbound_emails receipt ON receipt.project_id=own.project_id
 AND receipt.conversation_id=own.conversation_id AND (receipt.message_id=own.id OR receipt.local_id=own.local_id)
 JOIN email_reply_grants issued ON issued.project_id=receipt.project_id
 AND issued.token_hash=json_extract(receipt.evidence_json,'$.grant.token_hash')
 WHERE own.project_id=${ct}.project_id AND own.conversation_id=${conversation}
 AND own.actor_id=${ct}.id AND own.actor_role='contact' AND receipt.automatic=0
 AND lower(${ct}.email)=json_extract(receipt.evidence_json,'$.grant.recipient')
 AND lower(issued.recipient)=lower(${ct}.email))`
