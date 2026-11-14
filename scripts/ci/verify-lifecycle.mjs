import {appendFile, readFile} from 'node:fs/promises';
import {execFileSync, spawnSync} from 'node:child_process';
import {planVerification} from './verify-plan.mjs';
import {githubEvidence} from './verify-evidence.mjs';
import {pushProof, verificationPlan} from './verify-inventory.mjs';

const shaShape = value => /^[a-f0-9]{40}$/.test(value ?? '') && !/^0+$/.test(value);
// Queries live throughout the server and module code, including selected Base
// sources. UI-only assets and documentation do not select the large fixture.
const sizePath = path => /^(?:migrations\/|scripts\/(?:size-check\/|installer\/|migrations\.mjs$)|src\/.*\.(?:[cm]?js|tsx?)$)/.test(path)
 || /\.sql$/.test(path) || /^(?:size-check\.json|package\.json|pnpm-lock\.yaml|wrangler\.jsonc|\.github\/workflows\/verify\.yml|scripts\/ci\/verify-lifecycle\.mjs)$/.test(path);

async function sizeCheckRequired(tier, env = process.env) {
 if (tier !== 'push' || !['push', 'pull_request'].includes(env.GITHUB_EVENT_NAME)) return true;
 try {
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});
  if (!shaShape(env.GITHUB_SHA) || git('rev-parse', 'HEAD').trim() !== env.GITHUB_SHA) return true;
  let comparison;
  if (env.GITHUB_EVENT_NAME === 'pull_request') {
   const {base, head} = event.pull_request ?? {};
   if (!shaShape(base?.sha) || !shaShape(head?.sha)) return true;
   comparison = [`${base.sha}...${head.sha}`];
  } else {
   // A new branch, unavailable history or ambiguous diff gets full size proof.
   if (!shaShape(event.before) || event.after !== env.GITHUB_SHA) return true;
   comparison = [event.before, env.GITHUB_SHA];
  }
  const diff = git('diff', '--name-status', '-z', '--find-renames', ...comparison, '--');
  if (!diff) return false;
  const records = diff.split('\0');
  if (records.pop() !== '') return true;
  while (records.length) {
   const status = records.shift();
   if (!/^(?:[AMD]|R\d+)$/.test(status)) return true;
   const count = status.startsWith('R') ? 2 : 1, paths = records.splice(0, count);
   if (paths.length !== count || paths.some(path => !path || sizePath(path))) return true;
  }
  return false;
 } catch {
  return true;
 }
}

async function sizeAwarePlan() {
 let decision = await planVerification({plan: verificationPlan});
 const selected = await sizeCheckRequired(decision.tier);
 if (selected && decision.tier === 'push' && decision.coverage !== 'full') {
  let covered = false;
  if (decision.coverage === 'reuse') try {
   const env = process.env, api = githubEvidence(env), current = await api.run(env.GITHUB_RUN_ID);
   const head = env.GITHUB_EVENT_NAME === 'pull_request'
    ? JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8')).pull_request.head.sha : env.GITHUB_SHA;
   const evidence = await api.newest(current, head, run => run.event === 'push' && Boolean(run.head_branch));
   covered = await api.proof(evidence, [...pushProof, 'size-check']);
  } catch { /* Missing size evidence selects the real check. */ }
  if (!covered) decision = {...decision, coverage: 'full', skip: false, readers: [],
   reason: 'Query or migration changes require successful size coverage',
   matrix: {include: verificationPlan.push.map(({name, browser}) => ({name, browser}))}};
 }
 return {...decision, size_check: selected && decision.coverage !== 'reuse'};
}

const mode = process.argv[2];
if (mode === '--plan') {
 const decision = await sizeAwarePlan();
 const output = Object.entries({...decision, matrix: JSON.stringify(decision.matrix), readers: JSON.stringify(decision.readers)})
  .map(([key, value]) => `${key}=${value}\n`).join('');
 if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output);
 process.stdout.write(output);
} else if (mode === '--light') {
 const readers = JSON.parse(process.env.LIGHT_READERS);
 const allowed = new Set(['node --test --test-concurrency=1 tests/journeys/public.mjs']);
 if (!Array.isArray(readers) || readers.some(command => !allowed.has(command))) throw Error('Unknown light reader');
 for (const command of readers) {
  const [executable, ...args] = command.split(' ');
  const result = spawnSync(executable, args, {stdio: 'inherit', shell: false});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
 }
} else if (mode === '--require-pr') {
 // Re-read the newest head push at the final gate, even after plan reuse.
 const env = process.env;
 if (env.GITHUB_EVENT_NAME === 'pull_request') {
  const event = JSON.parse(await readFile(env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (pr?.head?.repo?.full_name === env.GITHUB_REPOSITORY) {
   const api = githubEvidence(env), current = await api.run(env.GITHUB_RUN_ID);
   const evidence = await api.newest(current, pr.head.sha, run => run.event === 'push' && run.head_branch === pr.head.ref);
   if (!await api.proof(evidence, ['plan', 'verify'])) throw Error('The newest push Verify on the PR head must succeed.');
  }
 }
} else throw Error('Usage: verify-lifecycle.mjs --plan|--light|--require-pr');
