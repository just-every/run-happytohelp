import assert from 'node:assert/strict'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join, resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

// Pass the installed root of the published rer package as the sole argument.
const pkg = resolve(process.argv[2])
const load = path => import(pathToFileURL(join(pkg, path)))
const {D1} = await load('modules/container/adapters/d1.mjs')
const {generateMigrationEvidence} = await load('cli/portability-evidence.mjs')
const {createPortability, createPortabilityHandler, readArchive} = await load('modules/portability/index.mjs')
const {ArchiveVerifier} = await load('modules/portability/format.mjs')
const {workerMigrations} = await load('modules/portability/worker-history.mjs')
const schema = await readFile(join(pkg, 'modules/portability/schema/portability.sql'), 'utf8')
const root = await mkdtemp(join(tmpdir(), 'owner-history-repro-'))
const databases = []
const history = [
  ['core', '0001_records.sql', 'CREATE TABLE records(id TEXT PRIMARY KEY);'],
  ['owner', '0001_note.sql', 'ALTER TABLE records ADD COLUMN note TEXT;'],
  ['core', '0002_index.sql', 'CREATE INDEX records_note ON records(note);'],
]
try {
  for (const folder of ['core', 'owner']) await mkdir(join(root, folder))
  for (const [folder, name, sql] of history) await writeFile(join(root, folder, name), sql)
  await writeFile(join(root, 'package.json'), JSON.stringify({name: 'synthetic'}))
  await writeFile(join(root, 'wrangler.jsonc'), JSON.stringify({d1_databases: [{binding: 'DB', migrations_dir: 'core'}]}))
  await writeFile(join(root, 'rer-packaging.json'), JSON.stringify({
    artifact: {specInputs: {extraMigrationDirectories: [{binding: 'DB', path: 'owner', prefix: 'ext-'}]}},
  }))
  const evidence = await generateMigrationEvidence(root)
  const database = async name => {
    const db = new D1(join(root, name + '.sqlite'))
    databases.push(db)
    const columns = 'id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL'
    await db.exec(schema + `CREATE TABLE d1_migrations(${columns}); CREATE TABLE synthetic_ext_migrations(${columns});`)
    for (const [index, [folder, migration, sql]] of history.entries()) {
      await db.exec(sql)
      const table = folder === 'core' ? 'd1_migrations' : 'synthetic_ext_migrations'
      await db.prepare(`INSERT INTO ${table}(name,applied_at) VALUES(?,?)`).bind(migration, `2026-01-01 00:00:0${index}`).run()
    }
    return db
  }
  const policy = {product: 'synthetic-worker-restore'}
  const options = db => ({db, policy, migrations: () => workerMigrations(db, policy, evidence)})
  const source = await database('source')
  await source.prepare("INSERT INTO records VALUES('synthetic-record','retained')").run()
  const service = await createPortability(options(source))
  const id = await service.exports.create()
  while ((await service.exports.advance(id)).phase === 'building') {}
  const archive = []
  for await (const record of readArchive(await service.exports.download(id))) archive.push(record)
  const [original, ...records] = archive
  assert.deepEqual(original.migrations, ['0001_records.sql', 'ext-0001_note.sql', '0002_index.sql'])

  async function restore(manifest) {
    const target = await database('target-' + manifest.migrations.length)
    const origin = 'https://restore.invalid'
    const handler = await createPortabilityHandler({...options(target), appOrigin: origin, authorize: () => 'synthetic-owner'})
    const send = (suffix, method, body) => handler(new Request(origin + '/api/portability/imports' + suffix, {
      method, headers: {Origin: origin}, body: JSON.stringify(body),
    }))
    let response = await send('', 'POST', {confirmed: true, manifest})
    if (response.ok) {
      const {id} = await response.json()
      const verifier = new ArchiveVerifier(manifest)
      for (const part of records.slice(0, -1)) {
        verifier.add(part)
        const upload = await send(`/${id}/parts/${part.index}`, 'PUT', part)
        assert.equal(upload.status, 200)
      }
      response = await send(`/${id}/finalize`, 'POST', {...records.at(-1), archiveHash: verifier.digest()})
    }
    return {status: response.status, body: await response.json(), rows: (await target.prepare('SELECT * FROM records').all()).results}
  }

  const matched = await restore(original)
  assert.equal(matched.status, 200)
  assert.equal(matched.body.phase, 'complete')
  assert.deepEqual(matched.rows, [{id: 'synthetic-record', note: 'retained'}])
  console.log(JSON.stringify({case: 'matching', status: matched.status, rows: matched.rows.length}))

  const missing = structuredClone(original)
  missing.migrationLedger.entries.splice(1, 1)
  missing.migrations = missing.migrationLedger.entries.map(entry => entry.name)
  const refused = await restore(missing)
  console.log(JSON.stringify({case: 'owner entry omitted', ...refused}))
  assert.equal(refused.status, 409)
  assert.deepEqual(refused.rows, [])
  assert.deepEqual(refused.body, {error: 'schema_mismatch:owner_migration_history'})
} finally {
  for (const db of databases) await db.close()
  await rm(root, {recursive: true, force: true})
}
