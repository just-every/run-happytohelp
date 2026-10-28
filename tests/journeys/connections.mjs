import {feedbackJourney} from '../helpers/feedback/journeys.mjs'
import test from 'node:test'
import {journey} from '../connections/claims.mjs'

// Connections through the real API, settings and dispatcher doors (tests/connections holds each journey's scenarios).
import {credentialsProof,signedDeliveryProof,routingProof,uncertaintyProof,erasureProof} from '../helpers/voice/journeys.mjs'
const voiceSteps={credentials:[credentialsProof],api:[erasureProof],delivery:[signedDeliveryProof,routingProof,uncertaintyProof]}
for(const key of ['credentials','api','delivery','slack']){const [name,run]=journey(key);test(name,async()=>{await run();for(const proof of voiceSteps[key]||[])await proof()})}

import {sharingJourney,updatesJourney,custodyJourney} from '../helpers/escalations/journeys.mjs'
test('engineering context is chosen per message and attachment across GitHub, Linear, Jira, Slack and Teams, with reciprocal links, concurrent claims, revoked installation authority and uncertain outcomes never replayed',sharingJourney)
test('signed engineering updates are monotonic and idempotent, wake owners and draft editable customer updates that require approval while recovery stays unconfirmed',async()=>{await updatesJourney();await feedbackJourney()})
test('engineering escalation permissions and contact erasure preserve other customers and expose external deletion work',custodyJourney)

import {hubspotContextJourney} from '../helpers/hubspot-context.mjs'
test('read-only HubSpot context uses explicit customer mappings, refreshes changed source fields and refuses stale authority, identity conflicts and unavailable grants without customer access',hubspotContextJourney)
