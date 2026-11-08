import {conversations,generations,localJobs,media,messages,notes,projectConversations,subject} from './scope'

const first = (column: string) => `CASE WHEN instr(${column},',')>0 THEN substr(${column},1,instr(${column},',')-1) ELSE ${column} END`
const ids = (table: string, where: string) => `SELECT id FROM ${table} WHERE ${where}`

/** Legacy rows record their first mapped target as (table, key); key formats follow the importer. */
const erasedTargets: [string, string][] = [
  ['contacts', "key=?2"],
  ['conversations', `key IN (${conversations})`],
  ['conversation_buckets', `key IN (${ids('conversation_buckets', `conversation_id IN (${conversations})`)})`],
  ['messages', `key IN (${ids('messages', messages)})`],
  ['media', `key IN (${ids('media', media)})`],
  ['conversation_notes', `key IN (${notes})`],
  ['conversation_participants', `key IN (${ids('conversation_participants', `contact_id=?2 AND conversation_id IN (${projectConversations})`)})`],
  ['context_subjects', "key=?1||':'||?2"],
  ['context_collectors', "key=?1||':'||?2"],
  ['context_profiles', `key IN (SELECT project_id||':'||subject_id||':'||type FROM context_profiles WHERE ${subject})`],
  ...['context_evidence', 'context_insights', 'context_summaries', 'context_actions', 'context_tracked_events'].map(table => [table, `key IN (${ids(table, subject)})`] as [string, string]),
  ['ai_generations', `key IN (${generations})`],
  ['local_jobs', `key IN (${localJobs})`],
  ['local_events', `key IN (SELECT job_id||':'||event_id FROM local_events WHERE job_id IN (${localJobs}))`],
]

/** A legacy id the source row names, as text: legacy exports write ids as numbers or strings, and the seed keeps them as
 * text (mapping.ts maps every id with String()). */
const named = (field: string) => `CAST(json_extract(source_json,'$.${field}') AS TEXT)`
/** A legacy row of this workspace: one with no project of its own is reached only through the ids below, which are. */
const inWorkspace = `coalesce(${named('project_id')},?1)=?1`
/** A source row still holding its verbatim copy, of one legacy table. Each is a range of legacy_import_rows_source. */
const journaled = (tables: string) => `FROM legacy_import_rows WHERE source_table IN (${tables}) AND source_json<>'{}' AND ${inWorkspace}`

/**
 * Who a legacy row belongs to, by its source (legacy-import/delta-scope.ts `contactsOf`): the contact and the mailbox
 * aliases erased with it, their conversations as the seed holds them and as legacy journaled them (including ones the
 * seed never held: skipped and archive-only ones), the messages of those conversations and the ones the people wrote
 * (the seed's and every journaled one: held, skipped or deleted in legacy), their delegations, and the files linked to
 * those messages. Each journal part reads one table's range of legacy_import_rows_source.
 */
const people = `SELECT ?2 UNION SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2`
const ownConversations = `SELECT id FROM conversations WHERE project_id=?1 AND contact_id IN people
 UNION SELECT source_id ${journaled("'conversations'")} AND ${named('contact_id')} IN people`
const ownMessages = `SELECT id FROM messages WHERE project_id=?1 AND conversation_id IN own_conversations
 UNION SELECT source_id ${journaled("'messages'")} AND (${named('conversation_id')} IN own_conversations OR ${named('contact_id')} IN people)`
const delegationTables = "'support_delegations','local_jobs'"
const ownDelegations = `SELECT id FROM local_jobs WHERE project_id=?1 AND conversation_id IN own_conversations
 UNION SELECT source_id ${journaled(delegationTables)} AND ${named('conversation_id')} IN own_conversations`
const messageLink = `json_extract(source_json,'$.mediable_type') LIKE '%Message' AND ${named('mediable_id')} IN own_messages`
const ownFiles = `SELECT ${named('media_id')} ${journaled("'mediables'")} AND ${messageLink}`

/** A journal row is the person's by source: it is one of the rows above, names one of them, or belongs to one, in this
 * workspace. A message or conversation row is decided by the sets above, so the pass reads its JSON only when it is one. */
const bySource = `CASE source_table
  WHEN 'messages' THEN source_id IN own_messages AND ${inWorkspace}
  WHEN 'conversations' THEN source_id IN own_conversations AND ${inWorkspace}
  WHEN 'projects' THEN 0
  ELSE ${inWorkspace} AND (
   (source_table='contacts' AND source_id IN people)
   OR (source_table IN (${delegationTables}) AND source_id IN own_delegations)
   OR (source_table='media' AND source_id IN own_files)
   OR (source_table='mediables' AND ${messageLink})
   OR ${named('contact_id')} IN people
   OR ${named('conversation_id')} IN own_conversations
   OR ${named('message_id')} IN own_messages
   OR coalesce(${named('support_delegation_id')},${named('job_id')}) IN own_delegations)
  END`

/**
 * Legacy import keeps each imported source row verbatim for replay custody. Replay compares row_digest only, so erasure
 * clears the verbatim copy of every row of this contact while keeping the digest, target and status: replaying the same
 * bundle still skips those rows instead of restoring them. A row is the contact's by its recorded target (the seed rows
 * the erasure covers) or by its source (above), whatever its status: rows journaled with no target (skipped, archive-only)
 * or with a target the seed never held (held conflicts) included. One pass over the journal, plus the per-table ranges the
 * sets read; each set is computed once (MATERIALIZED), however often the pass reads it. Must run before rows are deleted.
 */
export const legacyArchiveRedaction = `WITH people(id) AS MATERIALIZED (${people}),
 own_conversations(id) AS MATERIALIZED (${ownConversations}),
 own_messages(id) AS MATERIALIZED (${ownMessages}),
 own_delegations(id) AS MATERIALIZED (${ownDelegations}),
 own_files(id) AS MATERIALIZED (${ownFiles})
UPDATE legacy_import_rows SET source_json='{}' WHERE rowid IN (
 SELECT legacy_rowid FROM (SELECT rowid legacy_rowid,${first('target_table')} target,${first('target_key')} key,source_table,source_id,source_json FROM legacy_import_rows
  WHERE source_json<>'{}')
 WHERE ${erasedTargets.map(([table, match]) => `(target='${table}' AND ${match})`).join('\n  OR ')}
  OR (${bySource}))`
