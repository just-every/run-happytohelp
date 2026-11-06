import test from 'node:test'
import {answersJourney} from '../helpers/ai/answers.mjs'
import {configuredExecutionJourney} from '../helpers/ai/configured-execution.mjs'
import {triageJourney} from '../helpers/ai/triage.mjs'
import {trainingJourney} from '../helpers/ai/training.mjs'

test('a visitor gets a source-linked answer from published knowledge, durable replay and a human handoff under current authority',async()=>{await answersJourney();await configuredExecutionJourney()})
test('reviewed intent labels enable routing while unavailable triage preserves the operator queue and ordinary admission rules',triageJourney)
test('a confirmed synthetic evaluation records checked replies, paid usage and durable uncertain work without replay',trainingJourney)

import {proceduresJourney} from '../helpers/ai/procedures.mjs'
test('a lead versions a synthetic-only procedure, inspects its bounded simulations and refuses a failed or mismatched release',proceduresJourney)

import {obligationsJourney} from '../helpers/ai/obligations.mjs'
import {proceduresJourney as adviceProceduresJourney} from '../helpers/ai/advice-procedures.mjs'
test('a quoted follow-up retains accepted responsibility through handoffs, restart, reminders and human-reviewed completion without sending',obligationsJourney)
test('an exact evaluated advice version governs bounded cohorts, retained outcomes, corrections, revocation and regression stopping',adviceProceduresJourney)
