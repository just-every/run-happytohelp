import test from 'node:test'
import {vendorRepliesJourney} from '../move-in/vendor-replies.mjs'
import {reviewImportJourney} from '../move-in/review-import.mjs'

test('review an export, import its history and private notes, repeat and repackage without effects, then undo exactly',{timeout:360_000},async()=>{await reviewImportJourney();await vendorRepliesJourney()})
