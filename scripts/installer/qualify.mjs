import {spawn} from 'node:child_process';

// Keep pnpm's npm_execpath for every fresh checkout. Node's test options must
// precede its filenames, including filters passed through `pnpm run`.
const child = spawn(process.execPath, [
  '--test', '--test-concurrency=1', ...process.argv.slice(2),
  'tests/journeys/installer-nightly.mjs', 'tests/journeys/upgrade-nightly.mjs', 'tests/journeys/deploy-nightly.mjs',
], {stdio: 'inherit', env: process.env});
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
