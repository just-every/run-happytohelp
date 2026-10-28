import test from 'node:test';
import {hubspotBrowser} from '../helpers/hubspot/browser.mjs';
import {launchBrowser, evidence} from './kit/browser.mjs';

test('an owner connects read-only HubSpot, maps a customer and company, refreshes actual ticket context, handles conflicts and revoked authority, then disconnects', {timeout: 240_000}, async () => {
    const shot = await evidence('connections');
    const browser = await launchBrowser();
    try {
        await hubspotBrowser({browser, directory: shot('hubspot')});
    } finally {
        await browser.close();
    }
});
