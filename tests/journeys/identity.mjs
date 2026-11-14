import {rehearsalLifecycleJourney} from '../helpers/rehearsal/lifecycle.mjs'
import test from 'node:test'
import {nativeAccountJourney} from '../helpers/identity/native-account.mjs'
import {retainedNativeIdentityJourney} from '../helpers/identity/retained-native.mjs'
import {scopedAuthorityJourney} from '../helpers/identity/scoped-authority.mjs'
import {twoFactorJourney} from '../helpers/identity/two-factor.mjs'
import {twoFactorOutcomesJourney} from '../helpers/identity/two-factor-outcomes.mjs'
import {emailStepUpJourney} from '../helpers/identity/email-step-up.mjs'
import {rolesAuditJourney} from '../helpers/identity/roles-audit.mjs'
import {mailOffJourney} from '../helpers/identity/mail-off.mjs'
import {upgradeFenceJourney} from '../helpers/identity/upgrade-fence.mjs'

test('the first owner claims once, signs in, invites and recovers a teammate, admits signed visitors and retains account identity after workspace deletion',async()=>{await nativeAccountJourney();await retainedNativeIdentityJourney();await scopedAuthorityJourney()})
test('an owner enrolls factors, enforces teammate enrollment, steps up to export and recovers lost factors with audited single-use authority',async()=>{await twoFactorJourney();await twoFactorOutcomesJourney()})
test('a mailbox-only owner proves the account email, exports through the fresh session and installs a password without empowering a held session',emailStepUpJourney)
test('custom roles restrict native and delegated knowledge and ticket actions, and security retention and legal holds preserve accountable history',rolesAuditJourney)

test('an installation with outbound email off refuses every sign-in mail in words, contacts no provider, and admits an owner through a deploy-credential grant once',async()=>{await mailOffJourney();await rehearsalLifecycleJourney()})
test('while a knowledge upgrade is pending, setup, sign-in options and the emailed sign-in link answer normally and knowledge stays closed to anyone without a member session',upgradeFenceJourney)

import {assuranceJourney} from '../helpers/assurance/journeys.mjs'
test('an owner records regulated qualification, retains ordinary support access and erasure, and cannot activate health-data processing without independent review',assuranceJourney)

import {recoveryRaceAndLimits} from '../helpers/identity/recovery-authority/races.mjs'
import {managedRecoveryJourney,custodyRecoveryJourney} from '../helpers/identity/recovery-authority/managed.mjs'
import {sharedRecoveryJourney} from '../helpers/identity/recovery-authority/shared.mjs'
test('the setup owner recovers through a scoped Managed handoff only after proving a replacement factor, with old authority revoked',managedRecoveryJourney)
test('recovery custody binds and revokes monotonic generations while sentinel and conflicting owner anchors refuse',async()=>{await custodyRecoveryJourney();await recoveryRaceAndLimits()})
test('a shared account needs every affected workspace owner’s current factor-backed consent and keeps its memberships',sharedRecoveryJourney)
