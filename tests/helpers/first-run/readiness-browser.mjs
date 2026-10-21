import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createRuntime} from '../emitted-runtime.mjs';
import {checkDelayedArticle} from '../ui-readiness-editor.mjs';
import {installReadinessSampler, assertReadinessFrames} from '../ui-readiness-transitions.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs';
import {nativeHttp} from '../native-http.mjs';

export async function readinessBrowser(){
 const directory = resolve(process.env.H2H_EVIDENCE_DIR || 'test-results/ui-readiness');
 await mkdir(directory, {recursive: true});
 const runtime = await createRuntime();
 let browser, success = false;
 const checks = [];
 try {
     const tenant = await runtime.seedTenant({name: 'Readiness workspace', email: 'readiness@example.test', allowedOrigin: runtime.origin});
     const api = async (path, body, method = body ? 'POST' : 'GET', token = tenant.token) => {
         const response = await nativeHttp(runtime.origin + path, {method, headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Origin: runtime.origin}, ...(body ? {body: JSON.stringify(body)} : {})});
         assert.ok(response.status >= 200 && response.status < 300, path + ': ' + response.status);
         return JSON.parse(response.body);
     };
     await api(`/api/management/projects/${tenant.projectId}/settings`, {primary_color: '#204b3a'}, 'PUT');
     const project = await api(`/api/identity/projects/${tenant.projectId}`);
     const visitor = await api('/api/identity/widget/session', {widgetKey: project.widget_key});
     const conversation = await api('/api/conversations', {projectId: tenant.projectId}, 'POST', visitor.token);
     await api(`/api/conversations/${conversation.id}/messages`, {localId: 'readiness-dialog-message', content: 'Check dialog opening frames.', expectedRevision: 0}, 'POST', visitor.token);
     browser = await launchBrowser();
     const context = await browser.newContext();
     await context.addCookies([{name: 'h2h_session', value: tenant.token, url: runtime.origin}]);
     const page = await context.newPage();
     page.setDefaultTimeout(15000);
     await page.addInitScript(installReadinessSampler);
     for (const width of [1440, 390]) {
         await page.setViewportSize({width, height: width === 390 ? 844 : 1000});
         const original = {title: `Loaded article ${width}`, slug: `loaded-article-${width}`, content: 'Original published knowledge.', summary: 'Retained original summary', status: 'published'};
         const article = {...original, ...await api(`/api/knowledge/${tenant.projectId}/articles`, original)};
         await checkDelayedArticle({page, origin: runtime.origin, projectId: tenant.projectId, article, api, directory, width});
         checks.push(`${width}: disabled persistent actions through delayed/error load; no early writes; loaded record and publication saved durably; explicit save recovers after transport error`);
         let release;
         const held = new Promise(resolve => { release = resolve; });
         const path = `/api/management/projects/${tenant.projectId}/widget-settings`;
         await page.route('**' + path, async route => { await held; await route.continue(); });
         try {
             await page.goto(`${runtime.origin}/projects/${tenant.projectId}/widget-settings`);
             await page.getByText('Loading your widget settings and preview…').waitFor();
             if (width === 390) await page.getByRole('button', {name: 'Toggle navigation', exact: true}).click();
             await page.getByRole('button', {name: 'Account menu', exact: true}).filter({visible: true}).click();
             await page.locator('.native-account-dropdown').waitFor();
             await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
             await page.keyboard.press('Escape');
             if (width === 390 && await page.getByRole('button', {name: 'Toggle navigation', exact: true}).getAttribute('aria-expanded') === 'true') {
                 await page.getByRole('button', {name: 'Toggle navigation', exact: true}).click();
             }
             release();
             await page.getByRole('tab', {name: 'Theme', exact: true}).click();
             await page.getByLabel('Avatar background', {exact: true}).waitFor();
             await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
             const frames = await page.evaluate(() => {window.stopReadinessSampling = true; return window.readinessFrames;});
             await writeFile(join(directory, `${width}-transition-frames.json`), JSON.stringify(frames, null, 2));
             assertReadinessFrames(frames);
             assert.ok(frames.some(frame => frame.selector.includes('dropdown-item')), 'menu opening sampled');
             assert.ok(frames.some(frame => frame.selector === '.tab-pane.active label'), 'tab activation sampled');
             checks.push(`${width}: ${frames.length} rendered settings/menu/tab frames retain full opacity, AA text contrast and menu hit areas`);
         } finally {
             release();
             await page.unroute('**' + path);
         }
         await page.goto(`${runtime.origin}/projects/${tenant.projectId}/conversations/${conversation.id}`);
         await page.locator('.transcript-message-content').getByText('Check dialog opening frames.', {exact: true}).waitFor();
         await page.getByRole('button', {name: 'Actions', exact: true}).click();
         await page.getByRole('menuitem', {name: 'Internal note', exact: true}).click();
         await page.getByRole('dialog', {name: 'Add Note'}).waitFor();
         await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
         const dialogFrames = await page.evaluate(() => {window.stopReadinessSampling = true; return window.readinessFrames;});
         await writeFile(join(directory, `${width}-dialog-frames.json`), JSON.stringify(dialogFrames, null, 2));
         assertReadinessFrames(dialogFrames);
         assert.ok(dialogFrames.some(frame => frame.selector === '.modal .btn'), 'dialog opening sampled');
         await page.getByRole('dialog', {name: 'Add Note'}).getByRole('button', {name: 'Close', exact: true}).first().click();
         checks.push(`${width}: ${dialogFrames.length} rendered inbox/dialog frames retain full opacity, AA text contrast and stable dialog hit areas`);
         await page.getByRole('dialog', {name: 'Add Note'}).waitFor({state: 'hidden'});
         if (width === 390) await page.getByRole('button', {name: 'Toggle navigation', exact: true}).click();
         await page.getByRole('button', {name: 'Account menu', exact: true}).filter({visible: true}).click();
         await page.locator('.native-account-dropdown').waitFor();
         const settingsGeometry = await page.getByTestId('nav-settings').evaluate(element => {
             const rect = element.getBoundingClientRect(), menu = document.querySelector('.native-account-dropdown').getBoundingClientRect();
             const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
             return {button: rect.toJSON(), menu: menu.toJSON(), centerReachable: element === hit || element.contains(hit), intersection: {width: Math.max(0, Math.min(rect.right, menu.right) - Math.max(rect.left, menu.left)), height: Math.max(0, Math.min(rect.bottom, menu.bottom) - Math.max(rect.top, menu.top))}};
         });
         await writeFile(join(directory, `${width}-account-settings-geometry.json`), JSON.stringify(settingsGeometry, null, 2));
         assert.ok(settingsGeometry.centerReachable, 'Settings remains reachable while the account menu is open');
         assert.equal(settingsGeometry.intersection.width * settingsGeometry.intersection.height, 0, 'account menu leaves the Settings target unobscured');
         await page.keyboard.press('Escape');
         checks.push(`${width}: open account menu leaves the rendered Settings control unobscured and reachable`);
     }
     await writeFile(join(directory, 'summary.json'), JSON.stringify({checks}, null, 2));
     console.log(JSON.stringify({checks}, null, 2));
     success = true;
 } finally {
     await browser?.close();
     await runtime.close(success);
 }
}
