import test from 'node:test'
import {journey} from '../move-in/claims.mjs'
import {apiVendorJourney} from '../move-in/api-journey.mjs'

// Move in through its real upload, review, apply, resume, undo and erasure doors (tests/move-in holds each journey's scenarios).
test(...journey('erasure'))
test(...journey('upgrade'))
const [scoutName,scout]=journey('helpscout')
test(scoutName,async()=>{await scout();await apiVendorJourney('helpscout')})
