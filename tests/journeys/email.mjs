import test from 'node:test'
import {completeMailOutcomes} from '../helpers/email/complete-mail-outcomes.mjs'
import {localMailJourney} from '../helpers/email/local-mail.mjs'
import {completeEmailJourney} from '../helpers/email/complete-email.mjs'
import {notificationOutcomesJourney} from '../helpers/notify/outcomes.mjs'
import {conversationActionsJourney} from '../helpers/inbox/conversation-actions.mjs'

test('a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome',async()=>{
 await localMailJourney()
 await completeEmailJourney()
 await notificationOutcomesJourney()
 await completeMailOutcomes()
 await conversationActionsJourney()
})
