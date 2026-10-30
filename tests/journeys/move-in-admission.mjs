import test from 'node:test'
import {outcomesJourney} from '../move-in/outcomes.mjs'
import {reviewImportJourney} from '../move-in/review-import.mjs'

test('review an export, import its history and private notes, repeat and repackage without effects, then undo exactly',{timeout:180_000},async()=>{await reviewImportJourney();await outcomesJourney()})
