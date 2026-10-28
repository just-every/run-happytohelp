import test from 'node:test'
import {custodyJourney} from '../move-in/custody-journey.mjs'

test('an admin reviews conflicts, loses and regains authority, resumes after a Worker stop and keeps later native work when undo refuses',{timeout:180_000},custodyJourney)
