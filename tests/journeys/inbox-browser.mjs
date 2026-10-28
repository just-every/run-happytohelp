import test from 'node:test'
import {ticketsBrowser} from '../helpers/inbox/tickets-browser.mjs'
test('a support lead configures a populated queue, edits and bulk-routes tickets, previews and publishes a workflow, then approves measured triage and corrects its evidence',{timeout:240_000},()=>ticketsBrowser())
