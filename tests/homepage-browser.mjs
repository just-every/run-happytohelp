import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const origin = process.env.H2H_TEST_ORIGIN;
if (!origin) throw new Error('Set H2H_TEST_ORIGIN to the real native homepage preview');
const evidence = process.env.H2H_EVIDENCE_DIR || '/tmp/h2h-homepage-browser';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('requestfailed', request => errors.push(`request failed: ${request.url()}`));
page.on('response', response => { if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
// Public navigation into native identity, with the original viewport inputs.
// Copy, colours, geometry, fonts and animation constants belong to visual review.
const checks = [];
try {
  for (const [width, height] of [[1440, 900], [390, 844], [320, 844]]) {
    await page.setViewportSize({ width, height });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const clippedHeaderLinks = await page.locator('.site-header a').evaluateAll(links => links.filter(link => {
      const box = link.getBoundingClientRect();
      return box.width <= 0 || box.height <= 0 || box.left < 0 || box.top < 0 || box.right > innerWidth || box.bottom > innerHeight;
    }).map(link => link.textContent.trim()));
    assert.deepEqual(clippedHeaderLinks, [], `every header link is fully inside the viewport at ${width}px`);
    for (const link of await page.locator('.site-header a').all()) await link.click({ trial: true });
    await page.locator('.site-header nav a[href="/login"]').click();
    await page.waitForURL(url => url.pathname === '/login');
    if (width === 1440 || width === 390) await page.screenshot({path: `${evidence}/sign-in-${width}.png`, fullPage: true});
    const email = page.getByLabel('Email', { exact: true });
    const password = page.getByLabel('Password', { exact: true });
    const form = page.locator('.id-panel form');
    await email.waitFor({ state: 'visible' });
    await password.waitFor({ state: 'visible' });
    assert.equal(await form.locator('button').evaluate(button => button.type), 'submit');
    assert.equal(await email.inputValue(), '', `email remains empty at ${width}px`);
    assert.equal(await password.inputValue(), '', `password remains empty at ${width}px`);
  }
  checks.push('the homepage navigation reaches the native sign-in form at 1440, 390 and 320 pixels');
  for (const width of [1440, 390]) {
    await page.setViewportSize({width, height: 900});
    await page.goto(origin, {waitUntil: 'networkidle'});
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('href')), '#product');
    await page.keyboard.press('Enter');
    assert.equal(new URL(page.url()).hash, '#product');
    await page.getByRole('link', {name: 'HappyToHelp'}).last().click();
    assert.equal(new URL(page.url()).hash, '#top');
    await page.screenshot({path: `${evidence}/navigation-${width}.png`, fullPage: true});
  }
  checks.push('the keyboard skip link and pointer return link navigate to their sections at 1440 and 390 pixels');
  assert.deepEqual(errors, []);
  await writeFile(`${evidence}/navigation.json`, JSON.stringify({checks}, null, 2));
  console.log(JSON.stringify({passed: checks.length, checks}));
} finally {
  await browser.close();
}
