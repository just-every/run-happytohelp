import type {Env} from '../../../platform/env'
import {anchorTables,bindSets,delegationOf,delegationTables,given,inWorkspace,journalSlices,named,paced,type LegacyPerson} from './archive-sql'

/**
 * Who a legacy row belongs to, by its source (legacy-import/delta-scope.ts `contactsOf`), as sets of legacy ids read once per
 * erasure: the contact and the mailbox aliases erased with it; their conversations as the seed holds them and as legacy
 * journaled them (including ones the seed never held: skipped and archive-only ones); the messages of those conversations
 * and the ones the people wrote; their delegations and support events; their files, every file linked to one of those
 * messages, delegations or events (a delegation's upload and the internal note it is attached to), with every variant of
 * those files (an image's preview); and every link of those files.
 */

/** The seed's part of the first sets, given the conversations known so far. */
const seed = {
  people: 'SELECT ?2 id UNION SELECT contact_id FROM mailbox_contact_aliases WHERE project_id=?1 AND canonical_id=?2',
  own_conversations: `${given(1)}SELECT id FROM conversations WHERE project_id=?1 AND contact_id IN people`,
  own_messages: `${given(2)}SELECT id FROM messages WHERE project_id=?1 AND conversation_id IN own_conversations`,
  own_delegations: `${given(2)}SELECT id FROM local_jobs WHERE project_id=?1 AND conversation_id IN own_conversations`,
}
/** Which of the given ids the seed holds, as conversations, messages and delegations. */
const seedHeld = `SELECT id FROM conversations WHERE id IN (SELECT value FROM json_each(?1))
 UNION ALL SELECT id FROM messages WHERE id IN (SELECT value FROM json_each(?2))
 UNION ALL SELECT id FROM local_jobs WHERE id IN (SELECT value FROM json_each(?3))`

/**
 * One slice of the journal, by rowid, read in order (`+source_table` keeps D1 on the rowid range rather than walking the
 * source index of every one of those tables, which read 290,000 rows per slice on D1 at 1.2 M rows): the rows of the
 * tables the sets come from that may be the person's. A row qualifies when it names one of the people, or (outside conversations) a conversation, message or delegation known
 * to be theirs, or one the seed does not hold (only the journal can tell whose that is); every file and file link
 * qualifies. Binds ?1 project, ?2 contact, ?3-?6 the known people, conversations, messages and delegations, ?7-?8 the range.
 */
const candidates = `${given(4)}SELECT source_table t,source_id id,c,v,m,d,f,k,p,o FROM (SELECT source_table,source_id,
 ${named('contact_id')} c,${named('conversation_id')} v,${named('message_id')} m,${delegationOf} d,${named('media_id')} f,
 json_extract(source_json,'$.mediable_type') k,${named('mediable_id')} p,${named('original_media_id')} o
 FROM legacy_import_rows WHERE rowid BETWEEN ?7 AND ?8 AND +source_table IN (${anchorTables}) AND source_json<>'{}' AND ${inWorkspace})
WHERE source_table IN ('media','mediables') OR c IN people OR (source_table<>'conversations' AND (
 v IN own_conversations OR m IN own_messages OR d IN own_delegations
 OR (v IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations WHERE id=v))
 OR (m IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE id=m))
 OR (d IS NOT NULL AND NOT EXISTS(SELECT 1 FROM local_jobs WHERE id=d))))`
type Candidate = {t: string; id: string; c: string | null; v: string | null; m: string | null; d: string | null; f: string | null; k: string | null; p: string | null; o: string | null}
type Known = Pick<LegacyPerson, 'people' | 'own_conversations' | 'own_messages' | 'own_delegations'>

const delegations = new Set(delegationTables.split(',').map(table => table.slice(1, -1)))
/** A file link's parent model, as legacy names it (`App\Models\Message`); compared as SQL LIKE does, ignoring ASCII case. */
const parentIs = (link: Candidate, model: string) => String(link.k ?? '').toLowerCase().endsWith(model.toLowerCase())

/** The sets the candidates make, given what the seed contributes, in the order each depends on the ones before it. */
function resolve(known: Known, rows: Candidate[]): LegacyPerson {
  const ids = (match: (row: Candidate) => boolean, pick: (row: Candidate) => string | null = row => row.id) => rows.filter(match).map(pick).filter((id): id is string => id != null)
  const people = new Set(known.people), has = (set: Set<string>, id: string | null) => id != null && set.has(id)
  const conversations = new Set([...known.own_conversations, ...ids(row => row.t === 'conversations' && has(people, row.c))])
  const messages = new Set([...known.own_messages, ...ids(row => row.t === 'messages' && (has(conversations, row.v) || has(people, row.c)))])
  const delegated = new Set([...known.own_delegations, ...ids(row => delegations.has(row.t) && (has(people, row.c) || has(conversations, row.v) || has(messages, row.m)))])
  const names = (row: Candidate) => has(people, row.c) || has(conversations, row.v) || has(messages, row.m) || has(delegated, row.d)
  const events = new Set(ids(row => row.t === 'events' && names(row)))
  const parent = (row: Candidate) => parentIs(row, 'Message') ? has(messages, row.p) : parentIs(row, 'SupportDelegation') ? has(delegated, row.p) : parentIs(row, 'Event') ? has(events, row.p) : false
  const linked = new Set([...ids(row => row.t === 'mediables' && parent(row), row => row.f), ...ids(row => row.t === 'media' && names(row))])
  const files = new Set([...linked, ...ids(row => row.t === 'media' && has(linked, row.o))])
  return {people: [...people], own_conversations: [...conversations], own_messages: [...messages], own_delegations: [...delegated], own_events: [...events],
    own_files: [...files], own_links: [...new Set(ids(row => row.t === 'mediables' && (has(files, row.f) || names(row))))]}
}

/**
 * Read the person's legacy sets: the seed's part by index, the journal's in one ordered pass over the journal in rowid
 * slices, one bounded D1 call each. A row naming an id the seed holds as someone else's but the journal gives the person
 * (a conversation legacy had under them) is decided by another pass with that id known. Must run before any of the
 * person's rows is redacted.
 */
export async function legacyPerson(env: Pick<Env, 'DB'>, projectId: string, contactId: string): Promise<LegacyPerson> {
  const read = async (sql: string, ...sets: string[][]) => (await env.DB.prepare(sql).bind(projectId, contactId, ...sets.map(set => JSON.stringify(set))).all<{id: string | null}>()).results.flatMap(row => row.id == null ? [] : [String(row.id)])
  const people = await read(seed.people), slices = await journalSlices(env)
  let conversations = await read(seed.own_conversations, people), messages: string[] = [], delegated: string[] = []
  for (;;) {
    const known: Known = {people, own_conversations: conversations,
      own_messages: [...new Set([...await read(seed.own_messages, people, conversations), ...messages])],
      own_delegations: [...new Set([...await read(seed.own_delegations, people, conversations), ...delegated])]}
    const rows: Candidate[] = []
    for (const [low, high] of slices) rows.push(...(await paced(() => env.DB.prepare(candidates).bind(projectId, contactId, ...bindSets(known, 4), low, high).all<Candidate>())).results)
    const person = resolve(known, rows), added = (all: string[], before: string[]) => {const prior = new Set(before);return all.filter(id => !prior.has(id))}
    const fresh = [added(person.own_conversations, known.own_conversations), added(person.own_messages, known.own_messages), added(person.own_delegations, known.own_delegations)]
    if (!fresh.some(ids => ids.length)) return person
    const held = (await env.DB.prepare(seedHeld).bind(...fresh.map(ids => JSON.stringify(ids))).all<{id: string}>()).results
    if (!held.length) return person
    conversations = person.own_conversations; messages = person.own_messages; delegated = person.own_delegations
  }
}
