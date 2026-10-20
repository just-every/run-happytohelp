import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { chromium } from 'playwright';
import { buildSearchArtifacts } from '../src/site/docs-search/artifacts.mjs';

// The only fake is the paid inference boundary. Both corpus and query use the
// same deterministic embedding, while the built pages, client and Worker run.
function vectors(text) {
  return { shape: [text.length, 384], data: text.map(value => {
    const vector = Array(384).fill(0);
    for (const word of value.toLowerCase().match(/[a-z]{3,}/g) ?? []) {
      let hash = 0;
      for (const letter of word) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
      vector[hash % 384] += 1;
    }
    return vector;
  }) };
}

test('a reader searches the built docs and opens a linked heading through the site Worker', { timeout: 120000 }, async () => {
  const require = createRequire(import.meta.resolve('wrangler'));
  const { Miniflare } = await import(require.resolve('miniflare'));
  const output = '.rer/docs-search-test';
  await rm(output, { recursive: true, force: true });
  execFileSync('pnpm', ['exec', 'rer', 'build', '--site', '--no-queue'], { stdio: 'pipe', env: { ...process.env, CI: 'true' } });
  await buildSearchArtifacts({ corpus: '.rer/docs-search/corpus.json', assets: '.rer/site', output }, { embed: async (_model, { text }) => vectors(text) });
  const mf = new Miniflare({ workers: [
    { name: 'site', modules: true, scriptPath: resolve(output, 'worker.mjs'), compatibilityDate: '2026-10-20',
      assets: { directory: resolve('.rer/site'), binding: 'ASSETS', run_worker_first: true, assetConfig: { html_handling: 'auto-trailing-slash', not_found_handling: '404-page' } },
      serviceBindings: { AI: 'inference' } },
    { name: 'inference', modules: true, compatibilityDate: '2026-10-20', script: `import {WorkerEntrypoint} from 'cloudflare:workers';const vectors=${vectors.toString()};export default class extends WorkerEntrypoint {async run(_model,{text}){return vectors(text)}}` },
  ] });
  let browser;
  try {
    const origin = (await mf.ready).origin;
    browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    assert.equal((await page.goto(`${origin}/docs`)).status(), 200);
    await page.keyboard.press('/');
    const input = page.getByRole('combobox', { name: 'Search docs' });
    await input.fill('mentions followers');
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
