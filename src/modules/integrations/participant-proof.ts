/** Who may receive a requester notice besides the requester (K3: never an unproven CC).
 * `ct` is the participant's contact and `cp` its conversation_participants row. A Cc
 * header names an address but proves nothing about it, so a participant qualifies only
 * when it was added by an operator, has written to this ticket itself (authenticated
 * mail or the reply address the desk issued it: `self`), is a widget-signed identity,
 * or has itself sent authenticated, non-automatic mail to this workspace. */
export const noticeParticipantSql=(ct:string,cp:string)=>`(${cp}.joined_via IN ('operator','self')
 OR coalesce(${ct}.is_verified,0)=1 AND lower(${ct}.external_id)=lower(${ct}.email)
 OR EXISTS(SELECT 1 FROM messages own JOIN inbound_emails receipt ON receipt.project_id=own.project_id AND (receipt.message_id=own.id OR receipt.local_id=own.local_id)
  WHERE own.project_id=${ct}.project_id AND own.actor_role='contact' AND own.actor_id=${ct}.id AND receipt.automatic=0 AND json_extract(receipt.evidence_json,'$.sender_verified')=1))`
