import {feedbackHandoffJourney,feedbackCaptureJourney,feedbackReleaseJourney,feedbackCustodyJourney} from '../helpers/feedback/journeys.mjs'
import test from 'node:test'
import {journey} from '../connections/claims.mjs'

// Connections through the real API, settings and dispatcher doors (tests/connections holds each journey's scenarios).
for(const key of ['credentials','api','erasure','delivery','uncertainty','slack'])test(...journey(key))

import {sharingJourney,updatesJourney,custodyJourney} from '../helpers/escalations/journeys.mjs'
test('engineering context is chosen per message and attachment across GitHub, Linear, Jira and Slack, with reciprocal many-to-many links and uncertain outcomes never replayed',async()=>{await sharingJourney();await feedbackCaptureJourney();await feedbackHandoffJourney()})
test('signed engineering updates are monotonic and idempotent, wake owners and draft editable customer updates that require approval while recovery stays unconfirmed',async()=>{await updatesJourney();await feedbackReleaseJourney()})
test('engineering escalation permissions and contact erasure preserve other customers and expose external deletion work',async()=>{await custodyJourney();await feedbackCustodyJourney()})
