import {spawn} from 'node:child_process';
import {createRuntime} from '../../tests/helpers/emitted-runtime.mjs';

// Use the exact emitted Worker and isolated native storage, as the other shards do.
// Installer command coverage remains in the installer journeys; no rebuild here.
let runtime, child, interrupted = false, success = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  child?.kill(signal);
});
try {
  runtime = await createRuntime();
  if (interrupted) throw new Error('Public preview was interrupted');
  console.log(`Native public preview ready at ${runtime.origin}`);
  const code = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, ['scripts/ci/run-checks.mjs'], {
      stdio: 'inherit',
      env: {...process.env, H2H_TEST_ORIGIN: runtime.origin},
    });
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  success = code === 0 && !interrupted;
  process.exitCode = success ? 0 : 1;
} finally {
  if (runtime) await runtime.close(success);
}
