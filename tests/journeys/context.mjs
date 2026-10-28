import test from 'node:test'
import {monitoringJourney} from '../helpers/context/monitoring.mjs'

test('a consenting customer receives attributable proactive help and a current profile; replay is free, dismissal stops help and consent withdrawal fences publication',monitoringJourney)

import {leadsJourney} from '../helpers/context/leads.mjs'
test('a platform lead draft is grounded in its own website, reviewed before sending and never replayed after an uncertain attempt',leadsJourney)
