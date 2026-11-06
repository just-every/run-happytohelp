import {appendFile, readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {planVerification} from './verify-plan.mjs';
import {githubEvidence} from './verify-evidence.mjs';
import {verificationPlan} from './verify-inventory.mjs';

const mode = process.argv[2];
if (mode === '--plan') {
 const decision = await planVerification({plan: verificationPlan});
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
