import test from 'node:test'
import {ticketsJourney} from '../helpers/inbox/tickets.mjs'
import {brandsJourney} from '../helpers/inbox/brands.mjs'

test('a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure',ticketsJourney)
test('two brands share a permitted team while customer identity, knowledge, routing, sender policy and reports retain their current brand authority',brandsJourney)

import {problemJourney} from '../helpers/inbox/problems.mjs'
test('a support lead links affected requests to one problem, follows its engineering issue and sends scoped recovery updates once while preferences, provider uncertainty and erasure remain honest',problemJourney)
