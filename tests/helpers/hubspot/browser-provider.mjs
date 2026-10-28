import assert from 'node:assert/strict';
import {createServer} from 'node:http';

// Only the paid/network edge is substituted; settings, customer and ticket requests reach the emitted Worker.
export async function startHubSpotProvider() {
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
    return {provider, target: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve))};
}
