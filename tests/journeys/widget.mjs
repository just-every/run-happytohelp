import test from 'node:test'
import {outcomesJourney} from '../helpers/widget/outcomes.mjs'
import {socketJourney} from '../helpers/widget/socket.mjs'

test('visitor and teammate sockets replay their durable cursor, exchange first reads and private activity only within current authority, and close on revocation',async()=>{await socketJourney();await outcomesJourney()})
