import {feedbackJourney} from '../helpers/feedback/journeys.mjs'
import test from 'node:test'
import {connectionsJourney} from '../connections/api.mjs'

test('a connected product opens and appends one scoped support request, receives signed events and a safe team notification, then loses access on expiry, erasure and revocation without replaying uncertain delivery',connectionsJourney)

import {engineeringJourney} from '../helpers/escalations/journeys.mjs'
import {hubspotContextJourney} from '../helpers/hubspot-context.mjs'
test('a support case shares selected engineering evidence, receives signed updates, sends only an approved customer draft and retains honest recovery and erasure custody',async()=>{await engineeringJourney();await feedbackJourney()})
test('mapped HubSpot records refresh read-only customer context while current identity and grant authority fence every read',hubspotContextJourney)
