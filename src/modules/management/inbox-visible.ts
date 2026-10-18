/** Widget drafts remain hidden until someone writes. An operator's logged call or recovered
 * private note is already a ticket and belongs in the inbox. */
export const conversationHasMessages=(alias='c')=>`(EXISTS(SELECT 1 FROM messages im WHERE im.conversation_id=${alias}.id) OR EXISTS(SELECT 1 FROM conversation_notes inn WHERE inn.conversation_id=${alias}.id)) AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=${alias}.project_id AND merged.source_id=${alias}.id AND merged.undone_at IS NULL)`
export const hasMessages=conversationHasMessages()
