import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import deployment from '../deploy.json' with { type: 'json' };
import { chromium } from 'playwright';
import { dimensions } from '../src/vendor/base/modules/site/docs-search/index-build.mjs';
import { buildSearchArtifacts } from '../src/vendor/base/modules/site/docs-search/artifacts.mjs';

// The only fake is the paid inference boundary. Both corpus and query use the
// same deterministic embedding, while the built pages, client and Worker run.
function vectors(text) {
  return { shape: [text.length, dimensions], data: text.map(value => {
    const vector = Array(dimensions).fill(0);
    const heading = value.replace(/^Represent this sentence for searching relevant passages: /, '').split('\n')[0].split(' > ').at(-1);
    for (const word of heading.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
      let hash = 0;
      for (const letter of word) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
      vector[hash % dimensions] += 1;
    }
    return vector;
  }) };
}

test('a reader searches the built docs and opens a linked heading through the site Worker', { timeout: 120000 }, async () => {
  const require = createRequire(import.meta.resolve('wrangler'));
  const { Miniflare, convertV4MiniflareOptions } = await import(require.resolve('miniflare'));
  const output = '.rer/docs-search-test';
  await rm(output, { recursive: true, force: true });
  execFileSync('pnpm', ['exec', 'rer', 'build', '--site', '--no-queue'], { stdio: 'pipe', env: { ...process.env, CI: 'true' } });
  await buildSearchArtifacts({ corpus: '.rer/docs-search/corpus.json', assets: '.rer/site', output }, { embed: async (_model, { text }) => vectors(text) });
  const mf = new Miniflare(convertV4MiniflareOptions({ workers: [
    { name: 'site', modules: true, scriptPath: resolve(output, 'worker.mjs'), compatibilityDate: deployment.compatibilityDate,
      assets: { directory: resolve('.rer/site'), binding: 'ASSETS', run_worker_first: true, routerConfig: { has_user_worker: true }, assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: '404-page' } },
      serviceBindings: { AI: 'inference' } },
    { name: 'inference', modules: true, compatibilityDate: deployment.compatibilityDate, script: `import {WorkerEntrypoint} from 'cloudflare:workers';const dimensions=${dimensions};const vectors=${vectors.toString()};export default class extends WorkerEntrypoint {async run(_model,{text}){return vectors(text)}}` },
  ] }));
  let browser;
  try {
    const origin = (await mf.ready).origin;
    browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const opened = await page.goto(`${origin}/docs`);
    assert.equal(opened.status(), 200, await opened.text());
    await page.keyboard.press('/');
    const input = page.getByRole('combobox', { name: 'Search docs' });
    await input.fill('Notes, mentions and followers');
    const result = page.getByRole('option').filter({ hasText: 'Notes, mentions and followers' });
    await result.waitFor();
    const href = await result.getAttribute('href');
    assert.ok(new URL(href).hash, 'search links directly to a heading');
    await page.keyboard.press('ArrowDown');
    // Pointer opens the same real link that Enter uses after arrow selection.
    await result.click();
    await page.waitForURL(href);
    assert.ok(await page.locator(new URL(href).hash).isVisible());
    await context.close();
  } finally {
    await browser?.close();
    await mf.dispose();
    await rm(output, { recursive: true, force: true });
  }
});
