import {readFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

/**
 * scripts/deployment/environment.mjs is the single source of truth for the runtime secret names the Worker
 * binds. Packaging policy (artifact.specInputs) and the emitted deployment spec must declare every one of
 * them, required or optional, so the release contract and the platform's recipe cannot drift from the runtime.
 */
export function undeclaredSecretNames(runtimeNames, {secretNames = [], optionalSecretNames = []}) {
 const declared = new Set([...secretNames, ...optionalSecretNames]);
 return runtimeNames.filter(name => !declared.has(name));
}

export async function assertSecretDeclarations(root = process.cwd(), {emitted = false} = {}) {
 const {secretNames: runtimeNames} = await import(pathToFileURL(resolve(root, 'scripts/deployment/environment.mjs')));
 const sources = [['scripts/delivery/base/packaging.json', json => json.artifact.specInputs]];
 if (emitted) sources.push(['management/integration/deployment-spec.json', json => json]);
 for (const [file, declarations] of sources) {
  const missing = undeclaredSecretNames(runtimeNames, declarations(JSON.parse(await readFile(resolve(root, file), 'utf8'))));
  if (missing.length) throw Error(`${file} omits runtime secret names declared in scripts/deployment/environment.mjs: ${missing.join(', ')}. Add them to optionalSecretNames in scripts/delivery/base/packaging.json and run node scripts/delivery/generate-spec.mjs.`);
 }
}

/** Mail inputs the Worker reads as `env.EMAIL_*` (first-party source, vendored copies excluded). */
export async function workerReadMailNames(root = process.cwd()) {
 const names = new Set();
 const walk = async directory => {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
   if (entry.isDirectory()) { if (entry.name !== 'vendor') await walk(join(directory, entry.name)); continue; }
   if (!/\.(ts|tsx|mjs)$/.test(entry.name)) continue;
   for (const [, name] of (await readFile(join(directory, entry.name), 'utf8')).matchAll(/\benv\??\.(EMAIL_[A-Z0-9_]+)/g)) names.add(name);
  }
 };
 await walk(resolve(root, 'src'));
 return [...names].sort();
}

/**
 * A binding reaches the Worker under its binding name, so every EMAIL_* name the code reads must be declared as
 * a binding of that name in the deploy declaration and its managed copy (a MAIL_* alias does not stand in for it).
 */
export function unboundWorkerNames(readNames, declaration) {
 const bound = new Set((declaration.secrets ?? []).map(secret => secret.binding));
 return readNames.filter(name => !bound.has(name));
}

export async function assertWorkerBindings(root = process.cwd()) {
 const readNames = await workerReadMailNames(root);
 for (const file of ['deploy.json', 'management/integration/managed-deploy.json']) {
  const missing = unboundWorkerNames(readNames, JSON.parse(await readFile(resolve(root, file), 'utf8')));
  if (missing.length) throw Error(`${file} does not bind ${missing.join(', ')}, which the Worker reads as env.<name>. Declare {"binding":"<name>","environment":"<name>","optional":true} in deploy.json and run node scripts/delivery/generate-spec.mjs.`);
 }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 await assertSecretDeclarations(process.cwd(), {emitted: true});
 await assertWorkerBindings();
 console.log('Runtime secret declarations match packaging and the emitted deployment spec; the deploy declaration binds every EMAIL_* name the Worker reads');
}
