import test from 'node:test'
import {nativeIdentityJourney} from '../helpers/identity/native.mjs'
import {twoFactorJourney} from '../helpers/identity/two-factor.mjs'
import {rolesAuditJourney} from '../helpers/identity/roles-audit.mjs'
import {emailStepUpJourney} from '../helpers/identity/email-step-up.mjs'

test('native identity lifecycle: claim one owner, recover credentials, invite and reset a teammate, switch workspaces and retire authority',nativeIdentityJourney)
test('second-factor lifecycle: enroll, sign in, recover, step up and revoke with bounded audited attempts',twoFactorJourney)
test('role lifecycle: collaborate within assigned permissions, revoke selected knowledge and retain an accountable security log',rolesAuditJourney)
test('mailbox proof lifecycle: a passwordless account proves only its own mailbox before installing credentials',emailStepUpJourney)
