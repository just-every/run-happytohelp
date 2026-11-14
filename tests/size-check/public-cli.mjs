import { spawn } from 'node:child_process';

// Use the installed public command, never rer's implementation modules. Keep
// fixture SQL/parameters and bootstrap output private to this disposable run.
export function runSize(root, declaration, statements, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'rer', 'size', '--declaration', declaration, '--write-statements', statements, '--json'], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    });
    let pending = '', result, errorCode, killTimer, spawnError;
    const line = text => {
      try {
        const event = JSON.parse(text);
        if (event.verb !== 'size') return;
        if (event.event === 'result') result = event;
        if (event.event === 'error') errorCode = event.code;
      } catch { /* Native build progress is not a CLI result. */ }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\n')) >= 0) {
        line(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    });
    child.stderr.resume();
    const kill = value => {
      if (!child.pid) return;
      try { process.kill(-child.pid, value); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    };
    const abort = () => {
      kill('SIGTERM');
      killTimer = setTimeout(() => kill('SIGKILL'), 5000);
      killTimer.unref();
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    child.on('error', error => { spawnError = error; });
    child.on('close', (exitCode, terminated) => {
      clearTimeout(killTimer);
      signal.removeEventListener('abort', abort);
      if (pending) line(pending);
      if (signal.aborted) return reject(new Error('Size proof interrupted; its disposable build was closed.'));
      if (spawnError) return reject(new Error(`Cannot start public size command (${spawnError.code ?? 'spawn error'}).`));
      if (!result) return reject(new Error(`Public size command produced no verdict (exit ${exitCode ?? terminated}, code ${errorCode ?? 'unknown'}).`));
      resolve({ exitCode, result });
    });
  });
}
