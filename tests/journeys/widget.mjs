import test from 'node:test'
import {socketJourney, visitorReadJourney} from '../helpers/widget/socket.mjs'

test('visitor and teammate sockets replay their durable cursor, exchange first reads and private activity only within current authority, and close on revocation',socketJourney)
test('a visitor can acknowledge a delivered reply repeatedly and concurrently after catching up on message history',visitorReadJourney)
