import test from 'node:test'
import {largeUndoJourney,partialUndoJourney} from '../move-in/large-undo.mjs'

// Targeted scale qualification outside push Verify; the same undo flow includes
// a real Worker stop and a stopped apply with unstarted reviewed children.
test('a 1,000-customer Zendesk import repeats exactly, undoes responsively across restart and reverses only committed partial work',{timeout:300_000},async()=>{
 await largeUndoJourney()
 await partialUndoJourney()
})
