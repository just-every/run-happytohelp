/** A conversation enters the inbox with its first message. The widget opens one per visitor so its
 * socket and context have an address; until someone writes, it is not shown or counted. */
export const hasMessages="EXISTS(SELECT 1 FROM messages im WHERE im.conversation_id=c.id) AND NOT EXISTS(SELECT 1 FROM conversation_merges merged WHERE merged.project_id=c.project_id AND merged.source_id=c.id AND merged.undone_at IS NULL)"
