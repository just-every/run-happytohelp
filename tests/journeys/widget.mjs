import test from 'node:test'
import {widgetEventsJourney} from '../helpers/widget/events.mjs'
import {socketJourney} from '../helpers/widget/socket.mjs'
import {lostResponseJourney} from '../helpers/widget/lost-response.mjs'
import {presenceJourney} from '../helpers/widget/presence.mjs'

// The widget's server doors on the real application: widget events, conversation sockets, and the widget's own
// transport against the application with the network between them faulted.

test('widget commands are scoped to the visitor\'s own conversation and workspace, replay an insight pair exactly, record reads and observed presence, recheck live authority each time, gate monitoring on consent and resume one waiting turn',widgetEventsJourney)

test('conversation sockets admit only the right token, origin and membership, replay durably without operator-only data, stream project activity to operators, keep private notes from visitors, deliver first reads live, post an away team\'s reply once and close on revocation',socketJourney)

test('the widget transport retries a response lost after commit with the same command and frontier, refreshes after a definitive refusal, and surfaces a rate limit without replaying the command',lostResponseJourney)

test('workspace presence: an agent with the dashboard open and in use keeps the widget available; nobody online, idle past the lead\'s idle time, a closed or revoked dashboard and a removed member are away within their bounds and collaborators never count; the away message is posted once, outside hours is unchanged, only owners and admins change the audited setting, and an answering assistant keeps the team available',presenceJourney)
