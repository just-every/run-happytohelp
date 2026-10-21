import assert from 'node:assert/strict';
import {mkdir, mkdtemp, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRuntime} from '../emitted-runtime.mjs';
import {navigationFixture, watchShell, assertShell} from '../navigation-fixture.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function mobileInbox(){

const evidence = join(process.env.H2H_EVIDENCE_DIR ? resolve(process.env.H2H_EVIDENCE_DIR) : await mkdtemp(join(tmpdir(), 'h2h-mobile-inbox-navigation-')), 'mobile-inbox-navigation');
await mkdir(evidence, {recursive:true});
// This helper deliberately supplies no management/provider configuration.
const runtime = await createRuntime();
let browser, page, success = false;
const checks = [], errors = [], events = [];
let phase = 'setup';
try {
  const endpoint = runtime.origin + '/api/identity/editor-config';
  assert.equal((await fetch(endpoint)).status, 401, 'editor config requires authentication');
  const fixture = await navigationFixture(runtime.origin);
  browser = await launchBrowser();
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (request.isNavigationRequest()) events.push({phase,type:'navigation-request',time:Date.now(),method:request.method(),url:request.url()});
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) events.push({phase,type:'frame-navigation',time:Date.now(),url:frame.url()});
  });
  const checkpoint = async label => {
    phase = label;
    events.push({phase,type:'checkpoint',...await page.evaluate(() => ({url:location.href,timeOrigin:performance.timeOrigin,readyState:document.readyState}))});
  };
  const nav = page.getByRole('navigation', {name:'Main navigation',exact:true});
  await page.goto(runtime.origin + '/login?' + new URLSearchParams({returnTo:`/projects/${fixture.projects[0].id}/conversations`}));
  await page.getByLabel('Email', {exact:true}).fill(fixture.email);
  await page.getByLabel('Password', {exact:true}).fill(fixture.password);
  // Observe the actual EditorLauncher request, so removing its integration fails.
  const launched = page.waitForResponse(r => r.url() === endpoint && r.request().method() === 'GET');
  await page.getByRole('button', {name:'Login',exact:true}).click();
  await nav.getByRole('button', {name:/Switch workspace:/}).waitFor();
  const config = await launched;
  assert.equal(config.status(), 200);
  assert.equal(config.headers()['cache-control'], 'no-store');
  assert.deepEqual(await config.json(), {enabled:false,managementOrigin:'',installationId:''});
  assert.equal(await page.locator('[data-rer-editor]').count(), 0);
  checks.push('anonymous editor-config 401; actual authenticated launcher receives valid disabled no-store config');

  const switchWorkspace = async name => {
    await nav.getByRole('button', {name:/Switch workspace:/}).click();
    const choice = nav.getByRole('button', {name,exact:true});
    const switched = page.waitForResponse(response => response.url() === runtime.origin + '/api/identity/switch-project' && response.request().method() === 'POST');
    await choice.click();
    assert.equal((await switched).status(), 200);
    // Reselecting the current workspace leaves its label and inbox visible while
    // the POST is pending. Wait for switchWorkspace's finally state before the
    // next navigation, or its delayed navigate can overwrite the Contacts route.
    await page.waitForFunction(() => !document.querySelector('.navbar-workspace-menu button:disabled'));
    await nav.getByRole('button', {name:`Switch workspace: ${name}`,exact:true}).waitFor();
    await page.locator('.conversation-inbox').waitFor();
  };
  for (const [size, viewport] of [['desktop',{width:1440,height:1000}], ['mobile',{width:390,height:844}]]) {
    await checkpoint(size + ': start');
    await page.setViewportSize(viewport);
    await switchWorkspace('Navigation Alpha');
    const stamp = await watchShell(page);
    if (size === 'mobile') await nav.getByRole('button', {name:'Toggle navigation'}).click();
    await nav.getByRole('link', {name:'Contacts',exact:true}).click();
    await page.waitForURL(`**/projects/${fixture.projects[0].id}/contacts`);
    await page.getByRole('heading', {name:'Contacts',exact:true}).waitFor();
    if (size === 'mobile') assert.equal(await nav.getByRole('button', {name:'Toggle navigation'}).getAttribute('aria-expanded'), 'false');
    await assertShell(page, stamp, size + ': native route retains shell');
    await checkpoint(size + ': switch Beta');
    await switchWorkspace('Navigation Beta');
    await page.waitForURL(`**/projects/${fixture.projects[1].id}/conversations`);
    await assertShell(page, stamp, size + ': workspace switch retains shell before All open');
    await checkpoint(size + ': click All open');
    // The views sit under Inbox in the rail; below 1200px in the menu sheet, which the list title opens at Inbox.
    const view = name => page.locator(`nav[data-testid="inbox-views"]:visible a[href*="view=${name}"]`);
    const showViews = () => page.getByRole('button', {name:/, show inbox views$/}).click();
    if (size === 'mobile') await showViews();
    for (const name of ['mine', 'open', 'unassigned', 'ai', 'closed']) assert.equal(await nav.locator(`nav[data-testid="inbox-views"]:visible a[href*="view=${name}"]`).count(), 1, size + ': the navigation holds the ' + name + ' view');
    await view('open').click();
    await page.waitForURL(url => url.searchParams.get('view') === 'open');
    await page.locator('.conversation-list-items').getByText('Beta Visitor', {exact:true}).waitFor();
    assert.equal(await page.locator('.conversation-list-items').getByText('Alpha Visitor', {exact:true}).count(), 0);
    await page.waitForFunction(() => document.body.dataset.theme === 'dark');
    assert.equal(await page.evaluate(() => performance.timeOrigin), stamp, size + ': workspace switch retains document');
    await assertShell(page, stamp, size + ': All open retains shell');
    assert.deepEqual(errors, [], size + ': no click handler exceptions');
    if (size === 'mobile') {
      const toggle = nav.getByRole('button', {name:'Toggle navigation'});
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await nav.locator('#sidebarCollapse').isVisible(), false);
      // A query-only selection again: the sheet opens at Inbox and closes on the choice.
      await showViews();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
      await view('unassigned').click();
      await page.waitForURL(url => url.searchParams.get('view') === 'unassigned');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await nav.locator('#sidebarCollapse').isVisible(), false);
      await assertShell(page, stamp, 'mobile: repeated view selection retains shell');
    }
    await checkpoint(size + ': completed');
    await page.screenshot({path:join(evidence, size + '.png'),fullPage:true});
    checks.push(size + ': native Contacts navigation and isolated Beta workspace switching');
  }
  await context.clearCookies();
  assert.equal((await context.request.get(endpoint)).status(), 401, 'expired session cannot read editor config');
  assert.deepEqual(errors, []);
  success = true;
} catch (error) {
  if (page) {
    await page.screenshot({path:join(evidence, 'failure.png'),fullPage:true}).catch(() => {});
    await writeFile(join(evidence, 'failure-state.json'), JSON.stringify(await page.evaluate(() => ({url:location.href,title:document.title,text:document.body.innerText,html:document.documentElement.outerHTML})).catch(failure => ({error:failure.message})), null, 2) + '\n');
  }
  throw error;
} finally {
  await writeFile(join(evidence, 'result.json'), JSON.stringify({success,phase,checks,errors,events}, null, 2) + '\n');
  await browser?.close();
  await runtime.close(success);
}
console.log('Mobile inbox browser checks passed:', evidence);

}
