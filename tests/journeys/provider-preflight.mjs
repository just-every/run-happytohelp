import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../..', import.meta.url));
const command = join(root, 'scripts/installer/provider-preflight.mjs');
const declaration = JSON.parse(await readFile(join(root, 'deploy.json'), 'utf8'));
const setup = JSON.parse(await readFile(join(root, 'rer-setup.json'), 'utf8'));
const claimToken = setup.steps.find(step => step.type === 'owner-claim').tokenField;
// Deliberately synthetic, never a provider credential or account.
const token = 'synthetic-happytohelp-1', account = '0'.repeat(32), worker = 'synthetic-happytohelp-2';
const target = ['--account-id', account, '--worker', worker], consent = '--consent-read-only';
const paths = [`/client/v4/accounts/${account}/workers/subdomain`, ...['settings', 'secrets'].map(name => `/client/v4/accounts/${account}/workers/scripts/${worker}/${name}`)];

async function run({args = [...target, consent], credential = token, scenario = 'complete'} = {}) {
 const directory = await mkdtemp(join(tmpdir(), 'h2h-provider-preflight-'));
 try {
  const bindings = [['d1', 'd1'], ['r2', 'r2_bucket'], ['kv', 'kv_namespace'], ['queues', 'queue'], ['durableObjects', 'durable_object_namespace'], ['services', 'service']]
   .flatMap(([key, type]) => (declaration[key] ?? []).map(row => ({name: row.binding, type})));
  bindings.push(...[...new Set([...Object.keys(declaration.vars ?? {}), declaration.originVar].filter(Boolean))].map(name => ({name, type: 'plain_text', text: 'synthetic-hidden-setting'})));
  const settings = {compatibility_date: declaration.compatibilityDate, compatibility_flags: declaration.compatibilityFlags, bindings, annotations: {'workers/message': 'synthetic-hidden-annotation'}};
  const secrets = declaration.secrets.filter(row => !row.optional).map(row => ({name: row.binding, type: 'secret_text'}));
  if (scenario === 'claimed') secrets.splice(secrets.findIndex(row => row.name === claimToken), 1);
  if (scenario.startsWith('missing-required:')) secrets.splice(secrets.findIndex(row => row.name === scenario.slice('missing-required:'.length)), 1);
  if (scenario === 'allowed-shapes') {
   delete settings.bindings;
   for (const row of secrets) row.type = 'secret_key';
   secrets.push({name: 'synthetic-key-name', type: 'secret_key', value: 'synthetic-hidden-value'}, {type: 'secret_key'});
  }
  secrets.push({name: 'synthetic-extra-name', type: 'secret_text', value: 'synthetic-hidden-value'});
  await writeFile(join(directory, 'fixture.json'), JSON.stringify({settings, secrets}));
  // This is the sole replacement: the command, parser, declaration reader and summary run unchanged.
  await writeFile(join(directory, 'network.mjs'), `
import {readFileSync, appendFileSync} from 'node:fs';
const fixture = JSON.parse(readFileSync('fixture.json', 'utf8'));
let count = 0;
globalThis.fetch = async (url, options = {}) => {
 const token = process.env.CLOUDFLARE_API_TOKEN;
 const {headers, ...other} = options;
 const actual = new Headers(headers), auth = actual.get('authorization');
 const tokenOnlyInAuthorization = auth === 'Bearer ' + token && !String(url).includes(token)
  && !JSON.stringify(other).includes(token) && [...actual].every(([name, value]) => name === 'authorization' || !value.includes(token));
 appendFileSync('requests.jsonl', JSON.stringify({url, method: options.method, body: options.body ?? null,
  redirect: options.redirect, headers: [...actual.keys()], tokenOnlyInAuthorization}) + '\\n');
 count++;
 const scenario = process.env.SCENARIO;
 if (scenario === 'network') throw Error('network echoed ' + token);
 if (scenario === 'redirect') return new Response(null, {status: 302, headers: {Location: 'https://elsewhere.example/' + token}});
 if (scenario.startsWith('http-') && count === Number(scenario.split('-')[2]))
  return new Response(JSON.stringify({success: false, errors: [{message: token}]}), {status: Number(scenario.split('-')[1])});
 if (scenario === 'malformed') return new Response(token);
 if (scenario === 'unsuccessful') return Response.json({success: false, errors: [{message: token}]});
 if (scenario === 'gaps') {
  fixture.settings.compatibility_date = '2000-01-01';
  fixture.settings.compatibility_flags = [];
  fixture.settings.bindings = fixture.settings.bindings.filter(row => row.type !== 'd1');
  fixture.secrets = fixture.secrets.filter(row => row.name !== 'INTEGRATION_ENCRYPTION_KEY');
 }
 if (scenario === 'bad-shape') fixture.secrets = {};
 const result = String(url).endsWith('/subdomain') ? {subdomain: 'synthetic-happytohelp'}
  : String(url).endsWith('/settings') ? fixture.settings : fixture.secrets;
 return Response.json({success: true, result});
};
`);
  const env = {PATH: process.env.PATH, HOME: directory, SCENARIO: scenario, CLOUDFLARE_API_TOKEN: credential};
  let result;
  try { result = {...await execute(process.execPath, ['--import', pathToFileURL(join(directory, 'network.mjs')).href, command, ...args], {cwd: directory, env, timeout: 20_000}), code: 0}; }
  catch (error) { result = {code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? ''}; }
  const files = await readdir(directory);
  const requests = files.includes('requests.jsonl') ? (await readFile(join(directory, 'requests.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse) : [];
  assert.ok(!result.stdout.includes(token) && !result.stderr.includes(token), 'credential never reaches stdout/stderr');
  for (const name of files) assert.ok(!(await readFile(join(directory, name), 'utf8')).includes(token), 'credential never reaches any created file');
  assert.deepEqual(files.sort(), ['fixture.json', 'network.mjs', ...(requests.length ? ['requests.jsonl'] : [])].sort(), 'command writes no files');
  for (const [index, request] of requests.entries()) {
   assert.equal(request.url, 'https://api.cloudflare.com' + paths[index]);
   assert.equal(request.method, 'GET'); assert.equal(request.body, null);
   assert.equal(request.redirect, 'manual'); assert.equal(request.tokenOnlyInAuthorization, true);
   assert.deepEqual(request.headers.sort(), ['accept', 'authorization']);
  }
  assert.match(result.stdout, /No mail was sent and nothing was changed\./);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-hidden-(?:setting|annotation|value)/);
  return {...result, requests};
 } finally { await rm(directory, {recursive: true, force: true}); }
}

test('an explicitly consented provider preflight reads exactly three GETs and reports declared settings and secret names without values or writes', async () => {
 const result = await run();
 assert.equal(result.code, 0); assert.equal(result.requests.length, 3); assert.equal(result.stderr, '');
 assert.match(result.stdout, new RegExp(`Read-only consent: account ${account}, Worker ${worker}`));
 assert.match(result.stdout, /Workers subdomain: "synthetic-happytohelp"/);
 assert.match(result.stdout, /Setting compatibility_date: present/);
 assert.match(result.stdout, /Binding DB \/ d1: present/);
 assert.match(result.stdout, /Secret NAME INTEGRATION_ENCRYPTION_KEY: present/);
 assert.match(result.stdout, /Secret NAME EMAIL_API_KEY: missing \(optional\)/);
 assert.match(result.stdout, /Other secret NAMES: "synthetic-extra-name"/);
 const claimed = await run({scenario: 'claimed'});
 assert.equal(claimed.code, 0); assert.equal(claimed.requests.length, 3);
 assert.ok(claimed.stdout.includes(`Secret NAME ${claimToken}: absent, spent after owner claim (lifecycle-optional)`));
 assert.match(claimed.stdout, /Read-only preflight complete/);
 assert.ok(result.stdout.includes(`Secret NAME ${claimToken}: present (lifecycle-optional)`));
 for (const row of declaration.secrets.filter(row => !row.optional && row.binding !== claimToken)) {
  const missingRequired = await run({scenario: `missing-required:${row.binding}`});
  assert.equal(missingRequired.code, 9); assert.equal(missingRequired.requests.length, 3);
  assert.ok(missingRequired.stdout.includes(`Secret NAME ${row.binding}: missing (required by deploy.json)`));
  assert.doesNotMatch(missingRequired.stdout, /preflight complete/);
 }
 const shapes = await run({scenario: 'allowed-shapes'});
 assert.equal(shapes.code, 9); assert.equal(shapes.requests.length, 3);
 assert.match(shapes.stdout, /Binding DB \/ d1: MISSING or mismatched/);
 assert.match(shapes.stdout, /Other secret NAMES:.*"synthetic-key-name"/);
 assert.doesNotMatch(shapes.stderr, /Unexpected provider response shape/);
 const gaps = await run({scenario: 'gaps'});
 assert.equal(gaps.code, 9); assert.equal(gaps.requests.length, 3);
 assert.match(gaps.stdout, /Setting compatibility_date: MISSING or mismatched/);
 assert.match(gaps.stdout, /Binding DB \/ d1: MISSING or mismatched/);
 assert.match(gaps.stdout, /Secret NAME INTEGRATION_ENCRYPTION_KEY: missing \(required/);
 assert.match(gaps.stderr, /missing or mismatched declared settings/);
});

test('provider preflight refuses absent consent and absent credentials distinctly before any network request', async () => {
 const unconsented = await run({args: target});
 assert.equal(unconsented.code, 3); assert.equal(unconsented.requests.length, 0);
 assert.match(unconsented.stderr, new RegExp(`Consent required: account ${account}, Worker ${worker}`));
 const uncredentialed = await run({credential: ''});
 assert.equal(uncredentialed.code, 4); assert.equal(uncredentialed.requests.length, 0);
 assert.match(uncredentialed.stderr, /Missing scoped token: set CLOUDFLARE_API_TOKEN/);
 const whitespace = await run({credential: '   '});
 assert.equal(whitespace.code, 4); assert.equal(whitespace.requests.length, 0);
 assert.match(whitespace.stderr, /Missing scoped token: set CLOUDFLARE_API_TOKEN/);
 assert.doesNotMatch(whitespace.stderr + whitespace.stdout, /\[REDACTED\]/);
 for (const args of [['--account-id', 'malformed', '--worker', worker, consent], ['--account-id', account, '--worker', 'not/a/worker', consent]]) {
  const malformed = await run({args});
  assert.equal(malformed.code, 2); assert.equal(malformed.requests.length, 0);
 }
 const unaddressed = await run({args: [consent]});
 assert.equal(unaddressed.code, 2); assert.equal(unaddressed.requests.length, 0);
 const credentialAsTarget = await run({args: ['--account-id', account, '--worker', token, consent]});
 assert.equal(credentialAsTarget.code, 10); assert.equal(credentialAsTarget.requests.length, 0);
 assert.match(credentialAsTarget.stderr, /Target identifiers must not contain CLOUDFLARE_API_TOKEN/);
 for (const args of [['--account-id', account, '--worker', `prefix-${token}`, consent], ['--account-id', `prefix-${token}`, '--worker', worker, consent]]) {
  const embedded = await run({args});
  assert.equal(embedded.code, 10); assert.equal(embedded.requests.length, 0);
  assert.match(embedded.stderr, /Target identifiers must not contain CLOUDFLARE_API_TOKEN/);
 }
});

test('provider authorization and missing Worker responses identify the failed read honestly without retry or error-body leakage', async () => {
 for (const [status, step, code, message] of [[401, 1, 5, /authorization refused.*Workers Scripts \/ Read/], [403, 2, 5, /authorization refused.*Workers Scripts \/ Read/], [403, 3, 5, /Worker secret names.*Workers Scripts \/ Read/], [404, 2, 6, /Worker was not found/], [404, 1, 6, /account Workers subdomain was not found/]]) {
  const result = await run({scenario: `http-${status}-${step}`});
  assert.equal(result.code, code); assert.equal(result.requests.length, step);
  assert.match(result.stderr, message); assert.doesNotMatch(result.stdout, /preflight complete/);
 }
});

test('provider transport, redirect and unreadable responses fail closed without following, retrying or exposing diagnostics', async () => {
 for (const [scenario, code, count, message] of [['network', 7, 1, /Network failure/], ['redirect', 8, 1, /redirect refused/], ['malformed', 8, 1, /Unreadable response/], ['unsuccessful', 8, 1, /Unsuccessful response/], ['bad-shape', 8, 3, /Unexpected provider response shape/]]) {
  const result = await run({scenario});
  assert.equal(result.code, code); assert.equal(result.requests.length, count);
  assert.match(result.stderr, message); assert.doesNotMatch(result.stdout, /preflight complete/);
 }
});
