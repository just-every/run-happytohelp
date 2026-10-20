import test from 'node:test'
import {apiVendorJourney} from '../move-in/api-journey.mjs'
import {journey} from '../move-in/claims.mjs'

// Move in through its real upload, review, apply, resume, undo and erasure doors (tests/move-in holds each journey's scenarios).
test(...journey('refusals'))
test(...journey('review'))
const [landingName,landing]=journey('landing')
test(landingName,async()=>{await landing();await apiVendorJourney('zendesk');await apiVendorJourney('intercom')})
