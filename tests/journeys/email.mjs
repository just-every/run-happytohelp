import test from 'node:test'
import {completeMailOutcomes} from '../helpers/email/complete-mail-outcomes.mjs'
import {localMailJourney} from '../helpers/email/local-mail.mjs'
import {completeEmailJourney} from '../helpers/email/complete-email.mjs'
import {notificationOutcomesJourney} from '../helpers/notify/outcomes.mjs'
import {conversationActionsJourney} from '../helpers/inbox/conversation-actions.mjs'
import {legacyMailS3Journey} from '../helpers/email/legacy-mail-s3.mjs'

test('a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome',async()=>{
 await localMailJourney()
 await completeEmailJourney()
 await notificationOutcomesJourney()
 await completeMailOutcomes()
 await conversationActionsJourney()
})

test('mail that Amazon SES stores in S3 is read from its two prefixes and admitted by SES\'s own record of the recipient and sender, replayed mail is never authenticated, and nothing is read, written or sent without the reader\'s inputs',async()=>{
 await legacyMailS3Journey()
})
