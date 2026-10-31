import test from 'node:test'
import {nativeAccountJourney} from '../helpers/identity/native-account.mjs'
import {twoFactorJourney} from '../helpers/identity/two-factor.mjs'
import {twoFactorOutcomesJourney} from '../helpers/identity/two-factor-outcomes.mjs'
import {emailStepUpJourney} from '../helpers/identity/email-step-up.mjs'
import {rolesAuditJourney} from '../helpers/identity/roles-audit.mjs'

test('the first owner claims once, signs in, invites and recovers a teammate, admits signed visitors and retains account identity after workspace deletion',nativeAccountJourney)
test('an owner enrolls factors, enforces teammate enrollment, steps up to export and recovers lost factors with audited single-use authority',async()=>{await twoFactorJourney();await twoFactorOutcomesJourney()})
test('a mailbox-only owner proves the account email, exports through the fresh session and installs a password without empowering a held session',emailStepUpJourney)
test('custom roles restrict native and delegated knowledge and ticket actions, and security retention and legal holds preserve accountable history',rolesAuditJourney)

import {assuranceJourney} from '../helpers/assurance/journeys.mjs'
test('an owner records regulated qualification, retains ordinary support access and erasure, and cannot activate health-data processing without independent review',assuranceJourney)
