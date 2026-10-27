import {triageJourney} from '../helpers/ai/triage.mjs'
import test from 'node:test'
import {answersJourney} from '../helpers/ai/answers.mjs'
import {lifecycleJourney} from '../helpers/ai/lifecycle.mjs'
import {assistanceJourney} from '../helpers/ai/assistance.mjs'
import {providersJourney} from '../helpers/ai/providers.mjs'
import {requestLimits,projectCeilings,invalidLimits,aiCeilings,requestIds,usageSummary} from '../helpers/ai/limits.mjs'

// The assistant on the real application: visitor messages and operator actions through their routes,
// generations through the queue, and fixtures only at the model and mail providers.

test('the visitor\'s assistant searches published knowledge and answers with exact citations, live and on replay; citations it was never issued, unpublished or changed sources admit nothing, and asking for a person hands over',answersJourney)

test('each visitor turn is answered once and only if nothing it depends on changed; cancelled, interrupted or post-commit-failed attempts never replay the provider, and a missing key is visible without losing the message; triage labels gate confident intent routing, existing rules still route at admission when the model is down or unsure, and an operator\'s queue choice is kept',async()=>{await lifecycleJourney();await triageJourney()})

test('operator suggestions and draft tools run once per request and never send, fail whole when alternatives fail, and handing a waiting conversation back answers its turn once within ceilings and current authority',assistanceJourney)

test('the assistant answers through every supported provider protocol with usage recorded, and a refused paid attempt is never replayed',providersJourney)

test('public request limits answer 429 with Retry-After per project, address, contact and conversation, store nothing for a refusal, return refused capacity, and fail visibly when misconfigured',async()=>{await requestLimits();await projectCeilings();await invalidLimits()})

test('daily AI reply and spend ceilings skip replies visibly to operators only, keep the visitor\'s message and never replay; reply request ids are UUIDs; usage summaries keep unmeasured costs unknown',async()=>{await aiCeilings();await requestIds();await usageSummary()})

test('training runs seed a confirmed synthetic workspace, check every reply, execute each evaluation family, and keep unreported, failed, expired or interrupted paid work uncertain rather than replaying it',async()=>(await import('../helpers/ai/training.mjs')).trainingJourney())

test('repositories selected for operators are read as redacted, attributed evidence that suggestions cite, while secrets files, other repositories and visitor replies get nothing',async()=>(await import('../helpers/ai/repository.mjs')).repositoryJourney())

test('human-reviewed follow-ups retain cited promises across handoffs and restart, refuse stale authority and versions, chase unconfirmed dependencies once, draft without sending and erase with the customer',async()=>(await import('../helpers/ai/obligations.mjs')).obligationsJourney())

test('follow-up custody survives additive upgrade and a native archive restore with accepted history intact, no live session, no outbound draft and one internal reminder',async()=>(await import('../helpers/recovery/followup.mjs')).followupRecoveryJourney())
