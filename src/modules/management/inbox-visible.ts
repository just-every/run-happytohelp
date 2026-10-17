/** Widget drafts remain hidden until someone writes. An operator's logged call or recovered
 * private note is already a ticket and belongs in the inbox. */
export const hasMessages="(EXISTS(SELECT 1 FROM messages im WHERE im.conversation_id=c.id) OR (c.submitter_type='agent' AND EXISTS(SELECT 1 FROM conversation_notes inn WHERE inn.conversation_id=c.id))) AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)"
