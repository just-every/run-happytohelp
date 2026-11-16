# HappyToHelp stranger-11 behaviour fixes

Run Edit Run fleet · 16 November 2026 UTC · hh-stranger11-behaviour-1.

Repository: just-every/run-happytohelp. Product branch: cloud/hh-stranger11-behaviour-1.
Baseline: 2044dfa31d6b5e43dea1224bca08e0b509e48396.
Candidate: 3c3580d07bb9fb4cb32455f71e7c7a44ea8c9981. Initial published save: eb36e485f34a7a20bfdf6d7a70027417d54bb1c7.

## Plan and execution

1. Set fleet Git identity, refresh the authorized launcher, install the decrypted-bundle credential helper, cloud push guard and clone-local forwarding/commit-message hooks. Clone only the declared repository and branch from fresh main.
2. Install dependencies and build unmodified main through rer. Reproduce each reported defect in native browser UI against the real emitted Worker with disposable native D1/R2, authentication, invitations and permissions. Use synthetic people and no live mail/model/account.
3. Preserve explicit macro assignment using the most recent assignment decision and its immutable macro version. Later native assignment controls supersede that decision. Keep ordinary automatic assignment for other cases.
4. Unify public-form read eligibility for empty role lists and explicit all-role lists, including workspace custom roles. Keep imported-field visibility, current field/source snapshots, membership and public-form publication guards. Public input does not widen staff edit rights.
5. Skip saved-draft loading for contacts already marked erasing/erased; clear a previously loaded draft on that transition. Keep backend erasure and unavailable-draft 404 semantics unchanged.
6. Extend the existing macro/form/erasure journeys and add two native UI registrations. Run the affected journeys, typecheck, rer check, source lock/check, and capture the changed screens at 1440 and 390. Merge fresh main after the first published save, then require the exact candidate Verify. Publish only the explicitly selected non-secret evidence packet on its separate evidence ref. The fleet owns independent review and landing.

## Reproductions on clean main

9. Invited Lena through Agents, accepted the invitation and signed in through the UI. Created shared Request damage photo with Pending and Lena, then applied it to Mia as Owner. Preview showed Owner → Lena Patel. After editing and ordinary Send, the persisted reply was correct but the assignee became Owner. Screens: stranger11-before-macro/1440-preview.png, 1440-sent.png, 390-sent.png; actual receipt: result.json. The transcript showed the Lena assignment followed by Owner.

10. Created Order number through Tickets > Fields using defaults. A fresh Project > Request forms > New request form offered no field. Cleared every read-role checkbox in the field editor, saved, and opened another new form: still no field. Screens: stranger11-before-fields/1440-default.png, 1440-empty-read.png, 390-empty-read.png; actual receipt: result.json. Both eligibility observations were false.

13. Populated Noah with one conversation, four messages, one attachment and a real stored macro draft. Erased through Contacts using the exact ERASE confirmation. The retained Inbox thread showed four redacted messages and issued one macro-draft request, producing the reported 404 alert. Screens: stranger11-before-erasure/1440-transcript.png and 390-transcript.png; actual receipt: result.json.

## Validation status

The affected ticket/macro route journey passed, including a later ordinary reply after its saved draft was consumed and explicit native takeover. The request-form journey passed after updating its pre-existing lookup expectation from staff-write restrictions to customer-readable fields. It still denies later read restrictions and lost membership, including races at the write boundary. The existing erasure route journey also passed (one registration, 580345 ms), including native/imported redaction, export/restore fencing and interrupted erasures. Typecheck, rer check --profile first-party, build and source-check passed on the final candidate. All three targeted browser flows passed. Verify 43910753765 completed successfully on the exact final head; CI.json contains all six cadence-limited observations.

One initial rer setup refused missing private answers, and one refused an answers file outside the checkout. Setup then succeeded using a contained, ignored, mode-0600 synthetic answers file: all 200 existing migrations applied and a native local owner was created. No migration bytes or release metadata changed. Inline-eval local test drivers stalled before obtaining their D1 binding; only their recorded processes were stopped. The file-based local driver completed. No product or shared test-runtime change was made for that environment issue.

Registered test calls: 114 before, 116 after, with no loop-generated registrations. The two additions cover the two changed native UI flows; existing macro, form and erasure registrations were extended. Counts and per-file inventories are in test-count-before.json and test-count-after.json. No full local suite was run.

MACRO-001, FORMS-001 and ERASURE-001 remain PARTIAL. No clause Status, Gap or Evidence, generated acceptance/claims views, release/version/tag metadata, upgrade baseline, size-check configuration, scanner configuration or migration was edited. The widget visitor-email flow, Reports and internal-ticket listing were outside this round.

## Boundaries

These are disposable local native/browser and provider-edge-fixture results, not a hosted install, live-provider qualification or independent gate. The no-Node bootstrap itself was not requalified: the stranger's reported application steps were reproduced after the prescribed fleet checkout/toolchain setup. Existing collaboration-disconnected text on erased contacts is outside item 13 and remains unchanged. The cloud cannot run the fleet Mac publication scan or land; custody and evidence publication are separate from acceptance.

DEFAULT FORMS-001: Public fields require every current workspace role to be able to read them. Staff write-role restrictions remain effective; publishing explicitly authorizes customer answers.
GAP MACRO-001: This round proves the reported handoff defect and its regressions; it does not promote the broader clause.
GAP FORMS-001: This round proves field selection/publication and preserves current form authorization; it does not promote the broader clause.
GAP ERASURE-001: This round proves the erased-transcript draft request defect; broader retained provider/archive qualification stays with the existing clause and independent gate.

The first candidate browser run passed the complete erasure flow, including 1/4/1 removed records and zero draft requests. Its 390px screenshot had the already-open side panel over the transcript. The remaining run was stopped to improve capture framing with the native Hide panel control; application code did not change. The focused browser run is repeated on the updated candidate.

## After the fixes

9. The same UI invitation, join, shared macro preview, editing, ordinary Send and reload retain Lena Patel as the assignee. The transcript has the explicit Lena handoff and no automatic switch back to Owner. Explicit takeover through Ticket > Summary > Assignee also succeeds. Screens: stranger11-after-macro/1440-preview.png, 390-preview.png, 1440-sent.png, 390-sent.png; result.json records the retained assignment. The complete macro UI journey passed on the final head. Its first takeover probe used an overly exact accessible-name selector that omitted the native avatar initial; correcting the selector required no product change.

10. Order number is selectable with default permissions and with an empty read-role list while the existing staff edit permissions remain in force. The UI publishes the Order problem form with the default field. The route journey submits typed values under both read encodings, retains restricted staff editing, and withdraws the form on later read restriction. Screens: stranger11-after-fields/1440-default.png, 1440-empty-read.png, 390-empty-read.png; result.json records true eligibility for both settings.

13. Owner erasure still reports exactly one conversation, four messages and one attachment removed. The retained thread shows four erased messages, no saved-draft alert, and zero macro-draft requests. Sessions, attachment removal, other contacts, repeat/interrupted erasures, export redaction and stale-restore fencing retain their passing assertions. Screens: contact-erasure/1440-erased.png, 1440-transcript.png and 390-transcript.png; 1440-result.json records removal counts, five checks and zero draft requests.

Before/after: reported defects 3 → 0; the two readable field settings 0/2 → 2/2 eligible; erased-thread draft requests 1 → 0; explicit macro handoff retained false → true; test registrations 114 → 116. The three clause statuses remain PARTIAL → PARTIAL; zero status/evidence/gap cells were edited.

Local proof provenance: erasure and field UI assertions passed on 41161dd7c4bb83ddab63317c167fe0fed3102543; the final change only corrects the macro test's menu locator, and the complete macro journey was rerun on the final head. Product source is unchanged between those heads. The exact final-SHA Verify is the qualification for the whole candidate. final-checks.json retains the intermediate interrupted run and the selector failure as well as the passing final checks. Screenshots at both widths were visually inspected; the candidate phone transcript captures use the native Hide panel control. Baseline phone captures retain the panel state actually observed; the 1440px baseline images show the original defects clearly.

Product push succeeded on its first guard attempt, and a separate Git ref read confirmed the exact published head. Verify 43910753765 was discovered in progress on that exact SHA at 16:45:05 UTC: https://github.com/just-every/run-happytohelp/actions/runs/43910753765.

## Scoped clause claims

CLAIM MACRO-001 PARTIAL points=1 tests=tests/journeys/inbox.mjs#a replacement request moves through scoped fields, a reviewed macro, shared queue work, private collaboration, routing, schedules and durable automations before closure and erasure; tests/journeys/inbox-browser.mjs#an owner previews a shared macro handoff to a UI-invited agent, edits and sends without taking over, then explicitly takes over
CLAIM FORMS-001 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#a lead adds a readable ticket field to a public request form with default permissions and an empty read-role list; tests/journeys/knowledge.mjs#a translated request admits typed conditional values and attributes its prior article view exactly once through replay
CLAIM ERASURE-001 PARTIAL points=none tests=tests/journeys/erasure.mjs#an owner erases a populated customer, observes coherent redacted history and external deletion, and safely completes repeats and interrupted erasures

These claims are scoped to this builder's work. The form selector and erased composer fixes are narrower than those clauses' complete acceptance obligations; no broader status promotion is requested. The erased composer assertion and 1440/390 captures are in tests/journeys/erasure-browser.mjs, whose existing registration begins “at 1440px an owner erases a contact only after typing ERASE”.

## Final result

READY branch=cloud/hh-stranger11-behaviour-1 head=3c3580d07bb9fb4cb32455f71e7c7a44ea8c9981

Verify 43910753765: completed / success on that exact SHA. URL: https://github.com/just-every/run-happytohelp/actions/runs/43910753765. The watcher used six GitHub API calls, with at least 300 seconds between observations. No workflow was dispatched or rerun. The source publication scan and independent gate/landing remain with the fleet; this builder neither pushed main nor submitted/landed the candidate. No PR was created because this repository supplies a branch-push Verify entry point.

All requested defects are fixed. There are no remaining blockers for this candidate. The report-only evidence publication is separate from product READY custody; the final evidence ref/head is supplied in the terminal. Product ref and report ref are verified before the owned product clone is removed. Actual reports, receipts and inspected screenshots remain under the fleet work packet and on the evidence ref.

Final signed by Run Edit Run fleet, 16 November 2026 UTC.
