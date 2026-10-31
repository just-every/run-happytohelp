import {activationJourney} from '../helpers/first-run/activation.mjs'
import {firstRunOutcomes} from '../helpers/first-run/outcomes.mjs'
import test from 'node:test'
import {provisioningJourney} from '../helpers/first-run/provisioning.mjs'

test('a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest',async()=>{await provisioningJourney();await firstRunOutcomes();await activationJourney()})

import {siteReadJourney} from '../helpers/first-run/site-read.mjs'
test('a new owner imports their website as private searchable knowledge once, keeps their own edits and deletes the source without later jobs bringing it back',siteReadJourney)
