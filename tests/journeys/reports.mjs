import test from 'node:test'
import {calendarReportsJourney} from '../reports/figures.mjs'
import {supportOutcomesJourney,publicCohort} from '../reports/support-outcomes.mjs'

test('inspect calendar Reports and formula-safe exports against known durations, rates and exclusions, then revoke private export access',{timeout:180_000},calendarReportsJourney)
test('resolve and reopen multichannel support with visible answer attribution, visitor feedback and permission-scoped team reports',{timeout:180_000},async()=>{await supportOutcomesJourney();await publicCohort()})
