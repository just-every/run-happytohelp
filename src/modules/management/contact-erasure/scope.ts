/**
 * SQL scope of one contact's personal data. Every fragment binds ?1 = project id
 * and ?2 = contact id, so each statement stays inside the contact's own project.
 */
export const conversations = 'SELECT id FROM conversations WHERE project_id=?1 AND contact_id=?2'

/** Every message in the contact's conversations, plus anything the contact wrote elsewhere. */
export const messages = `project_id=?1 AND (conversation_id IN (${conversations}) OR (actor_role='contact' AND actor_id=?2))`

/** Uploads in those conversations, uploads by the contact, and media attached to erased messages. */
export const media = `project_id=?1 AND (conversation_id IN (${conversations}) OR uploaded_by=?2 OR id IN (SELECT a.media_id FROM move_in_attachment_bytes a JOIN move_in_notes n ON n.id=a.note_id JOIN move_in_origins o ON o.project_id=n.project_id AND o.target_kind='contact' AND o.target_id=?2 AND o.vendor IN ('freshdesk','zendesk') AND o.source_id=json_extract(n.author_json,'$.id') WHERE a.project_id=?1 AND json_extract(n.author_json,'$.role')='contact') OR message_id IN (SELECT id FROM messages WHERE ${messages}))`

export const localJobs = `SELECT id FROM local_jobs WHERE project_id=?1 AND conversation_id IN (${conversations})`
export const generations = `SELECT id FROM ai_generations WHERE project_id=?1 AND conversation_id IN (${conversations})`
export const attempts = `SELECT id FROM ai_attempts WHERE generation_id IN (${generations})`
export const notes = `SELECT id FROM conversation_notes WHERE conversation_id IN (${conversations})`
export const projectConversations = 'SELECT id FROM conversations WHERE project_id=?1'

/** Customer-context rows are keyed by (project_id, subject_id); the subject is the contact. */
export const subject = 'project_id=?1 AND (subject_id=?2 OR subject_id IN (SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2))'
export const contextJobs = `SELECT id FROM context_jobs WHERE ${subject}`
/** Page views and widget actions collected for the contact. */
export const trackedTables = ['context_tracked_events', 'context_actions'] as const
/** Evidence, profiles, insights, summaries and job records derived from the contact's activity. */
export const contextTables = ['context_evidence', 'context_profiles', 'context_insights', 'context_summaries', 'context_collectors', 'context_jobs', 'context_subjects'] as const

export type ObjectKind = 'media' | 'local_attachment'
/** Objects staged for deletion by this erasure; see objects.ts. */
export const staged = (kind: ObjectKind) => `SELECT source_id FROM contact_erasure_objects WHERE project_id=?1 AND contact_id=?2 AND kind='${kind}'`
