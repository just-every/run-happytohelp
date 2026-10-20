import {constants} from 'node:fs';
import {lstat, open, unlink} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {orderSqlTriggers} from './sql-trigger-order.mjs';

const table = 'inbox_message_search';
const lookup = "SELECT type,sql FROM sqlite_master WHERE name='inbox_message_search'";
const rebuild = 'INSERT INTO "inbox_message_search"("inbox_message_search") VALUES(\'rebuild\');';
const drop = 'DROP TABLE IF EXISTS "inbox_message_search";';

async function definition(inspect) {
  const result = await inspect({sql: lookup});
  if (result?.success === false || !Array.isArray(result?.results)) throw new Error('Search index schema inspection failed.');
  if (result.results.length > 1) throw new Error('Search index schema is ambiguous.');
  return result.results[0];
}

function validate(row) {
  if (row.type !== 'table' || typeof row.sql !== 'string'
    || !/^CREATE\s+VIRTUAL\s+TABLE\s/i.test(row.sql)
    || !/\bUSING\s+fts5\s*\(/i.test(row.sql)
    || !/\bcontent\s*=\s*(['"])messages\1/i.test(row.sql)) {
    throw new Error('Refusing to drop an unrecognized inbox_message_search schema.');
  }
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
// Only this derived cache is removed: message rows and triggers stay untouched.
export async function exportD1Sql({inspect, runExport, output}) {
  if (typeof inspect !== 'function' || typeof runExport !== 'function' || typeof output !== 'string' || !isAbsolute(output)) {
    throw new Error('SQL export requires inspect, runExport and an absolute output path.');
  }
  const recovery = `${output}.search-index-recovery.sql`;
  try {
    await lstat(recovery);
    throw new Error(`A previous export left ${recovery}. Recover its search index before exporting again.`);
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  const original = await definition(inspect);
  if (original) validate(original);
  // Reserve a fresh private file before Wrangler can write any credentials.
  await privateFile(output);
  if (!original) {
    await runExport();
    return {output};
  }
  const create = original.sql + (original.sql.trimEnd().endsWith(';') ? '' : ';');
  const restore = `${create}\n${rebuild}\n`;
  // This survives SIGKILL or a machine interruption, including one during DROP.
  // DROP IF EXISTS makes manual recovery safe after a partial recreation too.
  await privateFile(recovery, `-- Keep all application writers stopped while recovering this derived cache.\n${drop}\n${restore}`);
  let failure, failed = false;
  try {
    await execute(inspect, drop);
    await runExport();
  } catch (error) {failure = error; failed = true;}
  finally {
    try {
      const current = await definition(inspect);
      if (current && current.sql !== original.sql) throw new Error('Search index schema changed during export; refusing to replace it.');
      if (!current) await execute(inspect, create);
      await execute(inspect, rebuild);
      await unlink(recovery);
    } catch (error) {
      const recoveryFailure = new Error(`Search index restoration failed. Keep writers stopped and execute ${recovery} against the same database.`, {cause: error});
      failure = failed ? new AggregateError([failure, recoveryFailure], recoveryFailure.message) : recoveryFailure;
      failed = true;
    }
  }
  if (failed) throw failure;
  // Wrangler omits the cache while exporting. Restore its exact definition and
  // rebuild after the authoritative rows, so an empty-target import is complete.
  const file = await open(output, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    const status = await file.stat();
    if (!status.isFile() || status.nlink !== 1 || status.size === 0) throw new Error('Wrangler did not produce a complete SQL export.');
    await file.chmod(0o600);
    await file.writeFile(`\n-- Derived conversation search cache, rebuilt from retained messages.\n${restore}`);
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
  return {output, derivedTable: table};
}
