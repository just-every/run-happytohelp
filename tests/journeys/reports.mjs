import {teamReportsJourney} from '../reports/team-journey.mjs'
import test from 'node:test'
import {journey} from '../reports/claims.mjs'

// Reports through their real doors (tests/reports holds each journey's scenarios).
for(const key of ['figures','outcomes','ratings'])key==='figures'?test(journey(key)[0],async()=>{await journey(key)[1]();await teamReportsJourney()}):test(...journey(key))
