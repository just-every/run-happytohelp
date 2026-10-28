import test from 'node:test'
import {widgetConversationJourney} from '../helpers/widget/conversation.mjs'
import {presenceJourney} from '../helpers/widget/presence.mjs'

test('a visitor chooses proactive help, continues the same ticket through scoped commands, live replies and reads, socket catch-up and uncertain transport recovery, then loses access on revocation',widgetConversationJourney)

test('workspace availability follows live teammate authority, idle and close bounds, visitor away replies, assistant readiness and calendar closures',presenceJourney)
