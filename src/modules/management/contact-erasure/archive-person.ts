import type {Env} from '../../../platform/env'
import {bindSets,given,journalSlices,paced,type LegacyPerson} from './archive-sql'
import {collectSlice} from './archive-slice'

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

/** A file or file link, with the fields the person's files are resolved by; the parent model as legacy names it is kept as
 * which parent it is (`App\Models\Message`, compared as SQL LIKE does, ignoring ASCII case). */
type FileRow = {t: 'media' | 'mediables'; id: string; c: string | null; v: string | null; m: string | null; d: string | null; f: string | null; parent: 'message' | 'delegation' | 'event' | null; p: string | null; o: string | null}
type Slice = Omit<FileRow, 'parent' | 't' | 'id'> & {t: string; id: string; k: string | null}
type Known = Pick<LegacyPerson, 'people' | 'own_conversations' | 'own_messages' | 'own_delegations'>

const parentOf = (k: string | null): FileRow['parent'] => {
  const model = String(k ?? '').toLowerCase()
  return model.endsWith('message') ? 'message' : model.endsWith('supportdelegation') ? 'delegation' : model.endsWith('event') ? 'event' : null
}

type Kind = 'conversations' | 'messages' | 'delegations' | 'events'
/** The ids the slice statement's references are decided by, in the order of its open counts: conversations, messages, delegations. */
const referenced = ['conversations', 'messages', 'delegations'] as const
/** One slice as the pass last read it: the person's rows in it by table, its file rows, how many of its rows that are not hers
 * name a conversation, message or delegation not known to be hers, and how many such ids were known when it was read. */
interface SliceState {low: number; high: number; read: boolean; members: Record<Kind, string[]>; files: FileRow[]; open: number[]; known: number[]}

/** What one pass keeps between slices: per slice, the ids of the person's rows by table and the workspace's file rows. */
class Pass {
  slices: SliceState[]
  found = {conversations: new Set<string>(), messages: new Set<string>(), delegations: new Set<string>()}
  constructor(ranges: [number, number][]) {
    this.slices = ranges.map(([low, high]) => ({low, high, read: false, members: {conversations: [], messages: [], delegations: [], events: []}, files: [], open: [0, 0, 0], known: [0, 0, 0]}))
  }
  /** The found ids bound at ?9-?11. */
  bound() {return referenced.map(kind => JSON.stringify([...this.found[kind]]))}
  /** Record a slice as read; its file rows are read only the first time. Its own rows of the person were known to the
   * statement that read it, so they count as known to it. */
  record(state: SliceState, rows: Slice[]) {
    const members: Record<Kind, string[]> = {conversations: [], messages: [], delegations: [], events: []}
    for (const row of rows) {
      if (row.t === '#') state.open = JSON.parse(row.id)
      else if (row.t === 'media' || row.t === 'mediables') state.files.push({t: row.t, id: row.id, c: row.c, v: row.v, m: row.m, d: row.d, f: row.f, parent: parentOf(row.k), p: row.p, o: row.o})
      else {const kind: Kind = row.t === 'conversations' ? 'conversations' : row.t === 'messages' ? 'messages' : row.t === 'events' ? 'events' : 'delegations'; members[kind].push(row.id); if (kind !== 'events') this.found[kind].add(row.id)}
    }
    Object.assign(state, {read: true, members, known: referenced.map(kind => this.found[kind].size)})
  }
  /** A slice whose rows not hers name an id of a kind the pass found more of since it was read: deciding it again may add rows. */
  stale(state: SliceState) {return referenced.some((kind, i) => state.open[i] > 0 && this.found[kind].size > state.known[i])}
  /** Every slice's ids of the person's rows of `kind`, in journal order. */
  all<K extends Kind>(kind: K) {return this.slices.flatMap(state => state.members[kind])}
  /** The sets, given what the seed contributes, in the order each depends on the ones before it. */
  resolve(known: Known): LegacyPerson {
    const people = new Set(known.people), has = (set: Set<string>, id: string | null) => id != null && set.has(id)
    const conversations = new Set([...known.own_conversations, ...this.all('conversations')])
    const messages = new Set([...known.own_messages, ...this.all('messages')])
    const delegated = new Set([...known.own_delegations, ...this.all('delegations')])
    const events = new Set(this.all('events')), rows = this.slices.flatMap(state => state.files)
    const names = (row: FileRow) => has(people, row.c) || has(conversations, row.v) || has(messages, row.m) || has(delegated, row.d)
    const parent = (row: FileRow) => row.parent === 'message' ? has(messages, row.p) : row.parent === 'delegation' ? has(delegated, row.p) : row.parent === 'event' ? has(events, row.p) : false
    const ids = (match: (row: FileRow) => boolean, pick: (row: FileRow) => string | null = row => row.id) => rows.filter(match).map(pick).filter((id): id is string => id != null)
    const linked = new Set([...ids(row => row.t === 'mediables' && parent(row), row => row.f), ...ids(row => row.t === 'media' && names(row))])
    const files = new Set([...linked, ...ids(row => row.t === 'media' && has(linked, row.o))])
    return {people: [...people], own_conversations: [...conversations], own_messages: [...messages], own_delegations: [...delegated], own_events: [...events],
      own_files: [...files], own_links: [...new Set(ids(row => row.t === 'mediables' && (has(files, row.f) || names(row))))]}
  }
}

/**
 * Read the person's legacy sets: the seed's part by index, the journal's in an ordered pass over the journal in rowid slices,
 * one bounded D1 call each (archive-slice.ts), keeping between slices only the person's ids and the workspace's file rows.
 * A slice decides its rows by what is known when it is read; a row naming a conversation, message or delegation that a
 * later slice finds to be the person's is decided when its slice is read again with that id known, until no slice can
 * change. A row naming an id the seed holds as someone else's but the journal gives the person (a conversation legacy had
 * under them) is decided by another pass with that id known. Must run before any of the person's rows is redacted.
 * `lease` is renewed before each slice (contact-erasure/lease.ts).
 */
export async function legacyPerson(env: Pick<Env, 'DB'>, projectId: string, contactId: string, lease?: {renew(): Promise<void>}): Promise<LegacyPerson> {
  const read = async (sql: string, ...sets: string[][]) => (await env.DB.prepare(sql).bind(projectId, contactId, ...sets.map(set => JSON.stringify(set))).all<{id: string | null}>()).results.flatMap(row => row.id == null ? [] : [String(row.id)])
  const people = await read(seed.people), ranges = await journalSlices(env)
  let conversations = await read(seed.own_conversations, people), messages: string[] = [], delegated: string[] = []
  for (;;) {
    const known: Known = {people, own_conversations: conversations,
      own_messages: [...new Set([...await read(seed.own_messages, people, conversations), ...messages])],
      own_delegations: [...new Set([...await read(seed.own_delegations, people, conversations), ...delegated])]}
    const pass = new Pass(ranges), sets = bindSets(known, 4)
    const slice = async (state: SliceState) => {
      await lease?.renew()
      const found = pass.bound()
      pass.record(state, (await paced(() => env.DB.prepare(collectSlice).bind(projectId, contactId, ...sets, state.low, state.high, ...found, state.read ? 0 : 1).all<Slice>())).results)
    }
    for (const state of pass.slices) await slice(state)
    for (let again = pass.slices.filter(state => pass.stale(state)); again.length; again = pass.slices.filter(state => pass.stale(state)))
      for (const state of again) if (pass.stale(state)) await slice(state)
    const person = pass.resolve(known), added = (all: string[], before: string[]) => {const prior = new Set(before);return all.filter(id => !prior.has(id))}
    const fresh = [added(person.own_conversations, known.own_conversations), added(person.own_messages, known.own_messages), added(person.own_delegations, known.own_delegations)]
    if (!fresh.some(ids => ids.length)) return person
    const held = (await env.DB.prepare(seedHeld).bind(...fresh.map(ids => JSON.stringify(ids))).all<{id: string}>()).results
    if (!held.length) return person
    conversations = person.own_conversations; messages = person.own_messages; delegated = person.own_delegations
  }
}
