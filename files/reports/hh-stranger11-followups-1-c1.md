# HappyToHelp: stranger-11 follow-up repair
Run Edit Run fleet · 2026-11-16T23:04:03Z · hh-stranger11-followups-1-c1.

Product repository: just-every/run-happytohelp. Branch: cloud/hh-stranger11-followups-1-c1.
Exact head: `e16adff519a241389cda942d133eb1da532eedbe`. Tree: `0250442e104df792cf44c8786c1f6ff269a08933`.
Original candidate: `5ab76253ed29375ff862a79ed5c2ee7f52a6abc2`.
Merged main: `ece2172a9463acbd6cbf998189ab18a4fa66c693`.
Verify: [43970764732](https://github.com/just-every/run-happytohelp/actions/runs/43970764732), status `completed`, conclusion `success` on `e16adff519a241389cda942d133eb1da532eedbe`.

The candidate retains all five original follow-ups, merges current main, restores valid imported forms without weakening workspace-role SLA checks, synchronizes the macro journey with responsive panel state, and restores the prior health probe semantics. The five requested local journeys, typecheck, source check, rer check and build passed. No tests or assertions were removed or weakened. CONTRACT.md Status, Gap and Evidence and the generated views were not edited. Clause promotions: 0. No features or migrations were added by this repair.

## Before and after

All three named regressions were run individually against the original candidate and main, using the exact journey files from the failed shards. The original B failure did not reproduce locally; that boundary is explicit below.

| Named journey | Original candidate | Main comparison | Repaired source |
| --- | --- | --- | --- |
| A: review/import/repeat/repackage/undo | FAIL, 7 rejected instead of 5 | PASS, 196.6 s | PASS, 200.7 s |
| B: shared macro handoff | PASS, 158.4 s | PASS, 158.8 s, extra DOM observations | PASS, 157.7 s |
| C: Zendesk connect/import/form review/undo | FAIL, missing form review link, 244.8 s | PASS, 270.2 s | PASS, 266.8 s |

The original exact-head Verify 43948782221 attempt 2 had three failed shards: import-and-reports job 133617757273, support-and-recovery job 133617757316, and public-and-import-browser job 133617757476, all on 5ab76253ed29375ff862a79ed5c2ee7f52a6abc2. original-verify-jobs.jsonl records the returned job metadata. The single prescribed archive command, `gh run view 43948782221 --repo just-every/run-happytohelp --job 133617757316 --log-failed`, exited 0 with empty output; original-verify-B.log preserves that actual result. No archive download retries were made.

## A: valid proposed form fields were rejected before import

The original candidate reproduced the exact assertion at tests/move-in/review-import.mjs:48: actual rejected records 7, expected 5. Its plan newly rejected source ticket forms 401 and 402 with `Unknown or internal ticket field`.

publicField had been changed to require `form_eligible===1`. The Zendesk reader builds disabled proposed forms from source-validated zendeskField rows before those fields exist in native storage. Those rows carry read_roles_json but no computed form_eligible. formDefinition therefore rejected valid source forms.

The fix restores the original raw proposed-row compatibility: explicit computed denial (`form_eligible=0`) still refuses a stored field, and built-in read-role validation still runs. Stored paths continue to receive the current custom-role/source verdict from fieldVisibility. Imported forms remain disabled and must pass current workspace eligibility when later published.

Every publicField caller was audited: form settings/definitions, public form list/load, account publication checks, and SLA policy validation. Stored catalogues in those paths come from fieldVisibility; the Zendesk proposed-form reader is the raw proposed-row path. Reports are not a separate direct publicField caller.

The repaired unchanged registration completed all review/import phases, vendor replies, inert repeat/repackage and exact undo equality with the expected five rejected source records. No `Your report access changed` exception appeared in the repaired A log. Full receipts: before-candidate-A.log, before-main-A.log and after-A.log.

## B: synchronize the test's Show/Hide decision with the breakpoint callback

The reported CI timeout waits for the Show conversation panel button. The existing journey changes from 390 back to 1440, then checks that button's visibility and clicks it. useConversationAssistant opens the permanent desktop column asynchronously from a matchMedia change handler. The button's accessible name changes from Show to Hide, so an observation made before that callback can select an action whose locator disappears before its click. The existing HubSpot journey already waits for this same aria-hidden transition before choosing an action.

The original candidate passed locally without instrumentation. Main also passed with unchanged test sources plus extra DOM observations; these do not mutate application state but can affect scheduling. Therefore the CI failure was not reproduced as a deterministic product failure on this VM. main-B-diagnostic.jsonl records the observed responsive states and final open desktop panel. The viewport race is the source-level defect matching the reported timeout; a health-probe failure was not demonstrated as its cause.

The helper now waits for React to apply each crossed breakpoint to the actual assistant aria-hidden state before choosing Show/Hide. It uses the existing HubSpot pattern, adds no fixed sleep, changes no application panel behavior, and keeps every assignment, edited-message, reload, explicit takeover, overflow and screenshot assertion. The repaired journey passed. Its inspected 1440 and 390 sent screenshots show the saved edited reply; desktop retains Pending and Lena Patel as assignee, and the test then asserts explicit owner takeover.

Full receipts: before-candidate-B.log, before-main-B.log, main-B-diagnostic.jsonl and after-B.log. Proof images: browser-after/stranger11-after-macro/1440-sent.png and 390-sent.png.

## C: the missing review link was an import rejection

The original candidate reproduced the exact 15-second timeout for `Review form “Order request 144021”` at configurationBrowser line 94. The inspected import report shows both forms 144021 and 144022 rejected with `Unknown or internal ticket field`, so there is no native form to link to. This has the same cause and fix as A; no link selector or timeout was changed.

Main and the repaired candidate both complete the original journey, including the two native draft forms at 1440 and 390 and current main's newer legacy-import undo assertions. Valid imported form links go from 0 to 2 per configuration fixture; the intentionally unsupported SLA policy remains rejected. The repaired screenshots configuration-forms-1440.png and configuration-forms-390.png were inspected and show both imported draft forms.

Full receipts: before-candidate-C.log, before-main-C.log, after-C.log and browser-after/move-in/checks.json. Before image: browser-candidate/move-in/configuration-report-1440.png. After images: browser-after/move-in/configuration-forms-1440.png and configuration-forms-390.png.

## Health probe decision and proof

Restore `r.ok||r.status===503`. This probe asks whether the Worker is reachable before one guarded interrupted-document reload. A degraded but responding Worker can return 503; that must not prevent recovery forever. The document-completion marker independently cancels recovery. The original follow-up requested calm automatic opening, not a change to the health contract. The calm copy and automatic retries are retained.

A separate scratch transport probe runs the actual generated document-recovery script against an interrupted HTTP document, answers /health with 503, then completes the reloaded document. At 1440 and 390 it showed the intended calm copy, issued exactly two document requests (one reload), recovered, and did not reload a completed document again. Both waiting images were inspected. recovery-probe.json, recovery-probe.log and recovery-probe.mjs retain the receipt and driver. The scratch harness first needed a CSS-empty bundler loader, then an explicit UTF-8 HTTP charset matching the native response; the initial setup error and pre-charset log are retained separately. These were harness issues, not product failures.

## Required touched checks and retained scope

- A, B and C passed as the original named registrations, one at a time.
- SLA field-access registration passed in 6.2 s: custom-role unreadable creation and edit are refused with unchanged saved state; explicitly readable-by-all and unrestricted fields are accepted and survive a runtime restart. The original candidate's fieldVisibility query and formFieldGuard commit-time role/source fence remain intact.
- The complete newTicketConfigurationBrowser journey passed: retained internal-only tickets remain visible after Inbox reload in workspace/global Yours; no-mailbox and private-note flows remain inert; public and approved-template deliveries use the existing network-edge fixtures. after-new-ticket.log preserves its actual outcomes.
- Typecheck, source check, first-party rer check and rer build all passed. Corresponding complete non-secret receipts are typecheck.log, source-check.log, rer-check.log and build.log.
- Test registrations added by c1: 0. Assertions removed/weakened: 0. Clause Status/Gap/Evidence edits: 0. Generated view files committed: 0.

All five original items stay: custom-role SLA checks and commit fence; Inbox internal-ticket reload coverage; calm automatic owner-entry copy; the two public-doc attribution removals; and the exact rer 0.2.121 pin and recorded Base selection. This round did not refresh Base. No new features, release metadata edits or c1 migrations were added.

Tests use isolated emitted Workerd/D1/R2 and native harnesses with synthetic data, plus headless /usr/bin/chromium with --no-sandbox. Final checks use Node 22.20.0, pnpm 10.12.4 and Chromium 154.0.8037.57. The initial original-candidate A reproduction used VM Node 24.19.0. A supplemental exact-source archive run under Node 22.20.0 also reproduced the same 7-versus-5 failure in 145.8 s (before-candidate-A-node22.log), matching the main/final toolchain. Its first attempt was interrupted during an environment reconnect before a result; the partial log is retained and the completed retry is the recorded result. The archive was removed; the product checkout was never changed for that confirmation. No hosted/customer installation, live provider, DNS, mail, AWS, app.happytohelp.com or paid model was used. Local setup succeeded with contained ignored private manifest answers; that temporary answers file was removed without printing its values.

## Plan and custody

PLAN.md retains the full plan. Its sequence was fleet setup and source review; original/main individual reproductions; caller and responsive-state diagnosis; one merge of newest main; scoped repairs and source-lock regeneration; the five touched journeys and static checks; guarded product publication and exact-head Verify; then report-only evidence publication. The cloud VM replaces the Mac remote/heavy-slot mechanics.

Current main was fetched after the comparison and remained ece2172a9463acbd6cbf998189ab18a4fa66c693. Its newer undo implementation/tests merged cleanly; no contract/view conflict occurred. The first real save b8b397b38d4bac44616814ac0e1719415f8b8329 merged main and fixed form eligibility/recovery, with [skip ci], and was pushed immediately on the first guarded attempt. The separate macro synchronization commit e16adff519a241389cda942d133eb1da532eedbe is the final non-skipped candidate and was also pushed on the first guarded attempt. Git ls-remote confirmed that exact branch head. No history was rewritten, force-pushed, submitted or landed; no PR was required or created.

PROVENANCE.json records exact product head/tree and ancestry. RESULTS.json records local outcomes. save/final identity audit logs inspect every candidate author, committer and trailer including side parents. save-push.log and final-push.log are actual custody receipts. github-api-calls.json records the bounded API use. Evidence goes only to evidence/hh-stranger11-followups-1-c1 as a separate report-only tree; product HEAD/index stay unchanged. Evidence publication does not signal acceptance or landing. The fleet's independent gate/publication scan remains separate and cannot run on this cloud.

## Clause claims

No clause is promoted by this repair. The targeted journeys prove subsets of broader clauses, so these claims are PARTIAL with no claim that a complete numbered acceptance point was newly finished.

CLAIM MOVE-IN-001 PARTIAL points=none tests=tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly; tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
CLAIM FORMS-001 PARTIAL points=none tests=tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
CLAIM MACRO-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#an owner previews a shared macro handoff to a UI-invited agent, edits and sends without taking over, then explicitly takes over
CLAIM SLA-001 PARTIAL points=none tests=tests/journeys/inbox.mjs#SLA field conditions admit only fields readable by every current workspace role
CLAIM OUTBOUND-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#two brands save their appearance and sender, serve isolated help and inboxes, and retain one widget reply and rating through reports, exports and reopening
