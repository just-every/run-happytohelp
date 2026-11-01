import {payloadBytes} from '../artifact-payloads.mjs';
import {spawn} from 'node:child_process';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {withArtifactStorage} from '../independent-storage.mjs';

// A separate harness leaves the historical independent-runtime and its helper
// byte-identical. Only one owner opens native state at a time.
export async function recoveryRuntime(artifact, {directory, port, inspectorPort, restoreFile, variables}) {
  await mkdir(directory, {recursive: true});
  for (const [folder, entries, key] of [['server', artifact.modules, 'name'], ['public', artifact.assets, 'path']]) {
    for (const entry of entries) {
      const path = join(directory, folder, entry[key]);
      await mkdir(dirname(path), {recursive: true});
      await writeFile(path, await payloadBytes(artifact, entry));
    }
  }
  const spec = artifact.deploymentSpec;
  await mkdir(join(directory, 'migrations'));
  for (const migration of spec.migrations) await writeFile(join(directory, 'migrations', migration.name), migration.sql);
  const config = {
    name: 'h2h-recovery-comparison', main: `server/${artifact.mainModule}`, no_bundle: true,
    rules: [{type: 'ESModule', globs: ['**/*.js', '**/*.mjs']}],
    compatibility_date: spec.compatibilityDate, compatibility_flags: spec.compatibilityFlags,
    assets: {directory: 'public'},
    d1_databases: [{binding: 'DB', database_name: 'recovery-db', database_id: 'recovery-local-only', migrations_dir: 'migrations'}],
    r2_buckets: [{binding: 'FILES', bucket_name: 'recovery-files'}],
    durable_objects: {bindings: spec.durableObjects.map(x => ({name: x.binding, class_name: x.className}))},
    migrations: spec.durableObjectMigrations.map(x => ({tag: x.tag, new_sqlite_classes: x.newSqliteClasses})),
    queues: {producers: [{binding: 'JOBS', queue: 'recovery-jobs'}, {binding: 'JOBS_DEAD_LETTER', queue: 'recovery-dead'}], consumers: [{queue:'recovery-jobs',max_batch_size:1,max_batch_timeout:0,max_retries:0}]},
    vars: {...spec.publicVariables, ...variables},
  };
  await writeFile(join(directory, 'wrangler.json'), JSON.stringify(config));
  const wrangler = resolve('node_modules/wrangler/bin/wrangler.js');
  const env = {PATH: process.env.PATH, TMPDIR:process.env.TMPDIR, CI: '1', WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH || join(directory, 'wrangler.log')};
  let child, storageOpen = false, logs = '';
  function launch(args) {
    const processRun = spawn(process.execPath, [wrangler, ...args, '--config', join(directory, 'wrangler.json')], {cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe']});
    processRun.stdout.on('data', b => {logs += b});
    processRun.stderr.on('data', b => {logs += b});
    return processRun;
  }
  const run = args => new Promise((done, reject) => {
    const processRun = launch(args);
    processRun.once('error', reject);
    processRun.once('exit', code => code === 0 ? done() : reject(new Error(`Wrangler exited ${code}: ${logs}`)));
  });
  const running = () => child && child.exitCode === null && child.signalCode === null;
  async function close() {
    if (running()) {
      const exited = new Promise(done => child.once('exit', done));
      child.kill('SIGTERM');
      let timer;
      await Promise.race([exited, new Promise(done => {timer = setTimeout(done, 3000)})]);
      clearTimeout(timer);
      if (running()) {child.kill('SIGKILL'); await exited;}
    }
    await writeFile(join(directory, 'runtime.log'), logs);
  }
  const origin = `http://127.0.0.1:${port}`;
  async function start() {
    if (storageOpen || running()) throw new Error('Native state already has an owner');
    child = launch(['dev', '--local', '--port', String(port), '--inspector-port', String(inspectorPort), '--ip', '127.0.0.1', '--persist-to', '.wrangler/state']);
    let spawnError;
    child.once('error', error => {spawnError = error});
    for (let i = 0; i < 160; i++) {
      if (spawnError) throw spawnError;
      try {
        const response = await fetch(`${origin}/health`);
        const health = await response.json();
        if (response.ok && health.database === 'reachable' && health.files === 'reachable') return;
      } catch {}
      if (!running()) break;
      await new Promise(done => setTimeout(done, 250));
    }
    await close();
    throw new Error(`Recovery runtime did not start: ${logs}`);
  }
  async function withStorage(visit) {
    if (storageOpen || running()) throw new Error('Native state already has an owner');
    storageOpen = true;
    try {return await withArtifactStorage(directory, config, visit)} finally {storageOpen = false}
  }
  try {
    await run(restoreFile
      ? ['d1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/state', '--file', restoreFile]
      : ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', '.wrangler/state']);
  } catch (error) {await close(); throw error}
  return {origin, directory, start, close, withStorage, run};
}
