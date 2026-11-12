import test from 'node:test'
import {legacyCustodyJourney} from '../helpers/legacy-custody/journey.mjs'
import {custodyJourney} from '../move-in/custody-journey.mjs'

test('an admin reviews conflicts, loses and regains authority, resumes after a Worker stop and keeps later native work when undo refuses',{timeout:180_000},async()=>{await custodyJourney();await legacyCustodyJourney()})
