/** A new customer report invalidates earlier local reply evidence, even when a
 * person supplies the current composer revision. Internal notes/teammate edits
 * do not invalidate it. The predicate is repeated in the final admission. */
export const localResultFrontier = `NOT EXISTS(SELECT 1 FROM messages newer
 WHERE newer.project_id=j.project_id AND newer.conversation_id=j.conversation_id
 AND newer.actor_role='contact' AND newer.revision>COALESCE((SELECT revision FROM messages
 WHERE id=json_extract(j.context,'$.conversation.last_message_id')
 AND project_id=j.project_id AND conversation_id=j.conversation_id),0))`
