/** Bind projectId, contactId. Apply before deleting/redacting conversation_notes. */
export const collaborationErasureSql=`DELETE FROM conversation_note_mentions WHERE note_id IN (SELECT n.id FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id WHERE c.project_id=? AND c.contact_id=?)`
export const collaborationErasureCountSql=`SELECT count(*) n FROM conversation_note_mentions m JOIN conversation_notes n ON n.id=m.note_id JOIN conversations c ON c.id=n.conversation_id WHERE c.project_id=? AND c.contact_id=?`
/** Portable backup table: contains no tokens, presence or draft content. */
export const collaborationExportTables=['conversation_note_mentions','conversation_note_media'] as const
export const collaborationMediaErasureSql=`DELETE FROM conversation_note_media WHERE note_id IN (SELECT n.id FROM conversation_notes n JOIN conversations c ON c.id=n.conversation_id WHERE c.project_id=? AND c.contact_id=?)`
export const collaborationMediaErasureCountSql=`SELECT count(*) n FROM conversation_note_media m JOIN conversation_notes n ON n.id=m.note_id JOIN conversations c ON c.id=n.conversation_id WHERE c.project_id=? AND c.contact_id=?`
