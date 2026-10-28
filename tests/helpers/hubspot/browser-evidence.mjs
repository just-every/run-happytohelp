import assert from 'node:assert/strict';
import {resolve} from 'node:path';

export async function openTicketPanel(page) {
    // Preserve main's responsive-state wait. At the fixed desktop width React must
    // finish opening the desktop assistant before its controls or values are used.
    await page.waitForFunction(() => document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden') === 'false');
    await page.getByRole('tab', {name: 'Ticket', exact: true}).click();
    const heading = page.locator('#ticket-section-customer-heading');
    await heading.waitFor();
    if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
    await page.getByRole('region', {name: 'HubSpot context', exact: true}).waitFor();
}

const fact = (region, name) => region.locator('dl > div').filter({has: region.page().locator('dt').filter({hasText: new RegExp(`^${name}$`)})}).locator('dd');

async function expectFact(region, name, value) {
    const field = fact(region, name);
    await field.waitFor();
    assert.equal(await field.innerText(), value, name + ' matches the connected source');
}

export async function assertContextValues(panel, provider, contactId) {
    // Values come from the mutable provider fixture, rather than product copy.
    for (const [name, value] of [['Source account', '123'], ['Source contact ID', contactId], ['Source company ID', '21']]) {
        await expectFact(panel, name, value);
    }
    for (const [index, owner] of ['51', '52'].entries()) {
        const values = panel.locator('.crm-values > div').nth(index);
        for (const [name, value] of [['Source ID', index === 0 ? contactId : '21'], ['Plan', provider.plan], ['Entitlement', provider.entitlement], ['Owner ID', owner]]) {
            await expectFact(values, name, value);
        }
        assert.ok(Number.isFinite(Date.parse(await fact(values, 'Source updated').innerText())), 'source update time is visible');
    }
    for (const name of ['Last checked', 'Last refreshed']) {
        assert.ok(Number.isFinite(Date.parse(await fact(panel, name).innerText())), name + ' has a real time');
    }
}

export function hubspotEvidence({page, directory}) {
    return async (name, {loading = false} = {}) => {
        const settings = name.startsWith('settings');
        const selector = `[aria-label="HubSpot ${settings ? 'connection' : 'context'}"]`;
        const target = page.locator(selector);
        await target.waitFor();
        if (!loading) await page.waitForFunction(selector => {
            const node = document.querySelector(selector);
            return node && node.getAttribute('aria-busy') !== 'true';
        }, selector);
        if (name.startsWith('ticket')) {
            await openTicketPanel(page);
            await fact(target, 'Last checked').waitFor();
        }
        await target.scrollIntoViewIfNeeded();
        if (settings) await page.evaluate(() => window.scrollTo(0, 0));
        await page.addScriptTag({path: resolve('node_modules/axe-core/axe.min.js')});
        const violations = await page.evaluate(async selector => (await axe.run(document.querySelector(selector))).violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id), selector);
        assert.deepEqual(violations, [], name + ' targeted accessibility');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits');
        await page.screenshot({path: `${directory}/${name}-1440.png`, fullPage: true});
        if (name.startsWith('ticket')) {
            await target.getByRole('button', {name: 'Refresh HubSpot context', exact: true}).scrollIntoViewIfNeeded();
            await page.screenshot({path: `${directory}/${name}-values-1440.png`});
        }
    };
}
