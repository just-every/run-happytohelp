// Counted per-seed test cap (owner, 15 Oct: "a per-seed cap ... Default to 200"). One count per `test(` / `it(` /
// `t.test(` registration in a node:test entry script, no folding; an entry script with no static registration counts 1.
// Fails over the cap in test-budget.json. Raising the cap above 200 needs a written reason in that file.
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';

const skip = new Set(['node_modules', '.git', 'dist', '.generated', 'delivery-artifact']);
const registration = /(?<![\w.$])(?:t\.)?(?:test|it)(?:\.(?:skip|only|todo))?\s*\(/g;

async function* sources(dir) {
  for (const entry of await readdir(dir, {withFileTypes: true})) {
    if (skip.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sources(path);
    else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name)) yield path;
  }
}

export async function countTests(root = '.') {
  const entries = [];
  for await (const path of sources(root)) {
    const text = await readFile(path, 'utf8');
    if (!/(?:from\s*|require\()\s*['"]node:test['"]/.test(text)) continue;
    entries.push({path, count: Math.max(1, (text.match(registration) ?? []).length)});
  }
  return {entries, total: entries.reduce((sum, {count}) => sum + count, 0)};
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const budget = JSON.parse(await readFile('test-budget.json', 'utf8'));
  if (!Number.isInteger(budget.cap) || budget.cap < 1) throw Error('test-budget.json needs an integer cap');
  if (budget.cap > 200 && !String(budget.reason ?? '').trim()) throw Error('A cap above 200 needs a written reason in test-budget.json');
  const {entries, total} = await countTests();
  console.log(`${total} counted tests in ${entries.length} entry scripts, cap ${budget.cap}`);
  if (total > budget.cap) {
    for (const {path, count} of entries.sort((a, b) => b.count - a.count).slice(0, 10)) console.error(`${String(count).padStart(4)} ${path}`);
    throw Error(`${total} tests exceed the cap of ${budget.cap}; delete tests or justify a higher cap in test-budget.json`);
  }
}
