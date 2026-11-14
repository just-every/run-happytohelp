import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const probeSql = 'SELECT id FROM conversations';
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const inside = (root, file) => {
  const path = relative(root, file);
  if (path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('The build must stay inside the checkout.');
  return path;
};

// Only the generated copy changes. The real application still handles every
// request; the deliberate query runs immediately before the declared inbox GET.
export async function disposableBuild(root, declarationFile) {
  const declaration = await readJson(declarationFile);
  const inbox = declaration.flows?.find(flow => flow.name === 'inbox-list');
  if (inbox?.request?.method !== 'GET' || inbox.request.path.includes('{{')) {
    throw new Error('The proof requires inbox-list to declare a literal GET path.');
  }
  if (inbox.growth?.allowed) throw new Error('inbox-list must check growth for this proof.');
  const configFile = resolve(root, declaration.build?.wrangler ?? 'dist/server/wrangler.json');
  inside(root, configFile);
  const originalDirectory = dirname(configFile), config = await readJson(configFile);
  if (typeof config.main !== 'string' || isAbsolute(config.main)) throw new Error('The production build needs a relative Worker main.');
  inside(originalDirectory, resolve(originalDirectory, config.main));
  const parent = join(root, '.rer', 'size-proof');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'unbounded-'));
  try {
    const build = join(directory, 'build');
    await cp(originalDirectory, build, { recursive: true, errorOnExist: true, force: false });
    const wrapperName = '__size_proof_unbounded.mjs';
    const wrapper = join(build, wrapperName);
    const native = './' + config.main.split(sep).join('/');
    const path = new URL(inbox.request.path, 'https://proof.invalid');
    const target = path.pathname + path.search;
    await writeFile(wrapper, `import app from ${JSON.stringify(native)};
export * from ${JSON.stringify(native)};
export default {...app, async fetch(request, env, ctx) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname + url.search === ${JSON.stringify(target)}) {
    await env[${JSON.stringify(declaration.database ?? 'DB')}].prepare(${JSON.stringify(probeSql)}).all();
  }
  return app.fetch(request, env, ctx);
}};
`, { flag: 'wx' });
    config.main = wrapperName;
    if (config.assets) config.assets.directory = resolve(originalDirectory, config.assets.directory ?? '../client');
    for (const database of config.d1_databases ?? []) database.migrations_dir = resolve(originalDirectory, database.migrations_dir ?? 'migrations');
    const copiedConfig = join(build, 'wrangler.json');
    await writeFile(copiedConfig, JSON.stringify(config, null, 2) + '\n');
    declaration.build = { ...declaration.build, wrangler: inside(root, copiedConfig) };
    const faultDeclaration = join(directory, 'size-check.json');
    await writeFile(faultDeclaration, JSON.stringify(declaration, null, 2) + '\n');
    return { directory, declaration: faultDeclaration, flow: inbox.name, close: () => rm(directory, { recursive: true, force: true }) };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
