import test from 'node:test'
import {contextLifecycle} from '../helpers/context/lifecycle.mjs'
import {leadsJourney} from '../helpers/context/leads.mjs'

test('customer context lifecycle: consented evidence grounds profiles and bounded proactive offers; invalid, revoked and uncertain work never replaces known context',contextLifecycle)
test('lead lifecycle: process the lead website once, review a grounded draft and send it without replaying uncertain paid work',leadsJourney)
