import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {passwordHash} from '../identity-browser-kit.mjs';
import {createRuntime} from '../emitted-runtime.mjs';

/** Extends the existing Connections interface journey; only provider network I/O is substituted. */
export async function hubspotBrowser({browser, directory}) {
    await mkdir(directory, {recursive: true});
    const provider = {email: 'maya@example.test', plan: 'Growth', entitlement: 'Business hours', status: 200, extraScope: false};
    const server = createServer(async (request, response) => {
        const url = new URL(request.url, 'http://127.0.0.1');
        let body = ''; for await (const chunk of request) body += chunk;
        if (provider.status !== 200) {response.writeHead(provider.status); response.end('Provider refused'); return;}
        let data;
        if (url.pathname === '/oauth/v2/private-apps/get/access-token-info') {
            assert.equal(JSON.parse(body).tokenKey, 'synthetic-hubspot-browser-token');
            data = {hubId: 123, scopes: ['crm.objects.contacts.read', 'crm.objects.companies.read', ...(provider.extraScope ? ['crm.objects.contacts.write'] : [])]};
        } else {
            assert.equal(request.method, 'GET'); assert.equal(request.headers.authorization, 'Bearer synthetic-hubspot-browser-token');
            if (['/crm/v3/objects/contacts/11', '/crm/v3/objects/contacts/12'].includes(url.pathname)) data = {id: url.pathname.split('/').at(-1), updatedAt: '2026-10-28T10:00:00Z', properties: {email: provider.email, hubspot_owner_id: '51', support_plan: provider.plan, support_entitlement: provider.entitlement}, associations: {companies: {results: [{id: '21'}]}}};
            else if (url.pathname === '/crm/v3/objects/companies/21') data = {id: '21', updatedAt: '2026-10-28T10:00:00Z', properties: {domain: 'northstar.example', name: 'Northstar Labs', hubspot_owner_id: '52', support_plan: provider.plan, support_entitlement: provider.entitlement}};
            else {response.writeHead(404); response.end(); return;}
        }
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(data));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let runtime, context, passed = false;
    try {
        const fixture = new URL('./outbound.mjs', import.meta.url); fixture.searchParams.set('target', `http://127.0.0.1:${server.address().port}`);
        runtime = await createRuntime({outboundFixture: fixture.href, vars: {INTEGRATION_ENCRYPTION_KEY: randomBytes(32).toString('base64')}});
        const owner = await runtime.seedTenant({name: 'Northstar Support', email: 'owner@example.test'});
        const foreign = await runtime.seedTenant({name: 'Other workspace', email: 'other-owner@example.test'});
        context = await browser.newContext({viewport: {width: 1440, height: 1000}});
        await context.addCookies([{name: 'h2h_session', value: owner.token, url: runtime.origin}]);
        const page = await context.newPage(); page.setDefaultTimeout(20000);
        const base = `/api/management/projects/${owner.projectId}`;
        const api = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
            const response = await context.request.fetch(runtime.origin + path, {method, ...(body === undefined ? {} : {data: body})});
            assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`); return response.json();
        };
        const contact = (await api(base + '/contacts', {name: 'Maya Patel', email: provider.email})).data;
        const other = (await api(base + '/contacts', {name: 'Jordan Lee', email: 'jordan@example.test'})).data;
        const company = (await api(base + '/companies', {name: 'Northstar Labs', domains: ['northstar.example']})).company;
        await api(`${base}/companies/${company.id}/members/${contact.id}`, {}, 'PUT');
        const ticket = await api('/api/conversations', {projectId: owner.projectId, contactId: contact.id});
        const otherTicket = await api('/api/conversations', {projectId: owner.projectId, contactId: other.id});
        await api(`/api/conversations/${ticket.id}/messages`, {localId: 'opening', content: 'Can you confirm the support plan for our export issue?', expectedRevision: 0});
        const settings = runtime.origin + `/projects/${owner.projectId}/hubspot-settings`;
        const customer = runtime.origin + `/projects/${owner.projectId}/contacts/${contact.id}`;
        const panel = () => page.getByRole('region', {name: 'HubSpot context', exact: true});
        const captures = async name => {
            for (const width of [1440, 390]) {
                await page.setViewportSize({width, height: 1000});
                if (name.startsWith('ticket')) {
                    const assistant = page.locator('#conversation-assistant');
                    if (await assistant.getAttribute('aria-hidden') === 'true') await page.getByRole('button', {name: 'Show conversation panel', exact: true}).click();
                    await page.getByRole('tab', {name: 'Ticket', exact: true}).click();
                    const customerHeading = page.locator('#ticket-section-customer-heading');
                    if (await customerHeading.getAttribute('aria-expanded') !== 'true') await customerHeading.click();
                }
                const target = name.startsWith('settings') ? page.getByRole('region', {name: 'HubSpot connection'}) : panel();
                await target.evaluate(node => node.scrollIntoView({block: 'start'}));
                if (name.startsWith('settings')) await page.evaluate(() => window.scrollTo(0, 0));
                await page.screenshot({path: `${directory}/${name}-${width}.png`, fullPage: true});
                if (name.startsWith('ticket')) {
                    await target.getByRole('button', {name: 'Refresh HubSpot context', exact: true}).scrollIntoViewIfNeeded();
                    await page.screenshot({path: `${directory}/${name}-values-${width}.png`});
                }
            }
            await page.setViewportSize({width: 1440, height: 1000});
            if (name.startsWith('ticket')) {
                const assistant = page.locator('#conversation-assistant');
                if (await assistant.getAttribute('aria-hidden') === 'true') await page.getByRole('button', {name: 'Show conversation panel', exact: true}).click();
                await page.getByRole('tab', {name: 'Ticket', exact: true}).click();
                const heading = page.locator('#ticket-section-customer-heading');
                if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
                await panel().getByText('Last checked', {exact: true}).waitFor();
            }
            await page.addScriptTag({path: resolve('node_modules/axe-core/axe.min.js')});
            const selector = name.startsWith('settings') ? '[aria-label="HubSpot connection"]' : '[aria-label="HubSpot context"]';
            const violations = await page.evaluate(async selector => (await axe.run(document.querySelector(selector))).violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id), selector);
            assert.deepEqual(violations, [], name + ' targeted accessibility');
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' fits');
        };
        const openCustomer = async () => {await page.goto(customer); await panel().getByRole('button', {name: 'Check CRM status', exact: true}).waitFor();};
        const fresh = async () => {await panel().getByText('Fresh — identity checked against HubSpot.', {exact: true}).waitFor();};
        const refresh = async () => {await panel().getByRole('button', {name: 'Refresh HubSpot context', exact: true}).click();};
        const connect = async (stepUp = false) => {
            await page.getByLabel('HubSpot account ID', {exact: true}).fill('123');
            await page.getByLabel('Private app token', {exact: true}).fill('synthetic-hubspot-browser-token');
            await page.getByLabel('Plan property (optional)', {exact: true}).fill('support_plan');
            await page.getByLabel('Entitlement property (optional)', {exact: true}).fill('support_entitlement');
            await page.getByRole('button', {name: 'Connect HubSpot', exact: true}).click();
            if (stepUp) {
                const dialog = page.getByRole('dialog');
                await dialog.getByLabel('Your password', {exact: true}).waitFor();
                await page.screenshot({path: `${directory}/settings-step-up-1440.png`});
                await dialog.getByLabel('Your password', {exact: true}).fill('synthetic-hubspot-owner-password');
                await dialog.getByRole('button', {name: 'Confirm', exact: true}).click();
            }
        };
        await page.goto(settings); await page.getByText('HubSpot disconnected', {exact: true}).waitFor(); await captures('settings-empty');
        await runtime.execute(`INSERT INTO credentials(user_id,password_hash,updated_at) VALUES('${owner.userId}','${passwordHash('synthetic-hubspot-owner-password')}',${Date.now()}); UPDATE session_factors SET verified_at=1 WHERE user_id='${owner.userId}'`);
        provider.extraScope = true; await connect(true); await page.getByRole('alert').filter({hasText: 'exact read-only scopes'}).waitFor();
        assert.equal(await page.getByLabel('Private app token', {exact: true}).inputValue(), '');
        assert.equal(await page.getByLabel('HubSpot account ID', {exact: true}).inputValue(), '123'); await captures('settings-refused');
        provider.extraScope = false; await connect(); await page.getByText('Connected to HubSpot account 123', {exact: false}).waitFor();
        assert.equal(await page.getByLabel('Private app token', {exact: true}).inputValue(), '');
        assert.ok(!await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]).includes('synthetic-hubspot-browser-token'))); await captures('settings-connected');
        await openCustomer(); await panel().getByText('Unmapped — choose source IDs on the customer record.', {exact: true}).waitFor(); await captures('customer-unmapped');
        await panel().getByRole('button', {name: 'Map customer to HubSpot', exact: true}).click();
        await panel().getByLabel('HubSpot contact ID', {exact: true}).fill('11');
        await panel().getByLabel('Native company (optional)', {exact: true}).selectOption(company.id);
        await panel().getByLabel('HubSpot company ID', {exact: true}).fill('21');
        await panel().getByLabel('HubSpot contact ID', {exact: true}).focus();
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).evaluate(node => node === document.activeElement), true);
        await page.keyboard.press('Tab');
        assert.equal(await panel().getByLabel('Native company (optional)', {exact: true}).evaluate(node => node === document.activeElement), true);
        assert.notEqual(await panel().getByLabel('Native company (optional)', {exact: true}).evaluate(node => getComputedStyle(node).outlineStyle), 'none');
        await captures('customer-mapping');
        await panel().getByRole('button', {name: 'Save explicit mapping', exact: true}).click();
        await panel().getByText('Stale — refresh to check the latest identity and account context.', {exact: true}).waitFor(); await captures('customer-stale');
        await refresh(); await fresh(); await panel().getByText('Business hours', {exact: true}).first().waitFor(); await captures('customer-fresh');
        await panel().getByRole('button', {name: 'Remap customer', exact: true}).click();
        await panel().getByLabel('HubSpot contact ID', {exact: true}).fill('12');
        await panel().getByRole('button', {name: 'Save explicit mapping', exact: true}).click();
        await refresh(); await fresh(); await panel().getByText('12', {exact: true}).first().waitFor();
        await runtime.execute(`UPDATE crm_mappings SET refreshed_at=${Date.now()-600000} WHERE project_id='${owner.projectId}' AND contact_id='${contact.id}'`);
        await panel().getByRole('button', {name: 'Check CRM status', exact: true}).click();
        await panel().getByText('Stale — refresh to check the latest identity and account context.', {exact: true}).waitFor();
        await panel().getByText('Business hours', {exact: true}).first().waitFor(); await captures('customer-stale-cache');
        await refresh(); await fresh();
        const openTicket = async id => {
            await page.goto(runtime.origin + `/projects/${owner.projectId}/conversations/${id}`);
            const assistant = page.locator('#conversation-assistant');
            if (await assistant.getAttribute('aria-hidden') === 'true') await page.getByRole('button', {name: 'Show conversation panel', exact: true}).click();
            await page.getByRole('tab', {name: 'Ticket', exact: true}).click();
            const heading = page.locator('#ticket-section-customer-heading');
            if (await heading.count() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
            await panel().waitFor();
        };
        await openTicket(ticket.id); await fresh();
        provider.plan = 'Enterprise'; provider.entitlement = 'Priority response'; await refresh(); await fresh();
        await panel().getByText('Priority response', {exact: true}).first().waitFor(); await captures('ticket-fresh');
        await openCustomer(); await panel().getByText('Priority response', {exact: true}).first().waitFor();
        provider.email = 'different@example.test'; await refresh(); await panel().getByText(/^Identity mismatch/).waitFor();
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0); await captures('customer-mismatch');
        provider.email = 'maya@example.test'; await refresh(); await fresh();
        provider.status = 403; await refresh(); await panel().getByText(/^Grant revoked or refused/).waitFor();
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0); await captures('customer-provider-refused');
        provider.status = 500; await refresh(); await panel().getByText(/^Unavailable —/).waitFor(); await captures('customer-unavailable');
        provider.status = 200; await refresh(); await fresh();
        // Hold a genuine application response during navigation; never synthesize application behavior.
        let release, reached; const held = new Promise(resolve => {release = resolve;}), waiting = new Promise(resolve => {reached = resolve;});
        await page.route('**/crm/hubspot/contacts/' + contact.id, async route => {const response = await route.fetch(); reached(); await held; await route.fulfill({response});});
        await panel().getByRole('button', {name: 'Check CRM status', exact: true}).click(); await waiting;
        await panel().getByText('Loading HubSpot context…', {exact: true}).waitFor(); await captures('customer-loading');
        await page.goto(runtime.origin + `/projects/${owner.projectId}/contacts/${other.id}`); release();
        await panel().getByText('Unmapped — choose source IDs on the customer record.', {exact: true}).waitFor();
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0);
        await page.unrouteAll({behavior: 'wait'});
        await panel().getByRole('button', {name: 'Map customer to HubSpot', exact: true}).click();
        await panel().getByLabel('HubSpot contact ID', {exact: true}).fill('12');
        await panel().getByRole('button', {name: 'Save explicit mapping', exact: true}).click();
        await panel().getByRole('alert').filter({hasText: 'CRM mapping, identity or authority changed'}).waitFor();
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).inputValue(), '12');
        await panel().getByRole('button', {name: 'Cancel mapping', exact: true}).click();
        await openTicket(otherTicket.id); await panel().getByText('Unmapped — choose source IDs on the customer record.', {exact: true}).waitFor();
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0);
        await page.goto(runtime.origin + `/projects/${foreign.projectId}/hubspot-settings`); await page.getByText('Project not found', {exact: true}).first().waitFor();
        assert.equal(await page.getByRole('region', {name: 'HubSpot context'}).count(), 0);
        await openCustomer(); await fresh();
        // Revoke native authority while a remapping form is open; cached source IDs must disappear too.
        await panel().getByRole('button', {name: 'Remap customer', exact: true}).click();
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).inputValue(), '12');
        await runtime.execute(`UPDATE memberships SET role='operator' WHERE project_id='${owner.projectId}' AND user_id='${owner.userId}'; UPDATE sessions SET role='operator' WHERE actor_id='${owner.userId}'`);
        await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await panel().getByRole('alert').waitFor();
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).count(), 0);
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0); await captures('customer-denied');
        await page.reload(); await page.getByText('CRM context requires a workspace owner or admin with customer management permission. Ask your owner for access.', {exact: true}).waitFor();
        await openTicket(ticket.id); await panel().getByText('CRM context requires a workspace owner or admin with customer management permission. Ask your owner for access.', {exact: true}).waitFor();
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0);
        await page.goto(settings); await page.getByText('HubSpot requires a workspace owner or admin with customer management permission. Ask your owner for access.', {exact: true}).waitFor();
        await runtime.execute(`UPDATE memberships SET role='owner' WHERE project_id='${owner.projectId}' AND user_id='${owner.userId}'; UPDATE sessions SET role='owner' WHERE actor_id='${owner.userId}'`);
        await openCustomer(); await fresh();
        await panel().getByRole('button', {name: 'Remove HubSpot mapping', exact: true}).click(); await panel().getByRole('button', {name: 'Confirm remove mapping', exact: true}).click();
        await panel().getByText('Unmapped — choose source IDs on the customer record.', {exact: true}).waitFor();
        await panel().getByRole('button', {name: 'Map customer to HubSpot', exact: true}).click(); await panel().getByLabel('HubSpot contact ID', {exact: true}).fill('11'); await panel().getByRole('button', {name: 'Save explicit mapping', exact: true}).click();
        await refresh(); await fresh();
        await page.goto(settings); await connect(); await page.getByText('Connected to HubSpot account 123', {exact: false}).waitFor();
        await openCustomer(); await panel().getByText('Unmapped — choose source IDs on the customer record.', {exact: true}).waitFor();
        await page.goto(settings); await page.getByRole('button', {name: 'Disconnect HubSpot', exact: true}).click(); await runtime.execute(`UPDATE session_factors SET verified_at=1 WHERE user_id='${owner.userId}'`);
        await page.getByRole('button', {name: 'Confirm disconnect', exact: true}).click();
        const disconnectProof = page.getByRole('dialog'); await disconnectProof.getByLabel('Your password', {exact: true}).fill('synthetic-hubspot-owner-password'); await disconnectProof.getByRole('button', {name: 'Confirm', exact: true}).click();
        await page.getByText('HubSpot disconnected', {exact: false}).first().waitFor(); await captures('settings-disconnected');
        await openCustomer(); await panel().getByText(/^Disconnected —/).waitFor(); await captures('customer-disconnected');
        passed = true;
    } finally {
        await context?.close(); await runtime?.close(passed); await new Promise(resolve => server.close(resolve));
    }
}
