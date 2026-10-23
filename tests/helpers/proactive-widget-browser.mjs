import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRuntime} from './emitted-runtime.mjs';
import {launchBrowser} from '../journeys/kit/browser.mjs';
import {configuredSupportBrowser} from './configured-support-browser.mjs';

export async function proactiveWidgetBrowser({operatorJourney=true}={}) {
    const evidence = resolve(process.env.H2H_EVIDENCE_DIR || 'test-results/proactive');
    await mkdir(evidence, {recursive: true});
    const runtime = await createRuntime({queueConsumers: true, inspectorPort: 0, vars: {OPENAI_API_KEY: 'synthetic-inert-test-key', APIFY_TOKEN: 'synthetic-inert-test-key', APIFY_CRAWLER_ACTOR_ID: 'fixture-crawler'}, outboundFixture: new URL('./proactive-provider-network.mjs', import.meta.url).href});
    let browser, host, success = false;
    const call = async (path, body, token, method = body === undefined ? 'GET' : 'POST') => {
        const response = await fetch(runtime.origin + path, {method, headers: {'Content-Type': 'application/json', ...(token ? {Authorization: `Bearer ${token}`} : {})}, body: body === undefined ? undefined : JSON.stringify(body)});
        assert.ok(response.ok, `${path}: ${response.status} ${await response.clone().text()}`);
        return response.json();
    };
    try {
        const owner = await call('/api/identity/bootstrap', {name: 'Northstar Support', email: 'support-owner@example.test', password: 'synthetic-browser-owner-password', allowedOrigin: runtime.origin});
        const project = await call('/api/identity/projects/' + owner.projectId, undefined, owner.token);
        await call(`/api/management/projects/${owner.projectId}/settings`, {is_contact_tracking_enabled: true, proactive_help_enabled: true}, owner.token, 'PUT');
        const widget = await readFile(new URL('../../public/widget.js', import.meta.url));
        const steps = ['Workspace settings', 'API credentials', 'Create credential', 'Copy credential', 'Check connection', 'Try connection again', 'Connection troubleshooting'];
        host = createServer((request, response) => {
            response.setHeader('Content-Type', request.url === '/widget.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
            response.end(request.url === '/widget.js' ? widget : `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Northstar connections</title><style>body{font:16px system-ui;margin:0;background:#f4f6f8;color:#253540}main{max-width:840px;margin:40px auto;padding:24px}button{padding:12px;margin:5px;border:1px solid #bccbd2;border-radius:6px;background:white;color:#253540}.error{padding:16px;background:#fff1ed;border-radius:6px}</style><main><h1>Connect your workspace</h1><p>Connect your Northstar integration using an API credential.</p><p class="error">Connection unsuccessful. Check your API credential and try again.</p>${steps.map(text => `<button>${text}</button>`).join('')}</main><script src="/widget.js"></script><script>h2h('init',${JSON.stringify({widgetKey: project.widget_key, apiOrigin: runtime.origin, open: true})})</script>`);
        });
        await new Promise(done => host.listen(0, '127.0.0.1', done));
        const hostOrigin = `http://127.0.0.1:${host.address().port}`;
        await call(`/api/management/projects/${owner.projectId}/settings`, {allowed_origin: hostOrigin}, owner.token, 'PUT');
        browser = await launchBrowser();
        if(operatorJourney)await configuredSupportBrowser({browser,runtime,owner,project,call,evidence});
        for (const width of [1440, 390]) {
          for (const mode of ['act', 'dismiss']) {
            const context = await browser.newContext({viewport: {width, height: 960},isMobile:width===390,hasTouch:width===390}), page = await context.newPage();
            const errors = []; page.on('pageerror', error => errors.push(error.message));
            try {
                await page.goto(hostOrigin);
                await page.getByRole('button', {name: 'Allow proactive help', exact: true}).waitFor();
                await page.screenshot({path: `${evidence}/consent-${width}.png`, fullPage: true});
                await page.getByRole('button', {name: 'Allow proactive help', exact: true}).click();
                await page.getByRole('button', {name: 'Stop sharing activity'}).waitFor();
                await page.getByRole('button', {name: 'Close chat', exact: true}).click();
                for (const step of steps) await page.getByRole('button', {name: step, exact: true}).click();
                const offer = page.locator('.happytohelp-insight');
                await offer.waitFor({state: 'visible', timeout: 30000});
                if(width!==390){
                    await offer.hover();
                    await page.locator('.happytohelp-insight-button-send').waitFor({state:'visible'});
                    await page.waitForTimeout(500);
                }
                await page.screenshot({path: `${evidence}/insight-${width}.png`, fullPage: true});
                if (mode === 'dismiss') {
                    if(width===390)await page.getByRole('button', {name: 'Close', exact: true}).tap();
                    else await page.getByText('No thanks', {exact: true}).click();
                    await offer.waitFor({state: 'hidden'});
                    await page.reload();
                    await page.getByRole('button', {name: 'Stop sharing activity'}).waitFor();
                    await page.getByRole('button', {name: 'Close chat', exact: true}).click();
                    await page.waitForTimeout(5500);
                    assert.equal(await offer.isVisible(), false, 'dismissal survives reload and polling');
                    await page.screenshot({path: `${evidence}/insight-dismissed-${width}.png`, fullPage: true});
                    assert.deepEqual(errors, []);
                    continue;
                }
                if(width===390)await page.locator('.happytohelp-insight-content').tap();
                else await page.getByText('Show me where', {exact: true}).click();
                await page.getByText('Open Workspace settings, choose API credentials, and create a credential. Copy it into your integration, then check the connection again.', {exact: true}).waitFor({timeout: 30000});
                await page.waitForTimeout(1500);
                await page.screenshot({path: `${evidence}/insight-answer-${width}.png`, fullPage: true});
                await page.reload();
                await page.getByText('Show me where', {exact: true}).waitFor();
                await page.getByRole('button', {name: 'Stop sharing activity'}).click();
                await page.getByRole('button', {name: 'Allow proactive help', exact: true}).waitFor();
                assert.deepEqual(errors, []);
            } catch(error) { await page.screenshot({path:`${evidence}/proactive-failure-${width}.png`,fullPage:true}); throw error; } finally { await context.close(); }
          }
        }
        // One visitor with several open tabs: idle tabs stay quiet, so real activity, the
        // offer and a consent change in another tab all fit the per-visitor allowance.
        {
            const context = await browser.newContext({viewport: {width: 1440, height: 960}}), events = [], refused = [];
            context.on('request', request => { if (request.url().endsWith('/widget-events')) events.push({at: Date.now(), action: request.postDataJSON()?.action}); });
            context.on('response', response => { if (response.status() === 429) refused.push(response.url()); });
            try {
                const tabs = [await context.newPage()];
                await tabs[0].goto(hostOrigin);
                await tabs[0].getByRole('button', {name: 'Allow proactive help', exact: true}).click();
                await tabs[0].getByRole('button', {name: 'Stop sharing activity'}).waitFor();
                for (let index = 1; index < 4; index++) { tabs.push(await context.newPage()); await tabs[index].goto(hostOrigin); await tabs[index].getByRole('button', {name: 'Stop sharing activity'}).waitFor(); }
                for (const tab of tabs) await tab.getByRole('button', {name: 'Close chat', exact: true}).click();
                await tabs[0].waitForTimeout(2500);
                const idleFrom = Date.now();
                await tabs[0].waitForTimeout(20000);
                const idle = events.filter(event => event.at >= idleFrom);
                assert.deepEqual(idle.filter(event => event.action === 'pingAction'), [], 'idle consented tabs send no activity pings');
                assert.ok(idle.filter(event => event.action === 'insights').length < tabs.length, `idle tabs back off offer checks: ${JSON.stringify(idle)}`);
                await tabs[0].bringToFront();
                for (const step of steps) await tabs[0].getByRole('button', {name: step, exact: true}).click();
                await tabs[0].locator('.happytohelp-insight').waitFor({state: 'visible', timeout: 30000});
                await tabs[0].screenshot({path: `${evidence}/multi-tab-insight-1440.png`, fullPage: true});
                await tabs[1].bringToFront();
                await tabs[1].getByRole('button', {name: 'Open chat'}).first().click();
                await tabs[1].getByRole('button', {name: 'Stop sharing activity'}).click();
                await tabs[1].getByRole('button', {name: 'Allow proactive help', exact: true}).waitFor();
                assert.deepEqual(refused, [], 'no widget request from this visitor is refused');
            } finally { await context.close(); }
        }
        success = true;
    } finally { await browser?.close(); if (host) await new Promise(done => host.close(done)); await runtime.close(success); }
}
