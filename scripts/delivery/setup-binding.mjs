import {readFile, writeFile} from 'node:fs/promises';
import {loadSetupManifest} from './base/setup-manifest.mjs';

const root = process.cwd();
const descriptorPath = new URL('../../rer-project.json', import.meta.url);
const project = JSON.parse(await readFile(descriptorPath, 'utf8'));
const manifest = await loadSetupManifest(root, {manifestFile: 'rer-setup.json'});
const setup = {path: manifest.path, sha256: manifest.sha256};
if (process.argv.includes('--write')) {
  project.setup = setup;
  await writeFile(descriptorPath, `${JSON.stringify(project, null, 2)}\n`);
} else if (!project.setup || Object.keys(project.setup).sort().join(',') !== 'path,sha256' ||
    project.setup.path !== setup.path || project.setup.sha256 !== setup.sha256) {
  throw new Error('rer-project.json setup binding is stale; run pnpm run source:lock');
}
console.log(`Setup binding verified: ${setup.path} sha256=${setup.sha256}`);
