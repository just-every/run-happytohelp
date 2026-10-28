import test from 'node:test'
import {provisioningJourney} from '../helpers/first-run/provisioning.mjs'
import {localMail} from '../helpers/first-run/activation-mail.mjs'
import {siteReadJourney} from '../helpers/first-run/site-read.mjs'
import {visitorProfileJourney} from '../helpers/first-run/visitor-profile.mjs'
import {managedFirstRunJourney} from '../helpers/first-run/managed-mail.mjs'

test('workspace activation lifecycle: claim and provision, observe Setup, verify registration, answer within the daily ceiling and retain settings across provider changes',provisioningJourney)
test('local mail lifecycle: welcome, customer and teammate mail are suppressed without stored delivery or outbound sending',localMail)
test('Managed workspace lifecycle: bind one mailbox, retain its allocation through retry and rotation, receive support and retire it on deletion',managedFirstRunJourney)
test('website context lifecycle: creation reads one private bounded source, preserves owner edits and never repeats uncertain work',siteReadJourney)
test('visitor profile lifecycle: signed identity resumes canonically, collector details stay separate and erasure ends access',visitorProfileJourney)
