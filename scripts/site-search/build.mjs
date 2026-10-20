import { spawnSync } from 'node:child_process';
import config from '../../src/site/docs-search.config.mjs';
import { buildSearchArtifacts } from '../../src/site/docs-search/artifacts.mjs';

// rer owns the public pages and their islands. The corpus is emitted from
// that exact render, before this step embeds changed chunks and bundles the Worker.
const rendered = spawnSync('pnpm', ['exec', 'rer', 'build', '--site'], { stdio: 'inherit' });
if (rendered.status !== 0) process.exit(rendered.status ?? 1);
await buildSearchArtifacts(config, { accountId: process.env.CLOUDFLARE_ACCOUNT_ID });
