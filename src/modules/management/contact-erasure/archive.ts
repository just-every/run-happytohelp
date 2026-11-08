import type {Env} from '../../../platform/env'
import {conversations,generations,localJobs,media,messages,notes,projectConversations,subject} from './scope'
import {anchorTables,anchors,bindSets,given,inWorkspace,journalSlices,namesPerson,paced,type LegacyPerson} from './archive-sql'

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

/**
 * One slice of the journal, by rowid: a row is the person's by its recorded target (the seed rows the erasure covers), or,
 * outside the tables the person's sets come from, by its source (it names one of the people, their conversations,
 * messages or delegations: contact-erasure/archive-person.ts), whatever its status: rows journaled with no target (skipped,
 * archive-only) or with a target the seed never held (held conflicts) included. Binds ?1 project, ?2 contact, ?3-?6 the
 * first four sets, ?7-?8 the rowid range.
 */
export const legacyArchiveSlice = `${given(4)}UPDATE legacy_import_rows SET source_json='{}' WHERE rowid IN (
 SELECT legacy_rowid FROM (SELECT rowid legacy_rowid,${first('target_table')} target,${first('target_key')} key,source_table,source_id,source_json FROM legacy_import_rows
  WHERE rowid BETWEEN ?7 AND ?8 AND source_json<>'{}')
 WHERE ${erasedTargets.map(([table, match]) => `(target='${table}' AND ${match})`).join('\n  OR ')}
  OR (source_table NOT IN (${anchorTables},'projects') AND ${inWorkspace} AND (
   (source_table='contacts' AND source_id IN people)
   OR ${namesPerson})))`

/** The person's rows of one table the sets come from, by id through legacy_import_rows_source. Binds ?1 project, ?2 the ids. */
const anchorRedaction = (tables: string) => `UPDATE legacy_import_rows SET source_json='{}' WHERE source_table IN (${tables}) AND source_id IN (SELECT value FROM json_each(?2)) AND source_json<>'{}' AND ${inWorkspace}`

/**
 * Legacy import keeps each imported source row verbatim for replay custody. Replay compares row_digest only, so erasure
 * clears the verbatim copy of every row of this contact while keeping the digest, target and status: replaying the same
 * bundle still skips those rows instead of restoring them. Bounded D1 calls, each idempotent: the journal in rowid slices,
 * then the rows the sets come from, by id, dependants first. All of it completes before the erasure's atomic batch, which
 * still holds the seed rows the slices match by target.
 */
export async function redactLegacyArchive(env: Pick<Env, 'DB'>, projectId: string, contactId: string, person: LegacyPerson) {
  let calls = 0
  for (const [low, high] of await journalSlices(env)) {await paced(() => env.DB.prepare(legacyArchiveSlice).bind(projectId, contactId, ...bindSets(person, 4), low, high).run()); calls++}
  for (const [tables, set] of anchors) if (person[set].length) {await env.DB.prepare(anchorRedaction(tables)).bind(projectId, JSON.stringify(person[set])).run(); calls++}
  return calls
}
