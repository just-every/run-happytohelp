import { mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export const hostedDemoMigrations = '.generated/hosted-demo-migrations';

async function writeMigrations(directory, files) {
  await mkdir(directory, { recursive: true });
  // Never leave a removed SQL file runnable in a previously generated directory.
  for (const name of await readdir(directory)) if (!files.has(name)) await rm(join(directory, name));
  for (const [name, text] of files) await writeFile(join(directory, name), text);
}

export async function collectMigrations({ hostedDemo = false } = {}) {
  const modules = await readdir(resolve(root, 'src/modules'), { withFileTypes: true });
  const directories = [resolve(root, 'migrations'), ...modules.filter(x => x.isDirectory()).map(x => resolve(root, 'src/modules', x.name, 'migrations'))];
  const files = new Map();
  for (const directory of directories) {
    let names;
    try { names = await readdir(directory); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    for (const name of names.filter(x => x.endsWith('.sql'))) {
      if (!/^\d+_[a-z0-9_-]+\.sql$/.test(name) || files.has(name)) throw new Error(`Invalid or duplicate migration: ${name}`);
      files.set(name, await readFile(join(directory, name), 'utf8'));
    }
  }
  const directory = resolve(root, '.generated/migrations');
  const ordered = [...files.entries()].sort(([left], [right]) => left < right ? -1 : 1);
  // Local Wrangler and deploy-kit consume the same collected SQL. deploy-kit's
  // package contract currently reads migrations/core; this is generated output,
  // never the source of a migration.
  if (hostedDemo) {
    // Each hosted copy starts empty. Replay the same SQL in order, with fewer
    // ledger writes and SQLite commits. Installations keep the original files.
    const grouped = new Map();
    const filesPerTransaction = 25;
    for (let start = 0; start < ordered.length; start += filesPerTransaction) {
      const group = ordered.slice(start, start + filesPerTransaction);
      grouped.set(group[0][0], group.map(([, sql]) => sql).join('\n;\n'));
    }
    const demoDirectory = resolve(root, hostedDemoMigrations);
    await writeMigrations(demoDirectory, grouped);
    return { directory: demoDirectory, files: [...grouped.keys()] };
  }
  const inventory = new Map(ordered);
  for (const output of [directory, resolve(root, 'migrations/core')]) {
    await writeMigrations(output, inventory);
  }
  return { directory, files: [...inventory.keys()] };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await collectMigrations(), null, 2));
