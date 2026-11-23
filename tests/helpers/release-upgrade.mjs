import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, mkdir, readFile, writeFile, copyFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {collectMigrations} from '../../scripts/migrations.mjs';
import {createRuntime} from './emitted-runtime.mjs';
import {baselines, populate03, repository} from './upgrade-baselines.mjs';
import {findDatabase, snapshot, schema, bucketSnapshot} from './upgrade-snapshot.mjs';
import {expectedMigrationRows, expectedSchema, schemaExceptions} from './upgrade-exceptions.mjs';
import {readBack, priorState} from './upgrade-readback.mjs';
import {restoredOwnerEntryReady} from './recovery/knowledge-ready.mjs';


// Prior-data upgrade: build each released source, populate it through its own
// API, apply this source's migrations in place, compare every pre-existing row,
// then serve the upgraded store with this source's emitted Worker.
// Usage: node --test tests/journeys/upgrade-nightly.mjs after `pnpm run build`; H2H_UPGRADE_RELEASES=0.4.1 selects releases.
const run = promisify(execFile);
const root = resolve(new URL('../..', import.meta.url).pathname);
const release = JSON.parse(await readFile(join(root, 'RELEASE.json'), 'utf8'));
assert.match(release.previousVersion ?? '', /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/, 'RELEASE.json must name the previous version');
const evidence = process.env.H2H_EVIDENCE_DIR;
const command = async (file, args, cwd) => {
  try { return (await run(file, args, {cwd, maxBuffer: 64 * 1024 * 1024})).stdout; }
  catch (error) { console.error(error.stdout, error.stderr); throw error; }
};

// Fetch the published baseline into its own throwaway repository: no private
// clone, lazy blob fetch or change to this checkout's Git state is involved.
async function extract(ref, directory) {
  const git = join(directory, 'baseline.git'), archive = join(directory, 'source.tar'), source = join(directory, 'source');
  await command('git', ['init', '--quiet', '--bare', git], directory);
  await command('git', ['--git-dir', git, 'fetch', '--quiet', '--no-tags', '--depth=1', repository, ref], directory);
  const commit = (await command('git', ['--git-dir', git, 'rev-parse', 'FETCH_HEAD^{commit}'], directory)).trim();
  const tree = (await command('git', ['--git-dir', git, 'rev-parse', `${commit}^{tree}`], directory)).trim();
  await mkdir(source);
  await command('git', ['--git-dir', git, 'archive', '--format=tar', '--output=' + archive, commit], directory);
  await command('tar', ['-xf', archive, '-C', source]);
  return {source, commit, tree};
}

async function upgrade(label) {
  const isPredecessor = label === release.previousVersion;
  const baseline = Object.hasOwn(baselines, label) ? baselines[label] : undefined;
  assert.ok(baseline || isPredecessor, `Unknown baseline ${label}`);
  const ref = isPredecessor ? `refs/tags/v${label}` : baseline.commit;
  const started = Date.now(), directory = await mkdtemp(join(tmpdir(), `h2h-upgrade-${label}-`));
  let previous, current, runtimeDirectory, success = false;
  try {
    const {source, commit, tree} = await extract(ref, directory);
    if (baseline) {
      assert.equal(commit, baseline.commit);
      assert.equal(tree, baseline.tree);
    }
    if (isPredecessor) {
      const manifest = JSON.parse(await readFile(join(source, 'RELEASE.json'), 'utf8'));
      assert.equal(manifest.version, label, 'The predecessor tag must match its release manifest');
    }
    await command('pnpm', ['install', '--frozen-lockfile'], source);
    await command('pnpm', ['run', 'build'], source);
    const applied = JSON.parse(await command(process.execPath, ['scripts/migrations.mjs'], source)).files;
    if (baseline) assert.equal(applied.length, baseline.migrations);
    const {createRuntime: createBaseline} = await import(pathToFileURL(join(source, 'tests/helpers/emitted-runtime.mjs')));
    previous = await createBaseline();
    assert.equal(previous.migrationCount, applied.length);
    const populate = baseline?.populate ?? populate03;
    const data = await populate(previous.origin, previous);
    // close(false) keeps the baseline's state (its helper reports it as retained); it is upgraded in place here.
    runtimeDirectory = previous.directory; await previous.close(false); previous = undefined;
    const state = join(runtimeDirectory, 'state');
    const database = await findDatabase(join(state, 'v3/d1'));
    const before = snapshot(database), beforeSchema = schema(database), beforeFiles = await bucketSnapshot(join(state, 'v3/r2'));
    const prior = priorState(database, data.owner.email);
    if (baseline?.tables) assert.equal(Object.keys(before).length, baseline.tables);
    for (const table of ['projects', 'users', 'memberships', 'sessions', 'contacts', 'conversations', 'messages', 'knowledge_articles']) assert.ok(before[table].rows.length > 0, `${table} must contain real journey rows`);
    // Applied migration names and bytes are immutable.
    const headMigrations = await collectMigrations();
    for (const name of applied) assert.equal(await readFile(join(source, '.generated/migrations', name), 'utf8'), await readFile(join(headMigrations.directory, name), 'utf8'), `Applied migration changed: ${name}`);
    for (const name of headMigrations.files) await copyFile(join(headMigrations.directory, name), join(runtimeDirectory, 'migrations', name));
    await command(process.execPath, [join(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'migrations', 'apply', 'DB', '--local', '--config', join(runtimeDirectory, 'wrangler.json'), '--persist-to', state], runtimeDirectory);
    const ledger = new DatabaseSync(database, {readOnly: true});
    const order = ledger.prepare('SELECT name FROM d1_migrations ORDER BY id').all().map(row => row.name).slice(before.d1_migrations.rowCount);
    if (!applied.includes('120_activation_observations.sql') && headMigrations.files.includes('120_activation_observations.sql')) {
      const column = ledger.prepare('PRAGMA table_info(activation_receipts)').all().find(row => row.name === 'observation_json');
      assert.equal(column?.type, 'TEXT');
      assert.equal(column.notnull, 0);
      assert.equal(column.dflt_value, null);
      assert.equal(ledger.prepare('SELECT count(*) AS count FROM activation_receipts WHERE observation_json IS NOT NULL').get().count, 0, '120 does not backfill prior observations');
    }
    ledger.close();
    const after = snapshot(database, before), afterFiles = await bucketSnapshot(join(state, 'v3/r2'));
    const {expected, added, exceptions} = expectedMigrationRows(before, after, headMigrations.files, beforeSchema);
    const changedSchema = expectedSchema(beforeSchema, schema(database), added);
    const comparison = Object.entries(before).filter(([table]) => table !== 'd1_migrations').map(([table, value]) => {
      const identical = JSON.stringify(value.rows) === JSON.stringify(after[table]?.rows);
      return {table, beforeRows: value.rowCount, afterRows: after[table]?.rowCount, identical, matchesExpected: JSON.stringify(expected[table] ?? value.rows) === JSON.stringify(after[table]?.rows), ...(identical ? {} : {removedRows: value.rows.filter(row => !after[table]?.rows.includes(row)), addedRows: after[table]?.rows.filter(row => !value.rows.includes(row))})};
    });
    const receipt = {
      baseline: label, baselineCommit: commit, baselineTree: tree, sourceCommit: (await command('git', ['rev-parse', 'HEAD'], root)).trim(),
      populatedThroughApi: Object.keys(data), baselineTables: Object.keys(before).length, baselineMigrations: applied.length, finalTables: Object.keys(after).length, finalMigrations: after.d1_migrations.rowCount,
      appliedByUpgrade: added, appliedOrder: order, appliedMigrationBytesUnchanged: applied.length,
      rowsWithData: Object.fromEntries(Object.entries(before).filter(([, value]) => value.rowCount).map(([table, value]) => [table, value.rowCount])),
      comparison, failures: comparison.filter(row => !row.matchesExpected).map(row => row.table), migrationExceptions: exceptions,
      schema: {definitions: Object.keys(beforeSchema).length, changedOutsideExceptions: changedSchema, exceptions: schemaExceptions.filter(exception => added.includes(exception.migration))},
      files: {objects: beforeFiles.objects.length, blobs: beforeFiles.blobs.length, identical: JSON.stringify(beforeFiles) === JSON.stringify(afterFiles)},
    };
    assert.deepEqual(order, added, 'Upgrade applied exactly the missing migrations in order');
    assert.deepEqual(receipt.failures, [], 'Pre-existing application rows changed outside exact migration exceptions');
    assert.deepEqual(changedSchema, [], 'Prior schema changed outside the listed replacements');
    // Older manifests can also declare pending source migrations. Both lists
    // declare membership; Wrangler orders their filenames by numeric prefix.
    if (isPredecessor) {
      const {migrations, pendingMigrations = []} = release;
      assert.ok(Array.isArray(migrations), 'RELEASE.json migrations must be an array');
      assert.ok(Array.isArray(pendingMigrations), 'RELEASE.json pendingMigrations must be an array when present');
      const declared = [...migrations, ...pendingMigrations].map(migration => migration.id)
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10) || (a < b ? -1 : a > b ? 1 : 0));
      assert.deepEqual(order, declared, 'The previous release receives exactly the listed release and pending source migrations in order');
    }
    assert.ok(receipt.files.identical, 'Stored files changed during upgrade');
    current = await createRuntime({persist: state, queueConsumers: true});
    // Projects created after the bounded-conversion migration already carry
    // their completed conversion report. An in-place upgrade retains that proof;
    // older releases must still exercise the maintenance fence and real queue.
    if (applied.includes('296_knowledge_upgrade_progress.sql')) {
      assert.equal((await fetch(`${current.origin}/api/identity/setup`)).status, 200, 'an in-place upgrade retains completed knowledge conversion');
    } else {
      await restoredOwnerEntryReady(current);
    }
    receipt.readBack = await readBack(current.origin, database, data, prior);
    receipt.seconds = Math.round((Date.now() - started) / 1000);
    if (evidence) { await mkdir(evidence, {recursive: true}); await writeFile(join(evidence, `upgrade-${label}.json`), JSON.stringify(receipt, null, 2) + '\n'); }
    console.log(`${label}: ${receipt.baselineTables} tables / ${receipt.baselineMigrations} migrations -> ${receipt.finalTables} / ${receipt.finalMigrations}; ${comparison.filter(row => row.identical).length}/${comparison.length} prior tables identical, ${comparison.filter(row => row.matchesExpected).length}/${comparison.length} as expected; ${receipt.files.objects} stored files identical; read back on this Worker in ${receipt.seconds}s`);
    success = true;
  } finally {
    if (previous) await previous.close(false);
    if (current) await current.close(success);
    if (success) for (const path of [directory, runtimeDirectory].filter(Boolean)) await rm(path, {recursive: true, force: true});
    else console.error(`Upgrade ${label} failure evidence retained:`, directory);
  }
}

export async function releaseUpgrades(labels = [release.previousVersion, ...Object.keys(baselines)]) {
  for (const label of new Set(labels)) await upgrade(label);
}

