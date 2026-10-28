import test from 'node:test'
import {completeEmailJourney} from '../helpers/email/complete-email.mjs'

test('a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome',completeEmailJourney)
