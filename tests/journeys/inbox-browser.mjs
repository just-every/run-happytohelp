import {voiceBrowserProof} from '../helpers/voice/browser.mjs'
import {customerScreenOutcomes} from '../helpers/customer-outcomes-edges.mjs'
import test from 'node:test'
import {brandsBrowser} from '../helpers/inbox/brands-browser.mjs'
import {mobileInbox} from '../helpers/inbox/mobile-inbox-browser.mjs'

test('two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening',async()=>{await brandsBrowser();await voiceBrowserProof()})

test('an operator replies from the phone inbox, opens a company customer and reviews and reverses a labelled identity link without changing customer authority',async()=>{await mobileInbox();await customerScreenOutcomes()})
