import {voiceBrowserProof} from '../helpers/voice/browser.mjs'
import test from 'node:test'
import {brandsBrowser} from '../helpers/inbox/brands-browser.mjs'
import {collaborationBrowser} from '../helpers/inbox/desk-collaboration.mjs'
import {mobileInbox} from '../helpers/inbox/mobile-inbox-browser.mjs'

test('two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening',async()=>{await brandsBrowser();await voiceBrowserProof()})

test('at 390px an operator opens a customer request, replies, returns to the inbox and navigates to Contacts without horizontal scrolling',mobileInbox)

test('two signed-in operators see viewing, typing and unsent draft warnings before replying and after reload',collaborationBrowser)

import {outcomesJourney} from '../helpers/widget/outcomes.mjs'

test('installed widget availability, provider-edge answers and consent-aware proactive outcomes',outcomesJourney)
