import test from 'node:test'
import {journey} from '../move-in/claims.mjs'
import {apiVendorJourney} from '../move-in/api-journey.mjs'

// Move in through its real upload, review, apply, resume, undo and erasure doors (tests/move-in holds each journey's scenarios).
test(...journey('publication'))
const [recoveryName,recovery]=journey('recovery')
test(recoveryName,async()=>{await recovery();await apiVendorJourney('freshdesk')})
test(...journey('authority'))
