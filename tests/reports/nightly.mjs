import test from 'node:test'
import {reportScaleJourney} from './scale.mjs'
import {teamReportsJourney,timerCustodyJourney} from './team-journey.mjs'

test('Reports streams every conversation above 10,000 while aggregates and summary stay complete',{timeout:180_000},reportScaleJourney)
test('historical team reports reconcile dimensions, timers, current authority and scheduled delivery',{timeout:180_000},teamReportsJourney)
test('running ticket timers retain their named owner and freeze when the member loses ticket access',{timeout:120_000},timerCustodyJourney)
