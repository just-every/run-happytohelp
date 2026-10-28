import test from 'node:test';
import {apiJourney} from '../connections/api.mjs';
import {deliveryJourney} from '../connections/delivery.mjs';
import {escalationJourney} from '../helpers/escalations/journeys.mjs';
import {hubspotContextJourney} from '../helpers/hubspot-context.mjs';
test('scoped credentials create, append, replay and read native resources through rotation, erasure and revocation',apiJourney);
test('signed notifications and Slack delivery survive restart, bound transport and require approval for uncertain resend',deliveryJourney);
test('selected engineering context follows signed updates to approved customer replies and provider-aware erasure',escalationJourney);
test('read-only HubSpot context refreshes explicit mappings and refuses stale authority or unavailable grants',hubspotContextJourney);
