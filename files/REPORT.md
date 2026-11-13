# Internal-only ticket before mailbox setup

Repository: just-every/run-happytohelp
Branch: cloud/main-happytohelp-internal-ticket-1
Head: 9e388ffe74b59fb62b632c177d0651acffb45015
Base: acdcff44b1dae61a4c5559807c33430fd0891dbd
Product push: succeeded once through cloud-push.py. PR: none (branch Verify is the repository entry point).

## Result

A new email-channel ticket whose first comment is internal can now be created before any mailbox exists. The new requester, authenticated submitter, ticket and team-only note are recorded. No public message, outbound outbox item, send options, email delivery or provider send is created. Public first comments and service notices still require a mailbox. The New ticket form puts a connect-mailbox explanation and Email settings link beside those sending choices. An internal ticket with a supplied mailbox still requires that mailbox to be connected and in the current workspace.

## Plan

The full working plan is in PLAN.md. Initialize fleet custody; reproduce current main through the inbox and native HTTP door; narrowly change mailbox validation and form eligibility; extend the existing configuration browser journey without a registration; run the touched helper, typecheck and source checks; integrate fresh main, regenerate the source lock last and push the named branch; watch exact-SHA Verify and return the report on the evidence ref.

## Before and after

Baseline current main acdcff44b1dae61a4c5559807c33430fd0891dbd was built through rer. In a workspace with zero mailboxes, the completed internal-note form had Create ticket disabled. The same private command at the native tickets endpoint returned HTTP 400, Invalid mailboxId. See before.json and before-1440.png/before-390.png.

After the change, the real inbox dialog creates one new requester, one email-channel ticket with mailbox_id null, and one internal note. Reload and duplicate retry retain the same ticket and note. The customer message collection is empty. The isolated store contains zero conversation_outbox rows, zero email_deliveries and zero email_message_options for that workspace; the provider fixture receives zero sends for this flow. The UI and native API refuse public email and notice choices without a mailbox, and a supplied unavailable mailbox still fails admission.

Counts: the inbox browser registration remains 5 -> 5. Static test() registrations in tests/journeys/*.mjs and tests/reports/*.mjs remain 107 -> 107; zero registrations added, deleted or skipped. This is a static registration inventory, not a claim that every full-suite case ran locally. Contract clause judgments and generated views changed 0 -> 0. The private flow changes 0 creatable tickets -> 1, with 0 outbound work items both before and after.

## Local validation

- Rer setup completed with 195 migrations using a private owner-answer file that is excluded from evidence.
- Rer builds of baseline and changed source passed. Node 22.20.0 and pnpm 10.12.4 were used for final checks and the touched browser helper.
- The complete newTicketConfigurationBrowser helper passed at assertion width 1440 using /usr/bin/chromium with --no-sandbox. The helper also exercised connected-mailbox public and private creation, lost-response retry, later explicit Send, brand-switch ordering, form/assignment checks, call logs, WhatsApp consent refusal/approved send and create-authority refusal.
- An additional direct outboundConfigurationJourney route regression was attempted separately. Its isolated in-process Miniflare database never reached application migrations in this cloud VM; bounded loopback-only retries are recorded separately and are not counted as a pass. The complete emitted-app browser helper above is the local behavior proof.
- Final typecheck, source-lock generation/check (ok=true), first-party rer check and git diff --check passed. See local-checks.json, browser-receipt.json and browser-journey.log.
- Browser proof for the changed public choice, service notice choice, internal choice and resulting ticket was captured at 1440 and 390. The public/internal screens and phone result were visually reviewed; the field geometry remains usable, and the internal Create ticket control is enabled.
- Fresh origin/main was fetched and the unpublished checkout rebased with autostash before the candidate. Main was unchanged, and no conflict arose. The source lock was regenerated last. No contract or generated-view file was committed.
- Full candidate history (including side parents) was audited for fleet author/committer identity and co-author trailers before the guarded push. One product commit, no co-author trailers, no skip-ci marker; clean product tree. See identity-audit.json and product-receipt.json.

## Contract boundary

OUTBOUND-001 says the operator can make the first comment public or an internal note; only a public comment is described as outbound email. Acceptance point 2 includes an internal-only ticket with no send. There is no deliberate mailbox requirement for this choice, so no contract edit was needed.

CLAIM OUTBOUND-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening

The internal-only portion of point 2 is proved by the new helper and current browser run. This narrow task does not claim all of point 2 (including the independent three-recipient service-notice failure journey), nor a DONE clause. Status/Gap/Evidence cells and summary counts remain unchanged.

DEFAULT OUTBOUND-001: permit an absent mailbox only for an explicitly internal first comment; validate and retain any supplied mailbox as before.
GAP OUTBOUND-001: broader point-2 and configured-provider qualification remain outside this narrow internal-ticket change.

## CI and custody

Exact-SHA Verify run: 43426298677, https://github.com/just-every/run-happytohelp/actions/runs/43426298677. Final REST result: completed/success on the exact product head. One watcher used 7 calls at intervals of at least 300 seconds, within the ten-call budget. No failing job or step. See ci-receipt.json and github-calls.json. The full publication scan and landing remain with the fleet.

Product READY/PUSHED custody is separate from evidence transfer. Reports and screenshots are selected explicitly and published only on evidence/main-happytohelp-internal-ticket-1. No report, proof, secret or screenshot is committed to the product branch. The Mac fleet retains publication-scan and landing authority; no main push, merge or production operation was performed here.

Terminal product result: exact-SHA Verify passed; no product blocker. Local route-harness startup remains a recorded cloud limitation, not a passing local result. The full Verify success is independent of that local startup attempt.
