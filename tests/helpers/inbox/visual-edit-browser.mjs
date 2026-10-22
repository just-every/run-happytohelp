import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validCompiledLiveEditSnapshot} from '../../../src/editor/live-edit-contracts.ts';
import {createRuntime} from '../emitted-runtime.mjs';
import {navigationFixture, watchShell, assertShell} from '../navigation-fixture.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function visualEdit(){

const snapshot = JSON.parse(await readFile(new URL('../../../src/editor/visual-edits.json', import.meta.url), 'utf8'));
assert.ok(validCompiledLiveEditSnapshot(snapshot), 'Invalid compiled visual edits');
// Runtime uses the last edit for each target; earlier revisions are not additive.
const effective = new Map();
for (const edit of snapshot.edits) {
  effective.set(JSON.stringify([edit.target.navigation ? 'navigation' : edit.path, edit.target.tag, edit.target.role, edit.target.navigation?.href || edit.target.selector]), edit);
}
const edits = [...effective.values()];
let runtime, browser, success = false;
const errors = [], checked = new Set();
try {
  runtime = await createRuntime();
  browser = await launchBrowser();
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const fixture = await navigationFixture(runtime.origin);
  await page.goto(runtime.origin + '/login?returnTo=' + encodeURIComponent('/conversations?view=open'));
  await page.getByLabel('Email', {exact:true}).fill(fixture.email);
  await page.getByLabel('Password', {exact:true}).fill(fixture.password);
  await page.getByRole('button', {name:'Login',exact:true}).click();
  const nav = page.getByRole('navigation', {name:'Main navigation'});
  await nav.getByRole('button', {name:/Switch workspace:/}).click();
  await nav.getByRole('button', {name:'Navigation Alpha',exact:true}).click();
  const base = `/projects/${fixture.projects[0].id}`;
  await page.waitForURL(url => url.pathname.startsWith(base));
  await page.locator('.conversation-inbox').waitFor();

  const assertEdits = async () => {
    const applicable = edits.filter(edit => edit.target.navigation || edit.path === new URL(page.url()).pathname);
    for (const edit of applicable) {
      await page.waitForFunction(edit => {
        const elements = edit.target.navigation
          ? [...document.querySelectorAll('nav a[href]')].filter(element => {
              const href = new URL(element.getAttribute('href'), location.origin);
              return href.origin === location.origin && !href.search && !href.hash && href.pathname === edit.target.navigation.href;
            })
          : [...document.querySelectorAll(edit.target.selector)];
        if (elements.length !== 1) return false;
        const element = elements[0];
        if (element.tagName.toLowerCase() !== edit.target.tag || (element.getAttribute('role') || '') !== edit.target.role) return false;
        const normalize = text => text.replace(/\s+/g, ' ').trim();
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        const text = [];
        while (walker.nextNode()) {
          const parent = walker.currentNode.parentElement;
          if (parent && !parent.closest('input,textarea,select,option,script,style,iframe,svg,[contenteditable],[data-rer-private],[data-rer-editor],[hidden],[aria-hidden="true"]') && parent.getClientRects().length && getComputedStyle(parent).visibility === 'visible') text.push(walker.currentNode.nodeValue);
        }
        if (edit.change.text !== undefined && normalize(text.join('')) !== normalize(edit.change.text)) return false;
        return Object.entries(edit.change.styles || {}).every(([property, value]) => {
          const probe = document.createElement('span');
          probe.style.setProperty(property, value);
          return probe.style.getPropertyValue(property) !== '' && element.style.getPropertyValue(property) === probe.style.getPropertyValue(property);
        });
      }, edit, {timeout:15000});
      checked.add(edit.id);
    }
  };
  await assertEdits();
  const stamp = await watchShell(page);
  // Address links by destination because their visible labels are owner editable.
  for (const route of ['contacts', 'reports', 'insights', 'conversations']) {
    // Insights is a tab of Reports, beside the page's title; the others are rows of the navigation.
    const link = route === 'insights' ? page.locator(`nav[aria-label="Reports sections"] a[href="${base}/${route}"]`) : nav.locator(`a.nav-link[href="${base}/${route}"]`);
    await link.click();
    await page.waitForURL(url => url.pathname === `${base}/${route}`);
    await assertEdits();
    await assertShell(page, stamp, `${route} preserves the native shell`);
  }
  await page.reload();
  await page.locator('.conversation-inbox').waitFor();
  await assertEdits();
  // Route-specific edits must also be observed, including after a document reload.
  for (const path of new Set(edits.filter(edit => !edit.target.navigation).map(edit => edit.path))) {
    const response = await page.goto(runtime.origin + path);
    assert.ok(response?.ok(), `Saved edit route unavailable: ${path}`);
    await assertEdits();
    await page.reload();
    await assertEdits();
  }
  assert.deepEqual([...checked].sort(), edits.map(edit => edit.id).sort(), 'Every effective saved edit was verified');
  assert.deepEqual(errors, [], 'Browser runtime errors');
  success = true;
  console.log(JSON.stringify({success, savedEdits:edits.length, checked:[...checked], checks:['real isolated Worker login', 'native route clicks preserve shell', 'document reload restores inbox', ...(edits.length ? ['saved text/styles checked on applicable routes and reload'] : [])], note:edits.length ? undefined : 'No saved edits in current snapshot; navigation and reload verified.'}, null, 2));
} finally {
  try { await browser?.close(); } finally { await runtime?.close(success); }
}

}
