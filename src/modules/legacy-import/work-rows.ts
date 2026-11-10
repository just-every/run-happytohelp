import {sqlName} from './d1'
import {batchRemovedTables} from './delta-scope'

/** `inbox_visitor_waiting` (migration 314) is derived from visitor authorship rows, which imported messages now carry. A
 * conversation whose last imported message is the visitor's is history, not a visitor waiting for the team ("imported
 * history never counts"), so the rows the batch's authorship inserts derive are removed with the work rows (the delete
 * trigger re-derives the inbox entry's flags). A native message later in the conversation re-derives it as it would any. */
const removed=[...batchRemovedTables,'inbox_visitor_waiting']

/** Rows the app's own triggers add as a side effect of a batch's canonical writes (integration events, workflow journal,
 * resolutions, mail and notification work) are removed again before the batch commits, so an import starts nothing:
 * `check.mjs work` counts are unchanged and no scheduler, fan-out or survey dispatcher finds work it caused. The batch
 * marks each table's highest rowid first and deletes only rows above its own mark: rows from before the batch stay. The
 * marks live in `legacy_import_marks`, only inside this one D1 transaction. */
export function markWorkRows(db:D1Database){
 return removed.map(t=>db.prepare(`INSERT INTO legacy_import_marks(name,high) SELECT '${t}',COALESCE(MAX(rowid),0) FROM ${sqlName(t)}`))
}
/** Delete what the batch's triggers added since `markWorkRows`, children before parents, then drop the marks. */
export function purgeWorkRows(db:D1Database){
 return [...removed.map(t=>db.prepare(`DELETE FROM ${sqlName(t)} WHERE rowid>(SELECT high FROM legacy_import_marks WHERE name='${t}')`)),db.prepare('DELETE FROM legacy_import_marks')]
}
