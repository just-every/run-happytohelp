# HappyToHelp ticket reference candidate

Run Edit Run fleet — 2026-11-17T10:03:18Z. Tag: hh-stranger13-behaviour-1-c1.

Result: the short support reference is implemented across customer placeholders, operator headings/titles and scoped inbox search. Exact-head Verify is green; clause status cells are unchanged.

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

Final product branch: cloud/hh-stranger13-behaviour-1-c1.
Final full head: `c0b85c26bc44e77e3d943df1a3584aa8e712b799`. Product push and remote ref were verified through ordinary Git. All candidate commits, including side parents, passed fleet identity/trailer inspection. No PR was created; branch Verify is this repository's pre-main entry point.

**Exact-SHA Verify: completed / success**, run [44055737842](https://github.com/just-every/run-happytohelp/actions/runs/44055737842), head `c0b85c26bc44e77e3d943df1a3584aa8e712b799`. Ten GitHub calls total were used across discovery, bounded status polling and the single failed-job log invocation. `ci.json` and `terminal-receipt.json` retain the actual terminal response.

Local results:
- Native rer setup and build completed with synthetic local data. No remote installation or provider account was used.
- Replacement/scoped-inbox journey: 1 passed, 0 failed. The other four inbox registrations and legacy SES registration passed in the broader touched run.
- Registered customer-email journey: 1 passed, 0 failed, on Node 22.20.0. The final follow-up translated request-form journey: 1 passed, 0 failed.
- Typecheck, first-party rer check and regenerated source-lock check: exit 0, including after the follow-up correction.
- Final integrated build and widget macro browser test: exit 0, 1 passed, 0 failed. The browser test asserts at 1440; all four captures were inspected at 1440 and 390. The recorded reference is #F4211F53, with the UUID preserved in its link. This local proof ran on 32bb314532f9ab34edcbb67cf6b758833649c544; all product sources are byte-identical on the final head, whose only subsequent change is the request-form test filter and its source lock. Exact-SHA CI reran the browser registration on the final head.
- No full local suite was run. Exact-SHA GitHub Verify supplied the full check.

The first Verify, 44050158749 at 32bb3145, had one failed shard (assistant-and-knowledge) and one failing registration: its request-form CC acknowledgment filter still searched for the full UUID in the body. The template correctly rendered the new reference. The filter now matches the short reference; the count, replay and CC/privacy assertions remain intact. All other selected shards, build, contract docs and size check passed that first run. `ci-attempt-1.json`, `ci-jobs.json` and `ci-failure.txt` retain its actual result and assertion.

The required `gh run view 44050158749 --repo just-every/run-happytohelp --job 133926461257 --log-failed` command was invoked once. It exited 0 with empty stdout but fetched the log archive into gh's local cache; the failed step was read from that cache without a second network download. Earlier local checks also exposed raw-UUID expectations in individual, unnamed-requester and bulk macros and default/request-received/solved notices; these now require the intended reference without dropping their protected user-flow assertions. A Node 24 local-server PID custody issue was resolved by running the repository's pinned Node 22.20.0. A direct helper invocation outside node:test was stopped after it made no progress; the registered journey subsequently passed.

The email run began at 5078741f and completed after current main was integrated; reference implementation and assertion files were unchanged by that merge. Static checks ran after integration. Final exact-SHA CI independently qualifies the complete integrated head.

Blockers: none for this candidate. The required independent gate for items 2, 3, 4 and 15 follows. No independent gate, landing, main push, release or deployment was performed. The cloud cannot perform the Mac publication scan; that fleet pre-landing guard remains required. Evidence publication is report custody, not acceptance or landing.

## Claims and remaining boundaries

CLAIM MACRO-001 PARTIAL points=1,2,3 tests=tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure; tests/journeys/inbox-browser.mjs#a saved reply previews the short support reference and working link on a widget ticket, matching its operator header and page title
CLAIM DESK-001 PARTIAL points=1 tests=tests/journeys/inbox.mjs#inbox finds every readable exact ticket reference prefix without leaking tenant or operator-scoped tickets; tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure
CLAIM NOTIFY-001 PARTIAL points=1,2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome
CLAIM STATUS-001 PARTIAL points=1,2,3,4 tests=tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure
GAP MACRO-001: Existing clause-wide judgment remains Partial; this round closes the named customer-reference defect, subject to the independent gate.
GAP NOTIFY-001: Provider-edge fixtures establish local behaviour, not real configured provider delivery.

Signed Run Edit Run fleet, 2026-11-17T10:03:18Z.
