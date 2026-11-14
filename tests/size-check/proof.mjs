import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { disposableBuild, probeSql } from './disposable-build.mjs';
import { runSize } from './public-cli.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
if (args[0] === '--help') {
  console.log('Usage: node tests/size-check/proof.mjs [--declaration size-check.json]');
  console.log('Requires an existing production build. Runs the full public size check twice on disposable local D1.');
  process.exit(0);
}
if (args.length && (args.length !== 2 || args[0] !== '--declaration')) throw new Error('Use --declaration FILE or --help.');
const declaration = resolve(root, args[1] ?? 'size-check.json');
const controller = new AbortController();
const interrupt = () => controller.abort();
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);

const statements = async directory => {
  const files = await Promise.all(['small', 'large'].map(async size => {
    const file = join(directory, `${size}.json`);
    const value = JSON.parse(await readFile(file, 'utf8'));
    assert.ok(Array.isArray(value.statements), `Missing ${size} public statement output.`);
    return value.statements;
  }));
  return files;
};
const isProbe = statement => statement.sql.replace(/\s+/g, ' ').trim().replace(/;$/, '') === probeSql;
const summary = (name, run, flow) => console.log(`${name}: exit ${run.exitCode}; inbox-list ${flow.small.rowsRead} -> ${flow.large.rowsRead} rows; status ${flow.small.status}/${flow.large.status}; ${flow.failures.map(item => item.rule).join(',') || 'pass'}`);

let fixture;
try {
  fixture = await disposableBuild(root, declaration);
  console.log('Running control through pnpm exec rer size --declaration FILE --write-statements DIR --json');
  const controlDirectory = join(fixture.directory, 'control-statements');
  const control = await runSize(root, declaration, controlDirectory, controller.signal);
  assert.equal(control.exitCode, 0, 'The unchanged application must pass before the fault is tested.');
  assert.equal(control.result.ok, true, 'The public control verdict must pass.');
  assert.ok(control.result.flows?.length > 0, 'The control must measure declared flows.');
  assert.ok(control.result.flows.every(flow => flow.ok), 'Every original declared flow must pass.');
  const clean = control.result.flows.find(flow => flow.name === fixture.flow);
  assert.ok(clean, 'The control must measure inbox-list.');
  assert.equal(clean.small.status, 200, 'The real small inbox request must succeed.');
  assert.equal(clean.large.status, 200, 'The real large inbox request must succeed.');
  const cleanStatements = await statements(controlDirectory);
  assert.ok(cleanStatements.every(size => !size.some(isProbe)), 'The control unexpectedly contains the deliberate query.');
  summary('Control', control, clean);

  console.log('Running copied build with the deliberate unbounded query through the same public command');
  const faultDirectory = join(fixture.directory, 'fault-statements');
  const fault = await runSize(root, fixture.declaration, faultDirectory, controller.signal);
  assert.equal(fault.exitCode, 1, 'The public size command must reject the deliberate fault.');
  assert.equal(fault.result.ok, false, 'The public fault verdict must fail.');
  const broken = fault.result.flows?.find(flow => flow.name === fixture.flow);
  assert.ok(broken && !broken.ok, 'The failure must identify inbox-list.');
  assert.ok(broken.failures.some(failure => failure.rule === 'growth'), 'The unbounded query must fail growth.');
  assert.ok(broken.failures.some(failure => failure.rule === 'ceiling'), 'The unbounded query must exceed the inbox ceiling.');
  assert.ok(broken.failures.every(failure => ['growth', 'ceiling'].includes(failure.rule)), 'A status or SQL error cannot establish the size proof.');
  assert.equal(broken.small.status, clean.small.status, 'Small inbox status changed.');
  assert.equal(broken.large.status, clean.large.status, 'Large inbox status changed.');
  assert.ok(broken.large.rowsRead > broken.small.rowsRead, 'The measured query must grow with the fixture.');
  assert.ok(fault.result.flows.filter(flow => flow.name !== fixture.flow).every(flow => flow.ok), 'The deliberate fault must be isolated to inbox-list.');
  const injectedStatements = await statements(faultDirectory);
  assert.ok(injectedStatements.every(size => size.some(statement => isProbe(statement) && statement.name.startsWith(`${fixture.flow} #`))), 'Both public statement files must attribute the deliberate query to inbox-list.');
  summary('Deliberate fault', fault, broken);
  console.log(`Proof passed: ${control.result.flows.length} original flows pass; the injected full-table query fails the public size check.`);
} catch (error) {
  console.error(`Size proof failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (fixture) await fixture.close();
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
