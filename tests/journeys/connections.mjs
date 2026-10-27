import test from 'node:test'
import {journey} from '../connections/claims.mjs'

// Connections through the real API, settings and dispatcher doors (tests/connections holds each journey's scenarios).
for(const key of ['credentials','api','delivery','slack'])test(...journey(key))

import {sharingJourney,updatesJourney,custodyJourney} from '../helpers/escalations/journeys.mjs'
test('engineering context is chosen per message and attachment across GitHub, Linear, Jira and Slack, with reciprocal many-to-many links and uncertain outcomes never replayed',sharingJourney)
test('signed engineering updates are monotonic and idempotent, wake owners and draft editable customer updates that require approval while recovery stays unconfirmed',updatesJourney)
test('engineering escalation permissions and contact erasure preserve other customers and expose external deletion work',custodyJourney)
