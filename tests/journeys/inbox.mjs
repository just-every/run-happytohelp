import test from 'node:test'
import {ticketsJourney} from '../helpers/inbox/tickets.mjs'
import {managementJourney} from '../helpers/inbox/management.mjs'
import {conversationActionsJourney} from '../helpers/r4/conversation-actions.mjs'
import {brandsJourney} from '../helpers/inbox/brands.mjs'
import {problemJourney} from '../helpers/inbox/problems.mjs'

// The operator's workspace on the real application's routes; fixtures only at the mail provider, DNS and crawler.

test('workspace management keeps settings, resources, bootstrap, owners, notes, participants, transcript mail, widget origins, presence and mailbox ownership within each workspace\'s current authority',managementJourney)
test('a support queue carries typed tickets through customer replies, saved views, bulk changes, reviewed macros, private collaboration, search, API edits, service commitments, routing, scheduled replies, Slack escalation and one customer erasure',ticketsJourney)

test('duplicate tickets merge into a surviving operator thread with safe undo and private partner replies through the real mail gateways',conversationActionsJourney)

test('two brands deliberately share a team while domains, senders, signatures, customer identities, private knowledge, routing and policy stay isolated, reports aggregate only permitted brands and revocation ends access',brandsJourney)

test('an engineering outage links independent customer incidents through reviewed triage, per-ticket delivery outcomes, service commitments, private surveys and erasure',problemJourney)
