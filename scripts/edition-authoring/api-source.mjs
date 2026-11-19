// --from-api retains its snapshot semantics, but acquires immutable Git objects
// in packs over HTTPS. This spends no GitHub REST core allowance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {hash, safe} from './files.mjs';
import {offlineRepository} from './offline-git.mjs';

const limit = 64 * 1024 * 1024, commit = /^[a-f0-9]{40}$/;
const objectId = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');

export function apiReader(repository, revision) {
  if (!commit.test(revision)) throw Error('Base API requires an immutable full 40-character commit');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('--from-api requires a GitHub Base repository');
  const remote = `https://github.com/${repository}.git`;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'base-api-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^GIT_(?:DIR|COMMON_DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|SHALLOW_FILE|NAMESPACE|QUARANTINE_PATH|REPLACE_REF_BASE)$/.test(name)));
  Object.assign(env, {GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1'});
  let local;
  const close = () => { local?.close(); fs.rmSync(directory, {recursive: true, force: true}); };
  const run = (args, input, localOnly = false) => {
    try {
      if (localOnly) local ??= offlineRepository(directory);
      const repository = localOnly ? {root: local.root, env: local.env} : {root: directory, env};
      return execFileSync('git', ['-C', repository.root, '-c', `core.hooksPath=${os.devNull}`, ...args], {
        env: repository.env, input, stdio: ['pipe', 'pipe', 'pipe'], timeout: 60_000, maxBuffer: limit,
      });
    } catch (error) {
      // Identify the exact failed request without echoing transport diagnostics,
      // credential helpers or authenticated URLs from Git's stderr.
      if (args.includes('fetch')) throw Error(`Cannot acquire Base ${revision}: git ${args.join(' ')}${input ? ` (stdin: ${input.trim().split('\n').join(' ')})` : ''} failed; no files were refreshed or copy record changed.`);
      if (error.code === 'ENOBUFS') throw Error('Base API source output exceeds the 64 MiB acquisition limit');
      throw Error(`Cannot read Base ${revision}: git ${args.join(' ')} failed; no files were refreshed or copy record changed.`);
    }
  };
  const available = new Set(), trees = new Map(), objects = new Map(), ancestry = new Map();
  const ensure = pin => {
    if (!commit.test(pin)) throw Error('Base API requires an immutable full 40-character commit');
    if (available.has(pin)) return;
    let resolved;
    try { resolved = run(['rev-parse', '--verify', `${pin}^{commit}`]).toString().trim(); } catch { /* Acquire only a missing immutable tip. */ }
    if (resolved !== pin) {
      // Full ancestry and trees arrive together. Blob probes use a separate
      // object-store view without remotes: older Git ignores GIT_NO_LAZY_FETCH.
      // Required blobs are acquired explicitly in packs below.
      run(['-c', 'fetch.fsckObjects=true', 'fetch', '--filter=blob:none', '--no-tags', '--no-recurse-submodules', '--', remote, pin]);
      if (run(['rev-parse', '--verify', `${pin}^{commit}`]).toString().trim() !== pin) throw Error('Base did not resolve the immutable commit');
    }
    if (!local) fs.writeFileSync(path.join(directory, 'HEAD'), pin + '\n');
    available.add(pin);
  };
  try { run(['init', '--bare', '--quiet', '--template=', '--object-format=sha1']); }
  catch (error) { close(); throw error; }
  return {
    close,
    historyAvailable: false,
    objectId,
    tree(pin) {
      ensure(pin);
      if (!trees.has(pin)) {
        const entries = new Map();
        for (const line of run(['ls-tree', '-rz', '--full-tree', pin]).toString('utf8').split('\0').filter(Boolean)) {
          const tab = line.indexOf('\t'), [mode, type, object] = line.slice(0, tab).split(' '), name = line.slice(tab + 1);
          safe(name);
          if (!commit.test(object)) throw Error('Invalid Base Git tree entry');
          if (type === 'blob' && ['100644', '100755'].includes(mode)) entries.set(name, {object, mode});
        }
        trees.set(pin, new Map([...entries].sort(([a], [b]) => Buffer.compare(Buffer.from(a), Buffer.from(b)))));
      }
      return trees.get(pin);
    },
    blobs(ids) {
      const unique = [...new Set(ids)], missing = unique.filter(id => !objects.has(id));
      if (unique.some(id => !commit.test(id))) throw Error('Invalid Base API blob identity');
      if (missing.length) {
        const absent = run(['cat-file', '--batch-check'], missing.join('\n') + '\n', true).toString().trim().split('\n')
          .filter(line => line.endsWith(' missing')).map(line => line.split(' ')[0]);
        if (absent.length) run(['-c', 'fetch.fsckObjects=true', 'fetch', '--no-tags', '--no-recurse-submodules', '--stdin', '--', remote], absent.join('\n') + '\n');
      }
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100), output = run(['cat-file', '--batch'], chunk.join('\n') + '\n', true);
        let offset = 0;
        for (const object of chunk) {
          const newline = output.indexOf(10, offset), [identity, type, size] = output.subarray(offset, newline).toString().split(' ');
          const bytes = Buffer.from(output.subarray(newline + 1, newline + 1 + Number(size)));
          if (identity !== object || type !== 'blob' || bytes.length !== Number(size) || objectId(bytes) !== object) throw Error('Base API blob integrity mismatch');
          objects.set(object, bytes);
          offset = newline + 1 + bytes.length + 1;
        }
      }
      const result = new Map();
      let size = 0;
      for (const object of unique) {
        const bytes = objects.get(object);
        size += bytes.length;
        if (size > limit) throw Error('Base API source output exceeds the 64 MiB acquisition limit');
        result.set(object, bytes);
      }
      return result;
    },
    digests(ids) { return new Map([...this.blobs(ids)].map(([object, bytes]) => [object, hash(bytes)])); },
    contains(pin, introduced) {
      ensure(pin); ensure(introduced);
      const key = introduced + '...' + pin;
      if (!ancestry.has(key)) {
        // rev-list handles disconnected histories as a valid negative proof;
        // missing or corrupt objects still fail explicitly.
        const absent = run(['rev-list', '--max-count=1', introduced, '--not', pin]).length;
        ancestry.set(key, absent === 0);
      }
      return ancestry.get(key);
    },
    history(pin, name) {
      const entry = this.tree(pin).get(safe(name));
      return entry ? [{revision: pin, ...entry}] : [];
    },
  };
}
