import {feedbackJourney} from '../helpers/feedback/journeys.mjs'
import test from 'node:test'
import {connectionsJourney} from '../connections/api.mjs'
import {connectionOutcomes} from '../connections/outcomes.mjs'
import {routingProof,erasureProof} from '../helpers/voice/journeys.mjs'

test('a connected product opens and appends one scoped support request, receives signed events and a safe team notification, then loses access on expiry, erasure and revocation without replaying uncertain delivery',async()=>{await connectionOutcomes();await connectionsJourney();await routingProof();await erasureProof()})

import {engineeringJourney} from '../helpers/escalations/journeys.mjs'
import {hubspotContextJourney} from '../helpers/hubspot-context.mjs'
test('a support case shares selected engineering evidence, receives signed updates, sends only an approved customer draft and retains honest recovery and erasure custody',async()=>{await engineeringJourney();await feedbackJourney()})
test('mapped HubSpot records refresh read-only customer context while current identity and grant authority fence every read',hubspotContextJourney)

import * as channels from '../helpers/support-channels/journeys.mjs'
test('support channels: credentials',()=>channels.credentials())
test('support channels: exchange',()=>channels.exchange())
test('support channels: slack',()=>channels.slack())
test('support channels: erasure',()=>channels.erasure())
test('support channels: uncertainty',()=>channels.uncertainty())
