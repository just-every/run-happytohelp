import test from 'node:test'
import {triageJourney} from '../helpers/ai/triage.mjs'
import {assistanceJourney} from '../helpers/ai/assistance.mjs'
import {trainingJourney} from '../helpers/ai/training.mjs'

test('a support workspace classifies, routes and answers customer turns with published evidence, measured usage and terminal budget or uncertain outcomes',triageJourney)
test('an operator requests grounded suggestions, edits and sends one, then hands the waiting customer back to the configured assistant',assistanceJourney)
test('a lead seeds local synthetic cases, evaluates and qualifies a procedure, cancels queued work and recovers uncertain evaluations without replay',trainingJourney)
