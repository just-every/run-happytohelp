import {deskCollaborationBrowser} from '../helpers/inbox/desk-collaboration.mjs'
import {voiceBrowserProof} from '../helpers/voice/browser.mjs'
import test from 'node:test'
import {brandsBrowser} from '../helpers/inbox/brands-browser.mjs'
import {mobileInbox} from '../helpers/inbox/mobile-inbox-browser.mjs'

test('two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening',async()=>{await brandsBrowser();await deskCollaborationBrowser();await voiceBrowserProof()})

test('at 390px an operator opens a customer request, replies, returns to the inbox and navigates to Contacts without horizontal scrolling',mobileInbox)
