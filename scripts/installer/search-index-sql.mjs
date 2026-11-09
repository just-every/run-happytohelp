import {constants} from 'node:fs';
import {lstat, open, unlink} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {orderSqlTriggers} from './sql-trigger-order.mjs';

// Derived full-text indexes, each rebuilt from its external content (a table or a view).
// Wrangler cannot export a virtual table, so each is dropped around an export and recreated after it.
export const derivedSearchIndexes = [
  {table: 'inbox_message_search', content: 'messages'},
  {table: 'inbox_contact_search', content: 'inbox_contact_identity'},
  {table: 'contact_search', content: 'contact_search_identity'},
];
const quoted = name => '"' + name.replaceAll('"', '""') + '"';
const literal = value => typeof value === 'number' ? String(value) : "'" + String(value).replaceAll("'", "''") + "'";

async function definition(inspect, {table, content}) {
  const result = await inspect({sql: `SELECT type,sql FROM sqlite_master WHERE name='${table}'`});
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('Search index schema inspection failed.');
  if (result.results.length > 1) throw new Error('Search index schema is ambiguous.');
  const row = result.results[0];
  if (!row) return undefined;
  if (row.type !== 'table' || typeof row.sql !== 'string'
    || !/^CREATE\s+VIRTUAL\s+TABLE\s/i.test(row.sql)
    || !/\bUSING\s+fts5\s*\(/i.test(row.sql)
    || !new RegExp(`\\bcontent\\s*=\\s*(['"])${content}\\1`, 'i').test(row.sql)) {
    throw new Error(`Refusing to drop an unrecognized ${table} schema.`);
  }
  // FTS5 options set after creation (such as secure-delete) live in its config table.
  const config = await inspect({sql: `SELECT k,v FROM ${quoted(table + '_config')} WHERE k<>'version' ORDER BY k`});
  if (config?.success === false || !Array.isArray(config?.results)) throw new Error('Search index configuration inspection failed.');
  const create = row.sql + (row.sql.trimEnd().endsWith(';') ? '' : ';');
  const settings = config.results.map(({k, v}) => `INSERT INTO ${quoted(table)}(${quoted(table)},rank) VALUES(${literal(k)},${literal(v)});`);
  // Each statement runs alone: D1's command interface answers one statement per call.
  return {table, sql: row.sql, statements: [create, ...settings], rebuild: `INSERT INTO ${quoted(table)}(${quoted(table)}) VALUES('rebuild');`, drop: `DROP TABLE IF EXISTS ${quoted(table)};`};
}

async function definitions(inspect) {
  const found = [];
  for (const index of derivedSearchIndexes) {
    const current = await definition(inspect, index);
    if (current) found.push(current);
  }
  return found;
}

async function execute(inspect, sql) {
  const result = await inspect({sql});
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('Search index SQL execution failed.');
}

async function privateFile(path, contents = '') {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    await file.writeFile(contents);
    await file.sync();
  } finally {await file.close();}
}

// The caller must keep every writer stopped until this resolves or rejects.
// Only these derived caches are removed: their content rows and triggers stay untouched.
export async function exportD1Sql({inspect, runExport, output}) {
  if (typeof inspect !== 'function' || typeof runExport !== 'function' || typeof output !== 'string' || !isAbsolute(output)) {
    throw new Error('SQL export requires inspect, runExport and an absolute output path.');
  }
  const recovery = `${output}.search-index-recovery.sql`;
  try {
    await lstat(recovery);
    throw new Error(`A previous export left ${recovery}. Recover its search index before exporting again.`);
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  const originals = await definitions(inspect);
  // Reserve a fresh private file before Wrangler can write any credentials.
  await privateFile(output);
  if (!originals.length) {
    await runExport();
    return {output, derivedTables: []};
  }
  const restore = originals.map(index => `${index.statements.join('\n')}\n${index.rebuild}\n`).join('');
  // This survives SIGKILL or a machine interruption, including one during DROP.
  // DROP IF EXISTS makes manual recovery safe after a partial recreation too.
  await privateFile(recovery, `-- Keep all application writers stopped while recovering these derived caches.\n${originals.map(index => index.drop).join('\n')}\n${restore}`);
  let failure, failed = false;
  try {
    for (const index of originals) await execute(inspect, index.drop);
    await runExport();
  } catch (error) {failure = error; failed = true;}
  finally {
    try {
      for (const index of originals) {
        const current = await inspect({sql: `SELECT sql FROM sqlite_master WHERE name='${index.table}'`});
        if (current?.success === false || !Array.isArray(current?.results)) throw new Error('Search index schema inspection failed.');
        if (current.results[0] && current.results[0].sql !== index.sql) throw new Error('Search index schema changed during export; refusing to replace it.');
        if (!current.results[0]) for (const statement of index.statements) await execute(inspect, statement);
        await execute(inspect, index.rebuild);
      }
      await unlink(recovery);
    } catch (error) {
      const recoveryFailure = new Error(`Search index restoration failed. Keep writers stopped and execute ${recovery} against the same database.`, {cause: error});
      failure = failed ? new AggregateError([failure, recoveryFailure], recoveryFailure.message) : recoveryFailure;
      failed = true;
    }
  }
  if (failed) throw failure;
  // Wrangler omits the caches while exporting. Restore their exact definitions and
  // rebuild after the authoritative rows, so an empty-target import is complete.
  const file = await open(output, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const status = await file.stat();
    if (!status.isFile() || status.nlink !== 1 || status.size === 0) throw new Error('Wrangler did not produce a complete SQL export.');
    await file.chmod(0o600);
    await file.writeFile(`\n-- Derived search caches, rebuilt from retained messages and contacts.\n${restore}`);
    await file.sync();
  } finally {await file.close();}
  // Keep the native SQL restore usable as its additive schema grows. SQLite
  // definitions remain unchanged; only complete trigger statements move.
  const ordered = await open(output, constants.O_RDWR | constants.O_NOFOLLOW);
  try {
    const status = await ordered.stat();
    if (!status.isFile() || status.nlink !== 1) throw new Error('SQL export is not a private regular file.');
    const contents = orderSqlTriggers(await ordered.readFile('utf8'));
    await ordered.truncate(0);
    await ordered.write(contents, 0, 'utf8');
    await ordered.sync();
  } finally {await ordered.close();}
  return {output, derivedTables: originals.map(index => index.table)};
}
