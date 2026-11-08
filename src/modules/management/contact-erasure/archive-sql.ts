import type {Env} from '../../../platform/env'

/** A legacy id the source row names, as text: legacy exports write ids as numbers or strings, and the seed keeps them as
 * text (mapping.ts maps every id with String()). */
export const named = (field: string) => `CAST(json_extract(source_json,'$.${field}') AS TEXT)`
/** A legacy row of this workspace: one with no project of its own is reached only through the person's ids, which are. */
export const inWorkspace = `coalesce(${named('project_id')},?1)=?1`
/** The delegation a row names: a support event's delegation, a native job's event's job. */
export const delegationOf = `coalesce(${named('support_delegation_id')},${named('job_id')})`
export const delegationTables = "'support_delegations','local_jobs'"

/**
 * The person's legacy sets (contact-erasure/archive-person.ts), in the order each depends on the ones before it. A statement
 * reading the first `count` of them binds each as a JSON array, at ?3 onwards in this order.
 */
export const sets = ['people', 'own_conversations', 'own_messages', 'own_delegations', 'own_events', 'own_files', 'own_links'] as const
export type SetName = typeof sets[number]
export type LegacyPerson = Record<SetName, string[]>
export const given = (count: number) => `WITH ${sets.slice(0, count).map((name, i) => `${name}(id) AS MATERIALIZED (SELECT value FROM json_each(?${i + 3}))`).join(',\n ')}\n`
export const bindSets = (person: Partial<LegacyPerson>, count: number) => sets.slice(0, count).map(name => JSON.stringify(person[name] ?? []))

/** What a legacy row is the person's by: it names one of them, one of their conversations, messages or delegations. */
export const namesPerson = `${named('contact_id')} IN people
   OR ${named('conversation_id')} IN own_conversations
   OR ${named('message_id')} IN own_messages
   OR ${delegationOf} IN own_delegations`

/** Tables the sets are read from, each with its set. Their rows of the person by source are redacted last, by id, after
 * every row that depends on them (dependants first), so an erasure interrupted at any point reads the same sets again. */
export const anchors: [string, SetName][] = [
  ["'media'", 'own_files'], ["'mediables'", 'own_links'], ["'events'", 'own_events'],
  [delegationTables, 'own_delegations'], ["'messages'", 'own_messages'], ["'conversations'", 'own_conversations'],
]
export const anchorTables = anchors.map(([tables]) => tables).join(',')

/** Journal rows per call: each slice of the journal is one D1 call well inside D1's per-query limits on a
 * production-sized journal (on D1 at 1.2 M rows, a slice took 180-210 ms, at most 354 ms). */
export const LEGACY_SLICE_ROWS = 25_000

/**
 * Run one slice, then wait as long as it took. D1 refuses every query of a database ("overloaded") once too many
 * resources are consumed within a 10 second window; back-to-back slices did that on D1 at 1.2 M rows. Pausing keeps the
 * erasure to at most half of D1's time, so the workspace's own requests keep being answered while it runs.
 */
export async function paced<T>(slice: () => Promise<T>) {
  const started = Date.now(), result = await slice()
  await new Promise(resolve => setTimeout(resolve, Date.now() - started))
  return result
}

/** The journal's rowid range in slices, read once per pass. Two scalar reads, each one search of the table's b-tree. */
export async function journalSlices(env: Pick<Env, 'DB'>) {
  const range = await env.DB.prepare('SELECT (SELECT min(rowid) FROM legacy_import_rows) low,(SELECT max(rowid) FROM legacy_import_rows) high').first<{low: number | null; high: number | null}>()
  const slices: [number, number][] = []
  if (range?.low != null && range.high != null) for (let low = range.low; low <= range.high; low += LEGACY_SLICE_ROWS) slices.push([low, Math.min(low + LEGACY_SLICE_ROWS - 1, range.high)])
  return slices
}
