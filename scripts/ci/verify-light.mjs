// Adapted from Base 0.2.90 export/verify-light.mjs (ab97e5e864013ef03fd7f1e1a335101dd9150891).
// The seed retains its own contract readers and builds both app and run site.
import {access} from 'node:fs/promises';
import {join} from 'node:path';

const documents = new Set(['CONTRACT.md', 'ACCEPTANCE.md', 'CLAIMS.md', 'docs/CLAIMS.md', 'HANDOVER.md', 'STATUS.md']);
const allowed = path => documents.has(path) || path === 'sources.lock.json'
 || /^(?:evidence|\.artifacts)\/[A-Za-z0-9_./ -]+\.(?:md|txt|png|jpe?g|pdf)$/.test(path);

export async function lightReaders(files, {cwd = process.cwd()} = {}) {
 if (!files.length || !files.every(allowed)) return;
 for (const path of ['edition.json', 'sources.lock.json', 'scripts/edition-authoring/cli.mjs', 'src/site/base/contract-docs.mjs']) await access(join(cwd, path));
 // Contract generation and source-lock validation already run in every build.
 // Published documentation also has a public runtime reader, run after the build.
 return files.some(path => documents.has(path))
  ? ['node --test --test-concurrency=1 tests/journeys/public.mjs'] : [];
}
