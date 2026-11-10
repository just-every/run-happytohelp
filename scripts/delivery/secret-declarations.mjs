import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 await assertSecretDeclarations(process.cwd(), {emitted: true});
 console.log('Runtime secret declarations match packaging and the emitted deployment spec');
}
