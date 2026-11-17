# HappyToHelp ticket reference candidate

Run Edit Run fleet — 2026-11-17 UTC. Tag: hh-stranger13-behaviour-1-c1.

## Scope and plan

The complete plan is in PLAN.md. The candidate combines the published parent behaviour fixes (2724edff5c7de79ae061a3a07592e1f23c3459ff) with stranger-13 item 2. Parent commits were replayed linearly on a64ebd6dc51bcc8c349a6a0ebcc71f26985501a2 before this branch's first push. No published branch was rewritten. After the save was published, main advanced to b2b9bc602a73feb542017bca8a46529f68b631c4; it was merged under the cloud published-save rule, without conflicts, and the source lock was regenerated. Main’s unrelated changes were retained. No change was made to the parent behaviour for items 3, 4 or 15.

The signed hh decision in the supplied brief was used: one derived reference, # plus the first eight hexadecimal UUID characters in uppercase, with no migration or stored rename. URLs, APIs, exports and the underlying UUID remain unchanged. No live installation, customer data, external mail or deployment was used.

## Placeholder sites found

- src/modules/macros/placeholders.ts owns the common renderer. ticket.id is formatted there, including nested context and fallback syntax. Older saved templates containing #{{ticket.id}} retain one # rather than producing ##.
- src/modules/macros/context.ts supplies the UUID and full ticket.link for saved replies; src/modules/macros/preview.ts renders it, including macro drafts and bulk previews. The context retains native identifiers.
- src/modules/tickets/problem-preview.ts also calls the shared renderer for customer replies to linked Incidents.
- src/modules/integrations/triggers/context.ts supplies ticket.id and ticket.link to notification templates. src/modules/integrations/triggers/templates.ts uses the common renderer for subjects and bodies. Both request-received and solved defaults now rely on the placeholder to include its #.
- src/modules/integrations/triggers/customer.ts and notification-actions.ts use that template path for requester, CC and operator notification delivery. src/modules/workflows/notify.ts routes request_received, solved, customer_update and operator notices through it; its default subjects/bodies now use the same marker convention. Custom workflow messages also use it.
- The widget receives the rendered public reply through ordinary message admission. There is no separate widget placeholder renderer. Imported Zendesk placeholder mappings retain ticket.id and ticket.link and reach the same macro renderer.
- docs/macros-and-teamwork.md, the saved-reply editor hint and the notification-template hint now explain the short reference.

## Operator reference and search

The existing Ticket panel heading displays the same derived reference, and the conversation document title includes it. No page type or new control was introduced.

Inbox recognizes exactly eight hexadecimal characters, with an optional leading # and any letter case. It searches the leading UUID range using the native ID index. It keeps the existing outer membership, workspace, ticket scope and visible-message predicates. An ambiguous prefix returns every readable match and a scoped total; a reference quoted inside another message does not create a false ID match. Ordinary non-reference identity/full-text searches retain their existing path.

The public-door search test probes both the global and project inbox with #CA164BF0, ca164bf0, #cA164bF0 and CA164BF0. Two readable collision fixtures appear; a same-workspace restricted-group match, a foreign-tenant match and a message-substring decoy do not. The owner can read the third same-workspace match. The operator's direct read of the private match is still 404. Actual results are in ticket-reference-search/receipt.json.

## Before and after browser evidence

Original build: the saved reply displays the full UUID after “Your support request”; the operator Summary header has no support reference. Original captures are ticket-reference-before/1440-preview.png, 390-preview.png, 1440-ticket.png and 390-ticket.png. The desktop and phone preview captures and Ticket header captures were inspected. The preview was recaptured with the assistant closed so it is visible on the phone.

Candidate captures are ticket-reference-after/1440-preview.png, 390-preview.png, 1440-ticket.png and 390-ticket.png. The new browser registration asserts at 1440; 390 is browser proof. All four candidate captures were inspected. The short reference and full working UUID URL are distinct. The test checks that the operator heading and page title match the reference. The actual browser receipt records its synthetic UUID and reference.

## Counts and unchanged boundaries

Top-level test registrations across tests/: 119 before, 121 after (+2). Journey registrations: 115 before, 117 after. These are syntactic registration counts, not a claim of a fresh full-suite run or a count of generated cases. No new test matrix, pin test or assert script was added. Existing single-ticket and bulk macro, request-received and solved-notice expectations were updated for the changed behaviour, without dropping their user-flow assertions.

Contract source/status summary stays 4 Done / 71 Partial / 16 Missing, total 91. Clause status changes: none. CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md were not edited. Release/version metadata, migrations, dependency pins, provider preflight sources and Base copies remain unchanged. The widget visitor-email ask is unchanged.

## Validation and custody

Final candidate under validation: `c0b85c26bc44e77e3d943df1a3584aa8e712b799`.

Local rer setup and build completed. The final build and browser test both passed on the integrated, pushed head. The final browser receipt records #F4211F53; its UUID stays in the full working link. All four final captures were inspected at 1440 and 390. CI is recorded below.

Initial local checks deliberately retained the old user-flow assertions. They exposed raw-UUID expectations in individual, unnamed-requester and bulk macros, and in default/request-received/solved notices. Those expectations now require the short reference, with existing message, authority, missing-field and no-send checks retained. The default notification journey also asserts that subjects omit the UUID. An earlier Node 24 run failed the local server PID custody check when rer re-executed on Node 22; the pinned Node 22 run passed that stage and proceeded to the notification assertions. No product or test workaround was made for the cleanup check.

Registered email journey: PASS (1 registration), using Node 22.20.0. Replacement/scoped-inbox journey: PASS (1 registration). The other four inbox registrations and legacy SES registration passed in the broader touched run. The two new search/preview registrations also passed. Typecheck: exit 0; first-party rer check: exit 0; source-lock check: exit 0. No full local suite was run.

The email run began at 5078741f90e4cb0a1fd0243d1d143b000bf17a01 and completed after the main integration commit; the reference implementation and assertion files did not change in that merge. Typecheck, rer check and source check ran after integration. Final build/browser and the exact-SHA CI run qualify the integrated head separately. The direct helper invocation outside node:test was stopped after it made no progress; the registered journey subsequently passed.

Final product push: confirmed at `c0b85c26bc44e77e3d943df1a3584aa8e712b799` through the fleet guard, including all candidate/side-parent identity and trailer checks. PR: none created; the repository's branch Verify is the pre-main entry point. Verify run: [44050158749](https://github.com/just-every/run-happytohelp/actions/runs/44050158749), still in progress after the first five-minute poll (2 GitHub calls used).

The first exact-SHA Verify (44050158749, head 32bb314532f9ab34edcbb67cf6b758833649c544) completed with one failed shard, assistant-and-knowledge. Build, contract docs, size check and all seven other shards passed. Its only failing registration was the translated request-form journey: its CC notice filter still looked for the UUID in the body, where the new template correctly renders the short reference. The count and CC/privacy assertions were retained, and the filter was updated. The failing journey then passed locally (1 test, 0 failures), followed by exit 0 from typecheck, first-party rer check and the regenerated lock check.

The required gh log command was invoked once. It exited 0 with empty stdout but fetched the archive into gh's local cache. The failed step was read from that cache without another network download. ci-failure.txt contains the actual assertion and command receipt; ci-attempt-1.json and ci-jobs.json retain the first run's results.

Follow-up candidate: `c0b85c26bc44e77e3d943df1a3584aa8e712b799`. It changes only tests/helpers/request-forms-journey.mjs and sources.lock.json from the prior pushed head. The final local browser proof on 32bb3145 is byte-equivalent for all product sources. The follow-up is pushed, and Verify 44055737842 is in progress. Nine of ten permitted GitHub calls have been used; the last call is reserved until the prior run's longest shard has had time to finish. This packet publication is evidence custody only, not READY or acceptance.

TERMINAL_CI_PENDING

The full-suite wall is exact-SHA GitHub Verify; local execution is limited to the touched journeys, typecheck, first-party rer check and lock check. The cloud cannot perform the Mac publication scan; the fleet retains that pre-landing guard. No independent gate, landing, main push, release or deployment is claimed.

## Claims and remaining boundaries

CLAIM MACRO-001 PARTIAL points=1,2,3 tests=tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure; tests/journeys/inbox-browser.mjs#a saved reply previews the short support reference and working link on a widget ticket, matching its operator header and page title
CLAIM DESK-001 PARTIAL points=1 tests=tests/journeys/inbox.mjs#inbox finds every readable exact ticket reference prefix without leaking tenant or operator-scoped tickets; tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure
CLAIM NOTIFY-001 PARTIAL points=1,2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome
CLAIM STATUS-001 PARTIAL points=1,2,3,4 tests=tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure
GAP MACRO-001: Existing clause-wide judgment remains Partial; this round closes the named customer-reference defect, subject to the independent gate.
GAP NOTIFY-001: Provider-edge fixtures establish local behaviour, not real configured provider delivery.

Signed Run Edit Run fleet, 2026-11-17 UTC.
