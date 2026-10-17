import test from 'node:test'
import {workerJourney,automaticJourney,notificationsJourney,peopleJourney,replayJourney} from '../helpers/email/worker-mail.mjs'
import {sendgridInboundJourney} from '../helpers/email/sendgrid-inbound.mjs'
import {recoveryJourney,classificationRecoveryJourney} from '../helpers/email/recovery.mjs'
import {customerMailJourney} from '../helpers/email/customer-mail.mjs'
import {transportsJourney} from '../helpers/email/transports.mjs'
import {senderDomainJourney} from '../helpers/email/domain.mjs'
import {completeEmailJourney} from '../helpers/email/complete-email.mjs'

// Email on the real application: inbound through the Worker's email entry, the JSON gateway and SendGrid
// Inbound Parse; outbound through the conversation, schedule and operator routes. Fixtures only at the
// mail provider and DNS.

test('mail through the Worker\'s email entry stores attachments, continues its thread by reply address, coalesces duplicates, sanitises HTML, and admits a delivery that crashed mid-admission exactly once',workerJourney)

test('automatic mail through the Worker and gateway is admitted and labelled with its reasons but never answered, notified or emailed onward, while customer mail still earns a reply and an operator alert',automaticJourney)

test('operators get one unread digest after inactivity that honours read frontiers and opt-in scope, a lost provider response is never resent, and assignment mail follows the real mutation and preferences',notificationsJourney)

test('mail speaks only for whom it may: CC participants of verified senders, operators by membership, preferred addresses through their reply address, Cloudflare\'s own verdict, the latest open thread, and replies only to the address that wrote',peopleJourney)

test('the schedule\'s replay of an emailed customer message reaches the reply command its delivery recorded, failed or queued, without a second command',replayJourney)

test('SendGrid Inbound Parse authenticates its token, stores attachment bytes, keys Message-IDs per mailbox, trusts the header From over VERP and SRS envelopes, suspends unverified senders and delivers to every mailbox',sendgridInboundJourney)

test('inbound mail survives D1 failures before and after admission with stable staged attachments, never admits a changed copy, and only an owner releases an interrupted receipt, exactly once',recoveryJourney)

test('classification survives recovery: lost completion, failed claims and receipts from before classification keep automatic mail quiet on replay while customer mail still notifies',classificationRecoveryJourney)

test('replies reach the conversation\'s customers by email with safe rendering, inline images and files, the preferred address and participants only, a frozen recipient snapshot, no resend after a lost response, and links for oversized or missing files',customerMailJourney)

test('SendGrid, Resend and Cloudflare each carry the reply with its files and a working reply address, settle acceptance, refusal, bounce or a lost response once, and never submit twice while a send is pending',transportsJourney)

test('the sender-domain check names missing SPF, DKIM and DMARC records, keeps resolver errors unknown and is scoped to the workspace\'s members',senderDomainJourney)

import {notificationTriggersJourney} from '../helpers/r4/notifications.mjs'
test('editable requester triggers send received and solved once, suppress historical and machine mail, and teammate notices follow current authority and preferences',notificationTriggersJourney)
test('operators start email and call tickets, header and imported vendor replies preserve identity, suspicious mail stays in Suspended for safe audited recovery or expiry, and erasure removes its new stores',completeEmailJourney)
