# OUTBOUND-001-NOTE builder report

Repository: just-every/run-happytohelp
Branch: cloud/hh-outbound001-email-note-n1
Starting base: 9c123887be64e57e612ae5da22a49447d284e81a
Merged main: e87038576b94d58d3a5804bae4081558994d6b76
Product head: 4f0783c02f3420e257f355deca04e0724c3ea355
Exact-SHA Verify run: 42465620406 — completed/success on 4f0783c02f3420e257f355deca04e0724c3ea355.
CI URL: https://github.com/just-every/run-happytohelp/actions/runs/42465620406
Blockers: none. No PR was required or created; no landing was performed.

The supplied CT ruling dated 2026-11-08T08:40Z authorizes this slice as OUTBOUND-001-NOTE. OUTBOUND-001 remains partial. No acceptance, DONE, Status, Gap or Evidence judgment was changed. Contract summary before/after is identical: 4 done, 71 partial, 16 missing, 91 total. Touched public journey registrations remain 2 existing registrations; added registrations 0. Migrations added 0; frozen implementations changed 0.

## Plan and implementation results

1. Inspected launcher/repository instructions, contract/acceptance/handover, native ticket normalization/reservation, guarded note persistence, existing dialog and surviving email/inbox browser journeys. Refreshed main and retained the given source implementation, tests and migrations. No queue/INBOX/STATE files were read or written; unavailable feeder custody is not claimed as builder evidence.
2. Added an explicit First comment choice only to the single-email dialog. Public reply is the initial default; internal note explains that no email is sent and uses Create ticket. The mailbox, sender, requester, form/fields, group and assignee remain native controls. CC/BCC are unavailable for a private first comment. The draft and immutable choice survive a lost response.
3. Added an optional internal intent to normalized commands. Omitted and explicit public choices produce the historical normalized bytes. A private command's changed public/default replay conflicts before message admission. Invalid choice values, private email copies and batch/other-channel use of the new choice are refused.
4. Reused the deterministic guarded conversation_notes insertion/readback previously used for call logs. Call note IDs and errors remain unchanged. Private email creation preserves email channel/mailbox, customer requester, authenticated operator submitter and selected configuration, then returns before admitMessage, outbox admission or the delivery callback. No schema or migration was needed.
5. Extended outboundConfigurationJourney and newTicketConfigurationBrowser in their existing registrations, without new registrations or weakened assertions. Readback covers operator detail/inbox/buckets and the customer's authenticated /api/conversations/:id/messages door. Native restart and a lost response after actual note commit return one ticket and one note. Role, current-authority race, foreign workspace and ticket/destination scope refusals retain their guards. A later explicit human Send uses the existing durable email path; its provider-edge copy omits the note and a provider-authenticated customer reply threads into the same ticket.
6. Updated only the email usage paragraph. Regenerated sources.lock.json after tracked edits. Typecheck/build/source/first-party/Base-copy/contract-document checks passed. The full merged-head email registration passed (467.9 seconds, 1 pass / 0 fail). The full merged-head browser registration also passed (1 pass / 0 fail), with four changed-screen captures at 1440/390. Exact-SHA Verify completed successfully on the same published head. Final results are recorded in VALIDATION.json and CI-RECEIPT.json. Product pushes use the fleet guard and identity/trailer audits; reports use a separate evidence-only tree. No landing, deployment, release or status change is authorized or performed.

## Proof and counts

Before implementation, Email requester always admitted a public first message; private creation required Log a call and a phone ticket. With internal-first email creation, the native test observes one email ticket, one guarded operator note, zero public messages, zero conversation_outbox entries, zero email_message_options entries and zero customer mail before Send, including replay/restart/scheduled recovery. After explicit Send, the test observes one public reply and one provider copy, then one customer reply in the same thread, with the initial note excluded from customer content. Concurrent and changed-intent retries are covered.

Existing public email default, deliberately unassigned configuration, old normalized call commands, call no-send behavior, form/field/group/brand choices, role refusals and existing channel UI assertions are retained. Browser assertions use 1440 only. The changed dialog/thread are captured at 1440 and 390; inspected captures show the explicit no-email choice, native controls and private-note/public-message distinction. Screenshots contain synthetic fixture data only.

Exact registrations:
- tests/journeys/email.mjs: "a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome"
- tests/journeys/inbox-browser.mjs: "two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening"

## Main refresh and publication history

Main advanced to e87038576b94d58d3a5804bae4081558994d6b76 with a per-workspace AI reply-mode implementation. The candidate rebased cleanly and retains that implementation. A shell guard failed to stop subsequent commands, so the first save push happened before post-rebase checks. That push was not READY. Post-rebase typecheck/build/source/first-party/Base-copy/contract-document checks all passed, and source-lock regeneration left the published checkout clean. Two in-flight pre-rebase confirmations were stopped using only their owned process trees; both registrations were then restarted on the merged build. Both full registrations passed on the merged head. Exact-SHA Verify subsequently passed. The final custody claim is based on those results, with no further product commit or history rewrite. Published history is retained, with no force push, rebase or amendment afterward.

## Validation history and boundaries

The first email run used the VM Node 24 and stopped in existing local-mail cleanup before outbound assertions, with "Journey server PID has no owned control socket". Running the registration directly under repository-pinned Node 22.20.0 avoids the runtime re-execution/PID mismatch. A subsequent run passed the new private/scope/restart assertions but found that its fixture lacked an inbound credential needed to issue Reply-To. Added a synthetic INBOUND_EMAIL_TOKEN to that network-edge fixture; kept the threading assertion. A later review tightened new-field validation to refuse non-string choices rather than coercing them. Final executions and all attempts are retained separately in the packet.

All provider work is official-schema/local network-edge fixture proof. No live mailbox delivery, independently hosted installation, provider qualification, independent gate acceptance, publication scan or landing is claimed. The lane and Mac lander retain those duties. Default public-email and call behavior is retained; there is no multi-recipient/private-batch or other-channel feature extension.

CLAIM OUTBOUND-001-NOTE rubric=N1,N2,N3,N4 points=none; test="a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome"; native/typecheck/source checks passed; no DONE claim.
CLAIM OUTBOUND-001-NOTE rubric=N1,N2,N3 points=none; test="two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening"; assertions at 1440; changed-screen captures at 1440/390.
DEFAULT OUTBOUND-001 status=partial unchanged; public first comment remains the default. Live provider qualification remains outside this slice.

Product custody and evidence transfer are separate. Independent gate and guarded landing remain lane actions.

READY branch=cloud/hh-outbound001-email-note-n1 head=4f0783c02f3420e257f355deca04e0724c3ea355
