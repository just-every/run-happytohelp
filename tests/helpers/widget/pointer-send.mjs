import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {createRuntime} from '../emitted-runtime.mjs';
import {launchBrowser} from '../../journeys/kit/browser.mjs'
// Pointer and keyboard sending in the widget at desktop and phone widths.
export async function pointerSendJourney(){

const evidence = resolve(process.env.H2H_EVIDENCE_DIR || 'test-results/widget-pointer-send');
await mkdir(evidence, {recursive: true});
const runtime = await createRuntime();
const records = [];
let browser, success = false;
try {
    browser = await launchBrowser();
    const tenant = await runtime.seedTenant({name: 'Pointer send', email: 'pointer@example.test', allowedOrigin: runtime.origin});
    const avatarUrl = `${runtime.origin}/homepage/media/brands/happytohelp-favicon.png`;
    await runtime.execute(`INSERT INTO project_settings(project_id,settings_json,updated_at) VALUES('${tenant.projectId}','${JSON.stringify({brand_name: 'Pointer send', avatar_url: avatarUrl})}',${Date.now()})`);
    await runtime.execute(`INSERT INTO user_settings(user_id,avatar_url) VALUES('${tenant.userId}','${avatarUrl}')`);
    const response = await fetch(`${runtime.origin}/api/identity/projects/${tenant.projectId}`, {headers: {Authorization: `Bearer ${tenant.token}`}});
    assert.ok(response.ok);
    const project = await response.json();
    const options = {widgetKey: project.widget_key, apiOrigin: runtime.origin, open: false, settings: {collector: {enabled: false}}};
    for (const viewport of [{width: 1440, height: 900}, {width: 390, height: 844}]) {
        const page = await browser.newPage({viewport});
        const errors = [], googleFonts = [];
        page.on('request', request => {if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(request.url())) googleFonts.push(request.url());});
        page.on('pageerror', error => errors.push(error.message));
        const mount = async () => {
            await page.goto(`${runtime.origin}/help/${tenant.projectId}`);
            await page.addScriptTag({url: `${runtime.origin}/widget.js`});
            await page.evaluate(options => window.h2h('init', options), options);
            await page.getByRole('button', {name: 'Open chat', exact: true}).waitFor();
            assert.equal(await page.locator('textarea[name=content]').isVisible(), false, 'widget starts closed');
            const avatar = page.locator('.happytohelp-button img');
            await avatar.waitFor();
            assert.equal(await avatar.getAttribute('src'), avatarUrl);
            await avatar.evaluate(image => image.decode());
            assert.ok(await avatar.evaluate(image => image.complete && image.naturalWidth > 0), 'configured launcher image loads');
            const hostViewport = await page.locator('meta[name=viewport]').getAttribute('content');
            await page.getByRole('button', {name: 'Open chat', exact: true}).click();
            await page.locator('textarea[name=content]').waitFor();
            if (viewport.width === 390) {
                const openViewport = await page.locator('meta[name=viewport]').getAttribute('content');
                assert.match(openViewport, /interactive-widget=resizes-content/);
                assert.doesNotMatch(openViewport, /maximum-scale|user-scalable/, 'mobile open preserves browser zoom');
                await page.locator('.happytohelp-close').click();
                assert.equal(await page.locator('meta[name=viewport]').getAttribute('content'), hostViewport, 'close restores host viewport exactly');
                await page.getByRole('button', {name: 'Open chat', exact: true}).click();
            }
            await page.waitForTimeout(800); // Real entrance motion must finish before pointer input.
            assert.equal(await page.locator('.happytohelp-button img, .happytohelp-button .happytohelp-agent-avatar-initials, .happytohelp-button .happytohelp-workspace-brand').count(), 0, 'open launcher contains only close icon');
            assert.deepEqual(googleFonts, [], 'customer page requests no Google Fonts');
        };
        const check = async (message, phase) => {
            await page.getByText(message, {exact: true}).waitFor();
            await page.waitForTimeout(1000); // Composer and transcript transitions settle; no scroll correction.
            const geometry = await page.locator('.happytohelp-interact').evaluate((panel, message) => {
                const rect = element => {const r = element.getBoundingClientRect(); return {top: r.top, bottom: r.bottom, left: r.left, right: r.right};};
                const root = panel.getRootNode();
                const newest = [...root.querySelectorAll('.happytohelp-chat-message')].find(node => node.textContent.trim() === message);
                return {panel: rect(panel), message: newest ? rect(newest) : null, composer: rect(root.querySelector('textarea[name=content]')), contentScrollTop: root.querySelector('.happytohelp-interact .happytohelp-content').scrollTop};
            }, message);
            records.push({viewport, phase, geometry});
            await writeFile(join(evidence, 'geometry.json'), JSON.stringify(records, null, 2));
            await page.screenshot({path: join(evidence, `${viewport.width}-${phase}.png`)});
            for (const name of ['message', 'composer']) {
                const bounds = geometry[name], panel = geometry.panel;
                assert.ok(bounds, `${phase}: ${name} exists`);
                assert.ok(bounds.top >= Math.max(0, panel.top) - 1 && bounds.bottom <= Math.min(viewport.height, panel.bottom) + 1 && bounds.left >= Math.max(0, panel.left) - 1 && bounds.right <= Math.min(viewport.width, panel.right) + 1,
                    `${viewport.width} ${phase}: ${name} inside visible panel ${JSON.stringify(geometry)}`);
            }
        };
        await mount();
        for (let index = 1; index <= 3; index++) {
            const message = `Pointer send ${viewport.width} message ${index}`;
            await page.locator('textarea[name=content]').fill(message);
            await page.locator('button[name=submit]').click();
            await check(message, `send-${index}`);
        }
        const newest = `Pointer send ${viewport.width} message 3`;
        await page.locator(viewport.width <= 500 ? '.happytohelp-close' : '.happytohelp-button[aria-label="Close chat"]').click();
        await page.getByRole('button', {name: 'Open chat', exact: true}).click();
        await check(newest, 'reopened');
        await page.reload();
        await mount();
        await check(newest, 'reloaded');
        assert.deepEqual(errors, []);
        await page.close();
    }
    success = true;
} finally {
    if (browser) await browser.close();
    await runtime.close(success);
}

}
