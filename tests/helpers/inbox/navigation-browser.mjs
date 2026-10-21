import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRuntime} from '../emitted-runtime.mjs';
import {navigationFixture,watchShell,assertShell} from '../navigation-fixture.mjs';
import {rapidTenantBack,pluginPrefill} from '../navigation-edges.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'

export async function navigation(){
const evidence=join(process.env.H2H_EVIDENCE_DIR?resolve(process.env.H2H_EVIDENCE_DIR):await mkdtemp(join(tmpdir(),'h2h-navigation-')),'navigation-native');
await mkdir(evidence,{recursive:true});
const runtime=await createRuntime();
const browser=await launchBrowser();
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
page.setDefaultTimeout(15000);
const checks=[],errors=[],requests=[];let success=false;
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>requests.push({method:request.method(),url:request.url(),type:request.resourceType()}));
const nav=page.getByRole('navigation',{name:'Main navigation'});
// The real unread badge contributes '<count> unread conversations' to Inbox's
// accessible name after its asynchronous count arrives. Keep other names exact.
// Project is the one Settings row; the other Settings pages are reached through the Settings menu beside the page.
const link=name=>name==='Project'?nav.getByTestId('nav-settings'):nav.getByRole('link',{name:name==='Inbox'?/^Inbox(?:\s+\d+ unread conversations)?$/:name,exact:true});
const view=name=>page.locator(`nav[data-testid="inbox-views"]:visible a[href*="view=${name}"]`);
const settingsMenu=()=>page.getByTestId('settings-menu');
const menuLink=async name=>{
  if(!await settingsMenu().count())await link('Project').click();
  const menu=settingsMenu();await menu.waitFor();const entry=menu.getByRole('link',{name,exact:true});
  if(!await entry.isVisible())await menu.getByTestId('settings-menu-more').locator('summary').click();
  await entry.click();await entry.and(menu.locator('[aria-current="page"]')).waitFor();
};
const sameDocument=async(stamp,label)=>assert.equal(await page.evaluate(()=>performance.timeOrigin),stamp,label);
const ready=()=>nav.getByRole('button',{name:/Switch workspace:/}).waitFor();
const switchProject=async name=>{await nav.getByRole('button',{name:/Switch workspace:/}).click();await nav.getByRole('button',{name,exact:true}).click();await nav.getByRole('button',{name:`Switch workspace: ${name}`,exact:true}).waitFor();};
try {
  const fixture=await navigationFixture(runtime.origin),[alpha,beta]=fixture.projects;
  const login=async()=>{await page.goto(runtime.origin+'/login?returnTo='+encodeURIComponent('/conversations?view=open'));await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(fixture.password);await page.getByRole('button',{name:'Login',exact:true}).click();await ready();};
  await login();
  await switchProject('Navigation Alpha');
  // Reproduce the CI condition with real server counts before testing navigation.
  await page.locator('#navigation-inbox-unread:not([hidden])').waitFor();
  assert.match(await page.locator('#navigation-inbox-unread .navbar-unread-count').getAttribute('aria-label'),/^\d+ unread conversations$/);
  assert.equal(await link('Inbox').count(),1,'Inbox remains addressable with its populated unread badge');
  checks.push('real unread count is present and Inbox remains addressable by its complete accessible name');
  await view('open').click();
  await page.locator('.conversation-list-items').getByRole('link').filter({hasText:'Alpha Visitor'}).first().click();
  await page.locator('.transcript-message-content').getByText(alpha.message,{exact:true}).waitFor();
  let stamp=await watchShell(page);
  // Forward real GETs with latency so a transient shell replacement is observable.
  await page.route('**/api/management/**',async route=>{if(route.request().method()==='GET')await new Promise(resolve=>setTimeout(resolve,200));await route.continue();});
  await link('Project').click();await page.getByLabel('Website',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://alpha.example.test');
  await page.getByRole('button',{name:'Appearance',exact:true}).click();await page.getByLabel('Workspace color hex').waitFor();
  assert.equal(await page.getByLabel('Workspace color hex').inputValue(),alpha.color);
  await assertShell(page,stamp,'Project retains document/sidebar');
  await link('Inbox').click();await view('open').click();
  await page.locator('.conversation-list-items').getByText('Alpha Visitor',{exact:true}).waitFor();
  await assertShell(page,stamp,'Inbox and All open retain document/sidebar');
  checks.push('actual Project → Inbox → All open clicks preserve document, timeOrigin, sidebar node; delayed reads never replace shell');
  await menuLink('Saved Replies');await page.locator('#workspace-header-actions').getByRole('link',{name:'Save a Reply'}).waitFor();
  await link('Project').click();await page.getByLabel('Website',{exact:true}).waitFor();
  assert.equal(await page.locator('#workspace-header-actions').getByRole('link').count(),0);
  await page.getByRole('button',{name:'Appearance',exact:true}).waitFor();
  await link('Contacts').click();await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Appearance',exact:true}).count(),0);
  await assertShell(page,stamp,'header portals update on route changes');
  checks.push('header actions and tabs follow current page without stale portals');
  await link('Inbox').click();await view('open').click();
  await page.waitForURL(url=>url.searchParams.get('view')==='open');
  const allOpenURL=page.url();
  await page.locator('.conversation-inbox input[type=search]').fill('Alpha');
  await page.getByRole('button',{name:'Search conversations',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('q')==='Alpha');
  const searchedURL=page.url();
  await page.goBack();await page.waitForURL(allOpenURL);
  await page.waitForFunction(()=>document.querySelector('input[type=search]')?.value==='');
  assert.equal(await page.getByRole('searchbox').inputValue(),'');
  await page.goForward();await page.waitForURL(searchedURL);
  await page.waitForFunction(()=>document.querySelector('input[type=search]')?.value==='Alpha');
  assert.equal(await page.getByRole('searchbox').inputValue(),'Alpha');
  await view('unassigned').click();await page.waitForURL(url=>url.searchParams.get('view')==='unassigned');const unassignedURL=page.url();
  await page.goBack();await page.waitForURL(searchedURL);await page.goForward();await page.waitForURL(unassignedURL);
  await assertShell(page,stamp,'inbox Back/Forward preserves shell');
  checks.push('inbox search and view clicks plus Back/Forward restore q/view and search field state');
  await switchProject('Navigation Beta');await view('open').click();
  await page.locator('.conversation-list-items').getByText('Beta Visitor',{exact:true}).waitFor();
  assert.equal(await page.locator('.conversation-list-items').getByText('Alpha Visitor',{exact:true}).count(),0);
  await page.waitForFunction(()=>document.body.dataset.theme==='dark');
  await link('Project').click();await page.getByLabel('Website',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://beta.example.test');
  await sameDocument(stamp,'project switching retains document');
  await switchProject('Global Inbox');await view('open').click();
  await page.locator('.conversation-list-items').getByText('Alpha Visitor',{exact:true}).waitFor();
  await page.locator('.conversation-list-items').getByText('Beta Visitor',{exact:true}).waitFor();
  await switchProject('Navigation Alpha');await page.waitForFunction(()=>document.body.dataset.theme==='light');
  await sameDocument(stamp,'global/project switching retains document');
  stamp=await watchShell(page);
  checks.push('project switch isolates real tenant records/settings/theme; global inbox spans both projects');
  await view('open').click();
  await page.locator('.conversation-list-items').getByRole('link').filter({hasText:'Alpha Visitor'}).first().click();
  await page.getByPlaceholder('Type your reply…').fill('Unsaved conversation draft');
  await page.getByRole('searchbox').fill('Alpha');await page.getByRole('button',{name:'Search conversations',exact:true}).click();
  await page.waitForURL(url=>url.searchParams.get('q')==='Alpha');
  assert.equal(await page.getByPlaceholder('Type your reply…').inputValue(),'Unsaved conversation draft');
  await view('unassigned').click();await page.waitForURL(url=>url.searchParams.get('view')==='unassigned');
  assert.equal(await page.getByPlaceholder('Type your reply…').inputValue(),'Unsaved conversation draft');
  page.once('dialog',dialog=>dialog.dismiss());await link('Project').click();
  assert.equal(await page.getByPlaceholder('Type your reply…').inputValue(),'Unsaved conversation draft');
  assert.equal(new URL(page.url()).pathname,`/projects/${alpha.id}/conversations/${alpha.conversationId}`);
  page.once('dialog',dialog=>dialog.accept());await link('Project').click();await page.getByLabel('Website',{exact:true}).waitFor();
  checks.push('conversation draft cancels or permits page navigation through native blocker');
  await page.getByLabel('Website',{exact:true}).fill('https://unsaved.example.test');
  page.once('dialog',dialog=>dialog.dismiss());await link('Inbox').click();
  assert.equal(new URL(page.url()).pathname,`/projects/${alpha.id}/edit`);
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://unsaved.example.test');
  const switchCount=requests.filter(r=>r.url.endsWith('/api/identity/switch-project')).length;
  page.once('dialog',dialog=>dialog.dismiss());
  await nav.getByRole('button',{name:/Switch workspace:/}).click();await nav.getByRole('button',{name:'Navigation Beta',exact:true}).click();
  assert.equal(requests.filter(r=>r.url.endsWith('/api/identity/switch-project')).length,switchCount,'cancelled workspace switch must not mutate identity');
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://unsaved.example.test');
  await page.keyboard.press('Escape');
  await page.route('**/api/identity/switch-project',route=>route.abort('failed'));
  page.once('dialog',dialog=>dialog.accept());
  await nav.getByRole('button',{name:/Switch workspace:/}).click();await nav.getByRole('button',{name:'Navigation Beta',exact:true}).click();
  await nav.getByRole('alert').waitFor();await page.unroute('**/api/identity/switch-project');
  await page.keyboard.press('Escape');
  let reblocked=false;page.once('dialog',async dialog=>{reblocked=true;await dialog.dismiss();});await link('Inbox').click();
  assert.ok(reblocked,'failed confirmed workspace switch retains dirty registration');
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://unsaved.example.test');
  const signoutCount=requests.filter(r=>r.url.endsWith('/api/identity/session')&&r.method==='DELETE').length;
  await page.locator('#sidebarUser').getByRole('button',{name:'Account menu'}).click();
  page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'Sign out',exact:true}).click();
  assert.equal(requests.filter(r=>r.url.endsWith('/api/identity/session')&&r.method==='DELETE').length,signoutCount,'cancelled sign out must not mutate identity');
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://unsaved.example.test');
  await page.keyboard.press('Escape');
  page.once('dialog',dialog=>dialog.accept());await link('Inbox').click();await page.waitForURL(`**/projects/${alpha.id}/conversations`);await page.locator('.conversation-inbox').waitFor();
  await link('Project').click();await page.getByLabel('Website',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://alpha.example.test');
  checks.push('unsaved settings cancel retains draft; cancelled workspace/signout preserve identity; proceed discards without a write');
  for(let visit=0;visit<2;visit++) {
    await menuLink('Widget');await page.getByRole('tab',{name:'Theme',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#happytohelp')?.childElementCount>0);
    assert.equal(await page.locator('#happytohelp').count(),1);
    await link('Inbox').click();await page.locator('.conversation-inbox').waitFor();
    assert.equal(await page.locator('#happytohelp').count(),0);
  }
  checks.push('widget preview mounts on two SPA visits and unmounts between them');
  await page.locator('#sidebarUser').getByRole('button',{name:'Account menu'}).click();await page.getByRole('link',{name:'Profile',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Updated Navigation Owner');await page.getByRole('button',{name:'Update',exact:true}).click();await page.getByRole('status').waitFor();
  await link('Inbox').click();await page.locator('#sidebarUser').getByText('Updated Navigation Owner',{exact:true}).waitFor();
  checks.push('saved profile name refreshes the persistent sidebar on return to inbox');
  await switchProject('Navigation Alpha');
  await rapidTenantBack(page,alpha,beta);checks.push('gated Alpha → Beta → Back keeps Alpha data/theme/document after cancelled tenant load');
  await pluginPrefill(page);checks.push('Custom-plugin internal link opens local creation; search parameters prefill the form and unsafe URLs are refused without saving or provider access');
  stamp=await watchShell(page);
  await page.setViewportSize({width:390,height:844});
  await nav.getByRole('button',{name:'Toggle navigation'}).click();await link('Contacts').click();
  await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor();
  assert.equal(await nav.getByRole('button',{name:'Toggle navigation'}).getAttribute('aria-expanded'),'false');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await assertShell(page,stamp,'mobile route retains shell');
  await page.screenshot({path:join(evidence,'mobile-navigation.png'),fullPage:true});
  checks.push('mobile actual navigation closes menu and preserves shell without overflow');
  // Deliberate document entry checks: refresh and unknown URLs are not SPA journeys.
  await page.reload();await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor();
  const missing=await page.goto(`${runtime.origin}/projects/${alpha.id}/does-not-exist`);assert.equal(missing.status(),404);await page.getByText(/not found/i).waitFor();
  await page.goBack();await page.getByRole('heading',{name:'Contacts',exact:true}).waitFor();
  checks.push('direct refresh resolves current route; unknown project route reports not found and Back recovers');
  await page.setViewportSize({width:1440,height:1000});await ready();
  await page.locator('#sidebarUser').getByRole('button',{name:'Account menu'}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.waitForURL('**/login');assert.equal(await page.locator('#sidebar').count(),0);
  await page.goBack();await page.getByRole('button',{name:'Login',exact:true}).waitFor();assert.equal(await page.locator('#sidebar').count(),0);
  checks.push('sign out and Back cannot reveal stale authenticated shell');
  await login();await switchProject('Navigation Alpha');
  await page.context().clearCookies();await link('Project').click();
  await page.getByRole('button',{name:'Login',exact:true}).waitFor();assert.equal(await page.locator('#sidebar').count(),0);
  checks.push('expired session encountered by actual route click clears authenticated shell');
  await page.getByLabel('Email',{exact:true}).fill(fixture.email);await page.getByLabel('Password',{exact:true}).fill(fixture.password);
  await page.getByRole('button',{name:'Login',exact:true}).click();await page.waitForURL(`**/projects/${alpha.id}/edit`);
  await page.getByLabel('Website',{exact:true}).waitFor();assert.equal(await page.getByLabel('Website',{exact:true}).inputValue(),'https://alpha.example.test');
  checks.push('session expiry login restores requested project route and real settings');
  await link('Inbox').click();await page.locator('.conversation-inbox').waitFor();
  await view('open').click();await page.locator('.conversation-list-items').getByRole('link').filter({hasText:'Alpha Visitor'}).first().click();
  await page.getByPlaceholder('Type your reply…').waitFor();await page.getByRole('button',{name:'Actions',exact:true}).click();
  // Expire only this request: clearing all cookies lets unrelated inbox refreshes
  // remove the menu before the click. Forward to the real Worker without auth.
  const macrosPath=`/api/dashboard/projects/${alpha.id}/macros`;
  await page.route(url=>url.origin===runtime.origin&&url.pathname===macrosPath,async route=>{
    const headers=await route.request().allHeaders();headers.cookie='';delete headers.authorization;
    const response=await route.fetch({headers});
    await route.fulfill({response});
  });
  const unauthorized=page.waitForResponse(response=>new URL(response.url()).pathname===macrosPath&&response.status()===401);
  await page.getByRole('menuitem',{name:'Saved replies',exact:true}).click();await unauthorized;
  await page.getByRole('button',{name:'Login',exact:true}).waitFor();assert.equal(await page.locator('#sidebar').count(),0);
  checks.push('real saved-replies request without authentication returns 401 and clears stale shell without route navigation');
  assert.deepEqual(errors,[]);success=true;
} catch(error) {
  errors.push(error.stack);await page.screenshot({path:join(evidence,'failure.png'),fullPage:true}).catch(()=>{});throw error;
} finally {
  await writeFile(join(evidence,'result.json'),JSON.stringify({success,checks,errors,requests},null,2));console.log(JSON.stringify({success,checks,errors,evidence},null,2));await browser.close();await runtime.close(success);
}

}
