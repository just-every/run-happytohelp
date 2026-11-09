import {anchorTables,delegationTables,given} from './archive-sql'

/** A legacy id the journal row `r` names, as text (archive-sql.ts `named`). */
const named = (field: string) => `CAST(json_extract(r.source_json,'$.${field}') AS TEXT)`
const file = (tables: string, value: string) => `CASE WHEN r.source_table IN (${tables}) THEN ${value} END`
const unheld = (column: string, table: string) => `(${column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${table} WHERE id=${column}))`

/**
 * One slice of the journal for the collect pass (archive-person.ts), by rowid, read in order (`+source_table` keeps D1 on
 * the rowid range rather than walking the source index of every one of those tables, which read 290,000 rows per slice on
 * D1 at 1.2 M rows). The slice's rows of the tables the sets come from are read once (`slice`); the person's rows among
 * them are decided inside the statement by set membership alone, with no lookup per row:
 * - her conversations: the seed's (own_conversations), those the pass found in other slices (found_conversations) and
 *   the slice's conversation rows naming one of the people;
 * - of the rows that may be hers (`candidates`: a message, delegation or support event naming one of the people, a
 *   conversation, message or delegation known to be theirs, or one the seed does not hold), her messages (naming one of
 *   the people or her conversations), then her delegations (or her messages), then her events (or her delegations).
 * It returns every file and file link of the slice when ?12 is 1, her rows with their table and id, and one row `#` with
 * how many of the slice's candidates that are not hers name a conversation, message or delegation not known to be hers:
 * one found later in the pass makes them worth deciding again. Binds ?1 project, ?2 contact, ?3-?6 the known people,
 * conversations, messages and delegations, ?7-?8 the range, ?9-?11 her conversations, messages and delegations found so
 * far in the pass, ?12 whether to return the file rows.
 */
export const collectSlice = `${given(4).trimEnd()},
 found_conversations(id) AS MATERIALIZED (SELECT value FROM json_each(?9)),
 found_messages(id) AS MATERIALIZED (SELECT value FROM json_each(?10)),
 found_delegations(id) AS MATERIALIZED (SELECT value FROM json_each(?11)),
 slice AS MATERIALIZED (SELECT r.rowid i,r.source_table t,r.source_id id,${named('contact_id')} c,${named('conversation_id')} v,${named('message_id')} m,
  coalesce(${named('support_delegation_id')},${named('job_id')}) d,${file("'mediables'", named('media_id'))} f,
  ${file("'mediables'", "json_extract(r.source_json,'$.mediable_type')")} k,${file("'mediables'", named('mediable_id'))} p,${file("'media'", named('original_media_id'))} o
  FROM legacy_import_rows r WHERE r.rowid BETWEEN ?7 AND ?8 AND +r.source_table IN (${anchorTables}) AND r.source_json<>'{}' AND coalesce(${named('project_id')},?1)=?1),
 candidates AS MATERIALIZED (SELECT i,t,id,c,v,m,d FROM slice WHERE t NOT IN ('media','mediables','conversations') AND (c IN people
  OR v IN own_conversations OR m IN own_messages OR d IN own_delegations
  OR ${unheld('v', 'conversations')} OR ${unheld('m', 'messages')} OR ${unheld('d', 'local_jobs')})),
 person_conversations(id) AS MATERIALIZED (SELECT id FROM own_conversations UNION SELECT id FROM found_conversations
  UNION SELECT id FROM slice WHERE t='conversations' AND c IN people),
 person_messages(id) AS MATERIALIZED (SELECT id FROM own_messages UNION SELECT id FROM found_messages
  UNION SELECT id FROM candidates WHERE t='messages' AND (c IN people OR v IN person_conversations)),
 person_delegations(id) AS MATERIALIZED (SELECT id FROM own_delegations UNION SELECT id FROM found_delegations
  UNION SELECT id FROM candidates WHERE t IN (${delegationTables}) AND (c IN people OR v IN person_conversations OR m IN person_messages)),
 decided AS MATERIALIZED (SELECT i,t,id,v,m,d,coalesce(CASE WHEN t='messages' THEN c IN people OR v IN person_conversations
  WHEN t IN (${delegationTables}) THEN c IN people OR v IN person_conversations OR m IN person_messages
  ELSE c IN people OR v IN person_conversations OR m IN person_messages OR d IN person_delegations END,0) hers FROM candidates)
SELECT i,t,id,NULL c,NULL v,NULL m,NULL d,NULL f,NULL k,NULL p,NULL o FROM decided WHERE hers
UNION ALL SELECT i,t,id,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL FROM slice WHERE t='conversations' AND c IN people
UNION ALL SELECT i,t,id,c,v,m,d,f,k,p,o FROM slice WHERE ?12 AND t IN ('media','mediables')
UNION ALL SELECT NULL,'#',json_array(
  coalesce(sum(v IS NOT NULL AND v NOT IN person_conversations),0),
  coalesce(sum(t<>'messages' AND m IS NOT NULL AND m NOT IN person_messages),0),
  coalesce(sum(t='events' AND d IS NOT NULL AND d NOT IN person_delegations),0)),NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL FROM decided WHERE NOT hers
ORDER BY 1`
