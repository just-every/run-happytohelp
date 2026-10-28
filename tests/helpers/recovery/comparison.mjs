import {createHash} from 'node:crypto';
import {readArtifact} from '../artifact-payloads.mjs';
import {exportD1Sql} from '../../../scripts/installer/search-index-sql.mjs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFile, writeFile, mkdir, rm, copyFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {recoveryRuntime} from './runtime.mjs';
import {snapshot, compareSnapshots, summarize, sha256} from './snapshot.mjs';
import {seedJourney, verifyAccess, verifyFreshLogin, verifyRestoredApi, eraseRecoveryIssuer, setupToken} from './journey.mjs';

// Native export of a populated packaged install, restored into a fresh destination and compared row by row and object by object.
export async function recoveryComparison(buildDirectory, outputDirectory, profile='first-run'){

const buildRoot = resolve(buildDirectory), output = resolve(outputDirectory);
const build = JSON.parse(await readFile(join(buildRoot, 'build.json')));
const bytes = await readFile(join(buildRoot, 'delivery-artifact/artifact.json'));
assert.equal(sha256(bytes), build.artifactSha256, 'Artifact does not match build receipt');
const artifact = await readArtifact(join(buildRoot, 'delivery-artifact/artifact.json'));
const migrationNames = artifact.deploymentSpec.migrations.map(migration => migration.name);
assert.ok(migrationNames.length > 0, 'Recovery requires the real emitted migration ledger');
assert.equal(new Set(migrationNames).size, migrationNames.length, 'Each emitted migration must apply once');
assert.deepEqual(artifact.deploymentSpec.migrations.map(({name, sha256}) => ({name, sha256})), build.migrations);
await mkdir(output); // Refuse to silently reuse a previous run's state or receipt.
const startedAt = new Date().toISOString();
const port = Number(process.env.H2H_RECOVERY_PORT || 18260);
const variables = {H2H_SETUP_TOKEN: setupToken};
let original, restored;
try {
  original = await recoveryRuntime(artifact, {directory: join(output, 'source-runtime'), port, inspectorPort: port + 1, variables});
  await original.start();
  const journey = await seedJourney(original);
  await original.close();
  // Prior member fixture; issuance, use and erasure cross only the real public doors.
  const issuerId='synthetic-hh-recovery-issuer',issuerSession='synthetic-hh-recovery-issuer-session';
  await original.withStorage(async storage=>{
   const write=(sql,values=[])=>storage.inspect({sql,values});
   await write("INSERT INTO users VALUES(?,'synthetic-hh-recovery-issuer@example.test','Synthetic recovery issuer',1)",[issuerId]);
   await write("INSERT INTO memberships VALUES(?,?,'admin')",[journey.owner.projectId,issuerId]);
   const hash=createHash('sha256').update(issuerSession).digest('hex');
   await write("INSERT INTO sessions(token_hash,actor_id,project_id,role,expires_at) VALUES(?,?,?,'admin',?)",[hash,issuerId,journey.owner.projectId,Date.now()+3600000]);
   await write("INSERT INTO session_factors VALUES(?,?,'password',?)",[hash,issuerId,Date.now()]);
  });
  await original.start();
  await eraseRecoveryIssuer(original,journey,issuerId,issuerSession);
  await original.close();
  let before;
  await original.withStorage(async storage => {
    // Distinct object metadata and a zero-byte object exercise more than the
    // authenticated upload alone; pagination is intentionally bounded to two.
    for (const [suffix, bytes] of [['metadata', [0, 3, 255]], ['empty', []]]) {
      await storage.inspect({key: `${journey.owner.projectId}/recovery/${suffix}`, bytes, options: {httpMetadata: {contentType: 'application/octet-stream', cacheControl: 'private, max-age=73', contentDisposition: `attachment; filename="${suffix}.bin"`}, customMetadata: {purpose: 'recovery-comparison', unicode: 'café'}}});
    }
    // A delegated application grant and code exist in the source; the documented backup must not carry them.
    await storage.inspect({sql: "INSERT INTO edition_grants(id,installation_id,client_id,project_id,principal_id,scopes,targets,expires_at,token_hash,created_at) VALUES('recovery-grant','installation','client',?,'owner','[]','[]',9999999999999,'private-grant-hash',1)", values: [journey.owner.projectId]});
    await storage.inspect({sql: "INSERT INTO edition_codes(code_hash,grant_id,challenge,redirect_uri,expires_at) VALUES('private-code-hash','recovery-grant','challenge','https://client.example/callback',9999999999999)"});
    before = await snapshot(storage);
    const migrations = before.rows.d1_migrations.map(row => JSON.parse(row).name).sort();
    assert.deepEqual(migrations, artifact.deploymentSpec.migrations.map(m => m.name).sort(), 'Applied migration rows must match the emitted artifact');
    assert.ok(before.rows.messages.length > 0 && before.rows.sessions.length > 0 && before.rows.media.length > 0, 'Recovery requires populated native records');
    assert.ok(before.objects.length >= 3);
    const project = before.rows.projects.map(row => JSON.parse(row)).find(row => row.id === journey.owner.projectId);
    assert.match(project.verification_secret, /^[a-f0-9]{64}$/, 'Project verification secret must survive full row comparison');
  });
  const exportFile = join(output, 'native-export.sql');
  await exportD1Sql({inspect:input=>original.withStorage(storage=>storage.inspect(input)),runExport:()=>original.run(['d1','export','DB','--local','--output',exportFile]),output:exportFile});
  // The documented restore path: a credential-free backup made by the shipped sanitizer, never the raw export.
  const backupFile = join(output, 'restore.sql');
  const sanitized = spawnSync('python3', [resolve('scripts/independent/delegation-backup.py'), exportFile, backupFile], {encoding: 'utf8'});
  assert.equal(sanitized.status, 0, sanitized.stderr);
  const backup = await readFile(backupFile, 'utf8');
  assert.doesNotMatch(backup, /private-grant-hash|private-code-hash/, 'the backup carries no delegated credential');
  for (const table of ['edition_grants', 'edition_codes','integration_deliveries','native_integration_intents','native_integration_destinations','api_uploads','api_upload_disposals']) before.rows[table] = [];
  for(const table of ['integration_tokens','api_credentials','api_requests','api_appends'])before.rows[table]=before.rows[table].map(value=>{
   const row=JSON.parse(value);
   if(table==='api_credentials')row.revoked_at??=Math.max(1,row.created_at);
   else if(table==='integration_tokens'){assert.ok(!backup.includes(row.token_hash));row.token_hash='revoked:'+row.id;row.revoked_at??=Math.max(1,row.created_at)}
   else{row.response_json=null;if(table==='api_requests')row.erased=1}
   return JSON.stringify(row);
  }).sort();
  assert.ok(!backup.includes(journey.api.machine.token));
  for(const privateValue of ['synthetic-hh-recovery-issuer@example.test','Synthetic recovery issuer',journey.api.erasedIssuer.token])assert.ok(!backup.includes(privateValue));
  assert.ok(backup.includes('Synthetic retained recovery machine'));
  const exportedIssuer=before.rows.api_credentials.map(JSON.parse).find(row=>row.id===journey.api.erasedIssuer.data.id);assert.equal(exportedIssuer.issuer_id,null);assert.ok(exportedIssuer.revoked_at);
  assert.ok(before.rows.users.map(JSON.parse).some(row=>row.id===issuerId&&row.email==='erased:'+issuerId&&row.name==='Former teammate'));

  restored = await recoveryRuntime(artifact, {directory: join(output, 'restored-runtime'), port: port + 2, inspectorPort: port + 3, variables, restoreFile: backupFile});
  let after;
  await restored.withStorage(async storage => {
    assert.deepEqual((await snapshot(storage)).objects, [], 'Fresh target R2 must be empty');
    for (const object of before.objects) await storage.inspect({key: object.key, bytes: object.bytes, options: {httpMetadata: object.httpMetadata, customMetadata: object.customMetadata}});
    after = await snapshot(storage);
    compareSnapshots(before, after);
  });
  const repeatExport = join(output, 'restored-export.sql');
  await exportD1Sql({inspect:input=>restored.withStorage(storage=>storage.inspect(input)),runExport:()=>restored.run(['d1','export','DB','--local','--output',repeatExport]),output:repeatExport});
  const repeatBackup = join(output, 'restored-backup.sql');
  assert.equal(spawnSync('python3', [resolve('scripts/independent/delegation-backup.py'), repeatExport, repeatBackup]).status, 0);
  assert.equal(await readFile(repeatBackup, 'utf8'), backup, 'a backup of the restored install is identical to the backup it came from');
  await restored.start();
  await verifyAccess(restored, journey, journey.owner.token);
  await verifyFreshLogin(restored, journey);
  await verifyRestoredApi(restored, journey);
  await restored.close();
  const receipt = {
    profile, sourceSha: build.sourceSha, artifactSha256: build.artifactSha256, startedAt, finishedAt: new Date().toISOString(), node: process.version,
    tables: Object.keys(before.rows).length, migrations: artifact.deploymentSpec.migrations.length,
    nativeExportSha256: sha256(await readFile(exportFile)), restoredExportSha256: sha256(await readFile(repeatExport)),
    before: summarize(before), restored: summarize(after),
    checks: ['actual native D1 export and fresh D1 import', 'every schema definition and row compared', 'applied migration identities match artifact', 'empty fresh R2 target', 'all R2 bytes and HTTP/custom metadata compared', 'byte-identical native SQL re-export before login', 'retained session authenticated media and transcript', 'fresh password login authenticated media and transcript', 'unauthenticated media refused', 'restored setup stays closed'],
    boundaries: ['local emitted Worker, D1 and R2 only', 'no provider credentials supplied or live-provider qualification', 'Durable Object storage not exported', 'not complete RER export or production recovery qualification', 'the actual complete migrated schema and every row are compared without a fixed inventory'],
  };
  await writeFile(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({profile, sourceSha: build.sourceSha, tables: receipt.tables, migrations: receipt.migrations, objects: before.objects.length, result: 'PASS'}));
} finally {
  for (const runtime of [original, restored].filter(Boolean)) {
    await runtime.close();
    await copyFile(join(runtime.directory, 'runtime.log'), join(output, runtime === original ? 'source-runtime.log' : 'restored-runtime.log'));
    await rm(runtime.directory, {recursive: true, force: true});
  }
}

}
