import test from 'node:test'
import {journey} from '../connections/claims.mjs'

// Connections through the real API, settings and dispatcher doors (tests/connections holds each journey's scenarios).
import {voiceProofs,routingProof} from '../helpers/voice/journeys.mjs'
for(const key of ['credentials','api','erasure','delivery','uncertainty','slack']){const [name,run]=journey(key);test(name,async()=>{await run();await voiceProofs[key]?.()})}
test('connected telephone calls follow IVR and hours routing with explicit consent, private linked history, voicemail and failed-transfer follow-up',routingProof)

import {sharingJourney,updatesJourney,custodyJourney} from '../helpers/escalations/journeys.mjs'
test('engineering context is chosen per message and attachment across GitHub, Linear, Jira and Slack, with reciprocal many-to-many links and uncertain outcomes never replayed',sharingJourney)
test('signed engineering updates are monotonic and idempotent, wake owners and draft editable customer updates that require approval while recovery stays unconfirmed',updatesJourney)
test('engineering escalation permissions and contact erasure preserve other customers and expose external deletion work',custodyJourney)
