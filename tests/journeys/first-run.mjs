import test from 'node:test'
import {observationJourney} from '../helpers/first-run/activation-observation.mjs'
import {automaticJourney} from '../helpers/first-run/activation-automatic.mjs'
import {ownerMailJourney} from '../helpers/first-run/activation-mail.mjs'
import {provisioningJourney} from '../helpers/first-run/provisioning.mjs'
import {siteReadJourney} from '../helpers/first-run/site-read.mjs'
import {visitorProfileJourney} from '../helpers/first-run/visitor-profile.mjs'
import {setupAnswersJourney} from '../helpers/first-run/setup-answers.mjs'
import {managedFirstRunJourney} from '../helpers/first-run/managed-mail.mjs'

// A new installation and its first workspace: Setup's honest observations, provisioning, the website read, the
// visitor's saved profile and the installer's answers, on the real application.

test('Setup observes one workspace honestly: a pure GET, owner-only checks, receipts invalidated by change, test mail delivered only on provider status, inbound and widget only on real receipts',observationJourney)

test('Setup checks automatically without repeating fresh provider requests, places and counts steps by installation, skips durably without confirming, moves an untouched starter and validates only metadata',automaticJourney)

test('owner mail on Setup: suppressed locally, a welcome email or used sign-in link confirms only on delivery, uncertain mail is never resent, and the sender follows only a verified domain the owner did not override',ownerMailJourney)

// Managed provisioning exercises the same workspace lifecycle with an assigned
// mailbox: activation, stable allocation, conflict recovery and retirement.
test('a new workspace is provisioned with its starter and native or Managed mailbox, keeps allocation through changes and retires it on deletion, answers within the daily ceiling, reports known versus unknown spend, and an upgrade fabricates no Setup observation',async()=>{
 for(const journey of [provisioningJourney,managedFirstRunJourney])await journey()
})

test('the website is read once after creation into a private lexical source, within robots, origin and page limits, keeping the owner\'s edits, and never repeated after failure or uncertainty',siteReadJourney)

test('a visitor\'s saved profile is read under current authority only, and signed identity stays canonical while the collector keeps what the visitor provided apart',visitorProfileJourney)

test('the installer\'s answers: local mail suppressed, only given answers sent, a chosen AI key in its own secret, the inbound token generated once, saved providers never replaced',setupAnswersJourney)
