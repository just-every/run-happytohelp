// Only a mail-native contact qualifies here. A receipt in a widget thread must
// never turn that widget's typed address into authority for private knowledge.
export const nativeEmailProofSql=`c.is_verified=0 AND c.external_id IS NULL
 AND coalesce(json_extract(c.metadata_json,'$.email_unproven'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.unverified_sender'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_blocked'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_deleted'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_erasing'),0)<>1
 AND coalesce(json_extract(c.metadata_json,'$.is_erased'),0)<>1
 AND NOT EXISTS(SELECT 1 FROM contact_erasures e WHERE e.project_id=c.project_id AND e.contact_id=c.id)
 AND EXISTS(SELECT 1 FROM messages m JOIN message_authorship ma ON ma.message_id=m.id
 JOIN inbound_emails ie ON ie.project_id=m.project_id AND ie.local_id=m.local_id
 WHERE m.project_id=c.project_id AND m.actor_id=c.id AND m.actor_role='contact' AND ma.kind='visitor'
 AND ie.automatic=0 AND json_extract(ie.evidence_json,'$.sender_verified')=1
 AND lower(trim(CASE WHEN instr(json_extract(ie.evidence_json,'$.header_from'),'<')>0 THEN substr(json_extract(ie.evidence_json,'$.header_from'),instr(json_extract(ie.evidence_json,'$.header_from'),'<')+1,instr(json_extract(ie.evidence_json,'$.header_from'),'>')-instr(json_extract(ie.evidence_json,'$.header_from'),'<')-1) ELSE json_extract(ie.evidence_json,'$.header_from') END))=lower(trim(c.email)))`
