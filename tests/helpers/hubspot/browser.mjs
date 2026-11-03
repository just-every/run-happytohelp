import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,pbkdf2Sync} from 'node:crypto';
function passwordHash(password){const salt=randomUUID();return `${salt}:${pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')}`}
import {createRuntime} from '../emitted-runtime.mjs';

/** Extends the existing Connections interface journey; only provider network I/O is substituted. */
export async function hubspotBrowser({browser, directory}) {
    await mkdir(directory, {recursive: true});
    const provider = {email: 'maya@example.test', plan: 'Growth', entitlement: 'Business hours', status: 200, extraScope: false};
    let providerRequests = 0;
    const server = createServer(async (request, response) => {
        ++providerRequests;
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
    let runtime, context, operatorContext, passed = false;
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
        const captureViewport = async (name, width) => {
            const crossedPanelBreakpoint = (page.viewportSize().width >= 1280) !== (width >= 1280);
            await page.setViewportSize({width, height: 1000});
            if (name.startsWith('ticket') && crossedPanelBreakpoint) {
                // useConversationAssistant closes the compact sheet in a matchMedia
                // change handler. Wait for React to apply it before deciding to open it.
                await page.waitForFunction(desktop => document.querySelector('#conversation-assistant')?.getAttribute('aria-hidden') === String(!desktop), width >= 1280);
            }
        };
        const captures = async name => {
            for (const width of [1440, 390]) {
                await captureViewport(name, width);
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
            await captureViewport(name, 1440);
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
        await page.goto(customer); await page.getByRole('heading', {name: 'Maya Patel', exact: true}).waitFor();
        assert.equal(await panel().count(), 0, 'never-connected workspaces have no CRM box');
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
        // A connection recheck while this customer stays open must retain the unsaved mapping.
        const rechecked = page.waitForResponse(response => response.url().endsWith('/crm/hubspot') && response.request().method() === 'GET');
        await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await rechecked;
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).inputValue(), '11');
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
        await refresh(); await fresh(); await panel().getByText('HubSpot source identifiers', {exact: true}).click(); await panel().getByText('12', {exact: true}).first().waitFor();
        await runtime.execute(`UPDATE crm_mappings SET refreshed_at=${Date.now()-600000} WHERE project_id='${owner.projectId}' AND contact_id='${contact.id}'`);
        await panel().getByRole('button', {name: 'Check CRM status', exact: true}).click();
        await panel().getByText('Stale — refresh to check the latest identity and account context.', {exact: true}).waitFor();
        await panel().getByText('Business hours', {exact: true}).first().waitFor(); await captures('customer-stale-cache');
        await refresh(); await fresh();
        const openTicket = async (id, expectCrm = true) => {
            await page.goto(runtime.origin + `/projects/${owner.projectId}/conversations/${id}`);
            const assistant = page.locator('#conversation-assistant');
            if (await assistant.getAttribute('aria-hidden') === 'true') await page.getByRole('button', {name: 'Show conversation panel', exact: true}).click();
            await page.getByRole('tab', {name: 'Ticket', exact: true}).click();
            const heading = page.locator('#ticket-section-customer-heading');
            if (await heading.count() && await heading.getAttribute('aria-expanded') === 'false') await heading.click();
            if (expectCrm) await panel().waitFor();
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
        await panel().getByRole('alert').filter({hasText: 'already mapped to another customer'}).waitFor();
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).inputValue(), '12');
        await panel().getByRole('button', {name: 'Cancel mapping', exact: true}).click();
        await openTicket(otherTicket.id); await panel().getByText('Unmapped — choose source IDs on the customer record.', {exact: true}).waitFor();
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0);
        await page.goto(runtime.origin + `/projects/${foreign.projectId}/hubspot-settings`); await page.getByText('Project not found', {exact: true}).first().waitFor();
        assert.equal(await page.getByRole('region', {name: 'HubSpot context'}).count(), 0);
        await openCustomer(); await fresh();
        // The same built component serves an operator with no customer/integration permissions.
        const operator = await runtime.seedTenant({name: 'Ticket support', email: 'operator@example.test'});
        const role = {name: 'Ticket support only', base: 'operator', permissions: ['conversations.reply', 'conversations.notes', 'conversations.follow', 'conversations.manage']};
        const roleId = (await api(base + '/roles', role)).data.id;
        const deniedRoleId = (await api(base + '/roles', {name: 'No inbox', base: 'operator', permissions: []})).data.id;
        await runtime.execute(`INSERT INTO memberships(project_id,user_id,role) VALUES('${owner.projectId}','${operator.userId}','operator'); UPDATE sessions SET project_id='${owner.projectId}',role='operator' WHERE actor_id='${operator.userId}'`);
        await api(`${base}/agents/${operator.userId}`, {role: roleId}, 'PUT');
        operatorContext = await browser.newContext({viewport: {width: 1440, height: 1000}});
        await operatorContext.addCookies([{name: 'h2h_session', value: operator.token, url: runtime.origin}]);
        const operatorPage = await operatorContext.newPage(); operatorPage.setDefaultTimeout(20000);
        const operatorPanel = () => operatorPage.getByRole('region', {name: 'HubSpot context', exact: true});
        const operatorGet = async path => {
            const response = await operatorContext.request.get(runtime.origin + path);
            assert.equal(response.status(), 200); return response.json();
        };
        const ticketCrm = `${base}/conversations/${ticket.id}/crm`, contactCrm = `${base}/crm/hubspot/contacts/${contact.id}`;
        const operatorState = async state => {
            const requests = providerRequests, expected = await api(contactCrm);
            assert.equal(expected.state, state);
            assert.deepEqual(await operatorGet(contactCrm), expected);
            assert.deepEqual(await operatorGet(ticketCrm), expected);
            await operatorPanel().getByRole('button', {name: 'Check CRM status', exact: true}).click();
            await operatorPanel().getByText(new RegExp('^' + ({fresh: 'Fresh —', stale: 'Stale —', unmapped: 'Unmapped —', identity_mismatch: 'Identity mismatch —', disconnected: 'Disconnected —'})[state])).waitFor();
            assert.equal(await operatorPanel().getByRole('button', {name: /Refresh|Map|Remap|Remove|Connect|Disconnect/}).count(), 0);
            assert.equal(await operatorPanel().getByRole('link').count(), 0);
            assert.equal(await operatorPanel().getByLabel('HubSpot contact ID', {exact: true}).count(), 0);
            const asOf = operatorPanel().locator('.crm-facts > div').filter({has: operatorPage.getByText('As of', {exact: true})}).locator('dd');
            assert.equal(await asOf.innerText(), await operatorPage.evaluate(value => value ? new Date(value).toLocaleString() : 'Not yet', expected.refreshed_at));
            if (['identity_mismatch', 'disconnected', 'unmapped'].includes(state)) {
                assert.equal(expected.context, null);
                assert.equal(await operatorPanel().getByText('Priority response', {exact: true}).count(), 0);
            }
            assert.equal(providerRequests, requests, 'operator status checks use only the cached context');
        };
        const openOperatorTicket = async () => {
            await operatorPage.goto(runtime.origin + `/projects/${owner.projectId}/conversations/${ticket.id}`);
            const assistant = operatorPage.locator('#conversation-assistant');
            if (await assistant.getAttribute('aria-hidden') === 'true') await operatorPage.getByRole('button', {name: 'Show conversation panel', exact: true}).click();
            await operatorPage.getByRole('tab', {name: 'Ticket', exact: true}).click();
            const heading = operatorPage.locator('#ticket-section-customer-heading');
            if (await heading.getAttribute('aria-expanded') !== 'true') await heading.click();
            await operatorPanel().getByText(/^Fresh —/).waitFor();
        };
        const operatorCaptures = async (name, ticketPanel = false) => {
            for (const width of [1440, 390]) {
                await operatorPage.setViewportSize({width, height: 1000});
                if (ticketPanel) await openOperatorTicket();
                await operatorPanel().scrollIntoViewIfNeeded();
                await operatorPage.screenshot({path: `${directory}/operator-${name}-${width}.png`, fullPage: true});
            }
            await operatorPage.setViewportSize({width: 1440, height: 1000});
            if (ticketPanel) await openOperatorTicket();
            await operatorPage.addScriptTag({path: resolve('node_modules/axe-core/axe.min.js')});
            assert.deepEqual(await operatorPage.evaluate(async () => (await axe.run(document.querySelector('[aria-label="HubSpot context"]'))).violations.filter(item => ['serious', 'critical'].includes(item.impact)).map(item => item.id)), [], 'operator CRM accessibility');
            assert.ok(await operatorPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'operator screen fits');
        };
        await operatorPage.goto(customer); await operatorPanel().getByText(/^Fresh —/).waitFor(); await operatorState('fresh');
        assert.equal(await operatorPanel().getByText('12', {exact: true}).isVisible(), false, 'source IDs start undisclosed');
        await operatorPanel().getByText('HubSpot source identifiers', {exact: true}).click();
        assert.equal(await operatorPanel().getByText('12', {exact: true}).isVisible(), true);
        assert.equal(await operatorPanel().getByText('51', {exact: true}).count(), 1);
        assert.equal(await operatorPanel().getByText('52', {exact: true}).count(), 1);
        await operatorCaptures('customer-fresh');
        await openOperatorTicket(); await operatorState('fresh'); await operatorCaptures('ticket-fresh', true);
        const draft = operatorPage.getByRole('textbox', {name: 'Reply to conversation', exact: true});
        await draft.fill('I am checking the cached support entitlement.');
        const checked = operatorPage.waitForResponse(response => response.url().endsWith(ticketCrm) && response.request().method() === 'GET');
        const requestsBeforeFocus = providerRequests;
        await operatorPage.evaluate(() => window.dispatchEvent(new Event('focus'))); await checked;
        assert.equal(await draft.inputValue(), 'I am checking the cached support entitlement.', 'background CRM checks preserve an open reply draft');
        assert.equal(providerRequests, requestsBeforeFocus);
        await operatorPage.goto(customer); await operatorPanel().getByText(/^Fresh —/).waitFor();
        await runtime.execute(`UPDATE crm_mappings SET refreshed_at=${Date.now()-600000} WHERE project_id='${owner.projectId}' AND contact_id='${contact.id}'`);
        await operatorState('stale'); assert.equal(await operatorPanel().getByText('Priority response', {exact: true}).count(), 2);
        provider.email = 'different@example.test'; await api(contactCrm + '/refresh', {}); await operatorState('identity_mismatch');
        provider.email = 'maya@example.test'; await api(contactCrm + '/refresh', {});
        await runtime.execute(`UPDATE crm_connections SET token_cipher=NULL WHERE project_id='${owner.projectId}'`);
        await operatorState('disconnected');
        await api(base + '/crm/hubspot', {token: 'synthetic-hubspot-browser-token', account_id: '123', properties: {plan: 'support_plan', entitlement: 'support_entitlement'}}, 'PUT');
        await operatorState('unmapped');
        const requestsBeforeRefusals = providerRequests;
        for (const [path, method, data] of [[contactCrm + '/refresh', 'POST', {}], [ticketCrm + '/refresh', 'POST', {}], [contactCrm, 'PUT', {source_contact_id: '11'}], [contactCrm, 'DELETE'], [base + '/crm/hubspot', 'PUT', {}], [base + '/crm/hubspot', 'DELETE']]) {
            const response = await operatorContext.request.fetch(runtime.origin + path, {method, ...(data === undefined ? {} : {data})});
            assert.equal(response.status(), 403);
        }
        await runtime.execute(`UPDATE project_roles SET ticket_scope_json='{"groupIds":[],"includeUngrouped":false}' WHERE project_id='${owner.projectId}' AND id='${roleId}'`);
        for (const path of [contactCrm, ticketCrm]) assert.equal((await operatorContext.request.get(runtime.origin + path)).status(), 404);
        await operatorPanel().getByRole('button', {name: 'Check CRM status', exact: true}).click();
        await operatorPanel().getByRole('alert').waitFor();
        assert.equal(await operatorPanel().getByText('Priority response', {exact: true}).count(), 0);
        await api(`${base}/roles/${roleId}`, {...role, permissions: []}, 'PUT');
        for (const path of [contactCrm, ticketCrm]) assert.equal((await operatorContext.request.get(runtime.origin + path)).status(), 403);
        assert.equal(providerRequests, requestsBeforeRefusals);
        console.log('PROBE CRM-001 3: built operator ticket/customer panels -> read-only fresh/stale/mismatch/disconnected/unmapped; localized As of, source disclosure, draft retention, six writes 403 and scoped denial; captures 1440/390');
        await operatorContext.close(); operatorContext = null;
        // Restore the owner's existing mapping for the retained revocation/unmap proof below.
        await api(contactCrm, {source_contact_id: '12', company_id: company.id, source_company_id: '21'}, 'PUT');
        await openCustomer(); await refresh(); await fresh();
        // Revoke native authority while a remapping form is open; cached source IDs must disappear too.
        await panel().getByRole('button', {name: 'Remap customer', exact: true}).click();
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).inputValue(), '12');
        await runtime.execute(`UPDATE memberships SET role='operator' WHERE project_id='${owner.projectId}' AND user_id='${owner.userId}'; UPDATE sessions SET role='operator' WHERE actor_id='${owner.userId}'; INSERT INTO member_roles(project_id,user_id,role_key,assigned_at) VALUES('${owner.projectId}','${owner.userId}','${deniedRoleId}',${Date.now()})`);
        await page.evaluate(() => window.dispatchEvent(new Event('focus'))); await panel().waitFor({state: 'detached'});
        assert.equal(await panel().getByLabel('HubSpot contact ID', {exact: true}).count(), 0);
        assert.equal(await panel().getByText('Priority response', {exact: true}).count(), 0); await page.screenshot({path: `${directory}/customer-denied-1440.png`, fullPage: true});
        await page.reload(); await page.getByRole('heading', {name: 'Maya Patel', exact: true}).waitFor();
        assert.equal(await panel().count(), 0, 'roles without inbox access have no permanent CRM permission notice');
        await openTicket(ticket.id, false);
        assert.equal(await panel().count(), 0);
        await page.goto(settings); await page.getByText('HubSpot requires a workspace owner or admin with customer management permission. Ask your owner for access.', {exact: true}).waitFor();
        await runtime.execute(`DELETE FROM member_roles WHERE project_id='${owner.projectId}' AND user_id='${owner.userId}'; UPDATE memberships SET role='owner' WHERE project_id='${owner.projectId}' AND user_id='${owner.userId}'; UPDATE sessions SET role='owner' WHERE actor_id='${owner.userId}'`);
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
        await page.goto(customer); await page.getByRole('heading', {name: 'Maya Patel', exact: true}).waitFor();
        assert.equal(await panel().count(), 0, 'disconnected workspaces have no CRM box');
        passed = true;
    } finally {
        await operatorContext?.close(); await context?.close(); await runtime?.close(passed); await new Promise(resolve => server.close(resolve));
    }
}
