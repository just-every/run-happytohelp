# HappyToHelp stranger-11 follow-ups
Run Edit Run fleet, 2026-11-16.

## Plan
1. Start from fresh main and reproduce SLA field admission and the internal-only ticket through public routes and the native Inbox.
2. Make SLA eligibility use current workspace custom roles and fence the check at policy commit; audit all publicField callers.
3. Locate the internal-only listing discrepancy without changing Reports or migrations. Cover assigned queue reload, counts and persisted private note with one public-door flow.
4. Measure fresh setup → rer dev v2 owner entry after RER_READY. Identify document/dashboard retry triggers; preserve automatic retry and use calm loading copy for actual waits. Capture changed screens at 1440 and 390.
5. Remove only the two internal clarification signatures from published documentation.
6. Pin rer 0.2.121 and refresh byte-exact Base copies from f2737d02a5f77be042cfdfd237a7dce4689cbe2f through --from-api. Declare any required public mail settings in deploy.json.
7. Run affected journeys, typecheck, rer check and source lock/check; no full local suite. Keep all logs, screenshot receipts and this report outside the product tree.
8. Fetch/merge fresh main before candidate push, regenerate source lock last, audit all candidate identities/messages, push only cloud/hh-stranger11-followups-1 through the fleet guard, then read exact-SHA Verify within the ten-call budget. Publish this packet separately on evidence/hh-stranger11-followups-1.

## Scope
No contract status/gap/evidence edits; no generated acceptance views; no migrations, release metadata, release baseline, size-check/scanner configuration, Reports, widget settings, move-in code, README or docs/INSTALLER.md edits. No live service/provider work. Candidate and evidence publication are separate from independent acceptance and landing.

## Initial state
Fresh main: 654419a28cc71d7e62c34b5c8af59411100f49af.
Pinned rer before: 0.2.119.
Published signature lines: docs/request-forms.md:139 and docs/macros-and-teamwork.md:33.
SLA route is the only raw-row publicField caller; form definition, publication, listing and account validation load fieldCatalogue/fieldVisibility first.

## Before reproductions
- SLA: public POST accepted the restricted condition with HTTP 201. The new public-route regression failed on main with 201 != 400 (before-api.json, before-sla-test.log). After the fix the same regression passes (after-sla-test.log), including refused PATCH without policy mutation, explicit custom-role access, unrestricted read access and restart.
- Internal-only Inbox: **not reproduced on supplied main**. Both global and workspace Yours lists, Open and Casey search include the assigned private ticket after a worker restart; mine count equals one (before-api.json). Native New ticket → Internal note → create Casey → leave → Inbox → reload also includes the ticket once, with mine=1 and list total=1 (before-internal-browser.json). No Inbox list query change is justified by these measurements; a focused browser regression protects the existing behavior. Reports counting stays untouched.
- Owner entry: native rer dev v2 RER_OPEN reached usable Setup in 16,683 ms after dev startup on this cloud VM. The only sampled pending notice was “Loading your workspace…”. No failed HTTP response and no “workspace is busy” stage was observed (before-owner-entry.json). Screenshots before-setup-1440.png and before-setup-390.png were visually inspected. An initial probe used the wrong heading (“Setup” versus the actual “Nearly ready” title); its timeout was a probe error, not an app failure, and the corrected probe waited for the loaded Setup list.
- Code-proven owner-entry triggers: document-recovery-script.ts shows the busy overlay after two seconds without arriving DOM nodes, probes health after four seconds (30 after reload), then automatically reloads. DashboardPending shows busy only for a 503 or transport failure; untilFree honors bounded Retry-After and retries automatically. No redirect/retry guard unconditionally announces a busy workspace. Only these proven recovery states will change; no claim of reproducing the original intermittent busy report.

## First published save
Product save d4164e6041092867cdcd7c13703f51bea3a788cd was pushed through the fleet guard after passing the new SLA route test, typecheck and source check. It carries [skip ci]. Its complete author/committer/message inspection found only the fleet identity and no trailers. Product saves are not READY.

## Documentation before
The actual public /docs/request-forms and /docs/macros-and-teamwork pages each rendered one internal fleet clarification signature. before-docs.json records the rendered lines; before-docs-<slug>-1440.png and before-docs-<slug>-390.png show them. Only the signature paragraphs were removed. The unrelated GitHub-only voice maintenance document was preserved.

## Rer integration
Pinned @runeditrun/rer exactly to 0.2.121 using pnpm add --save-dev --save-exact. Base acquisition uses the supported refresh-base --ref f2737d02a5f77be042cfdfd237a7dce4689cbe2f --from-api entrypoint, without cloning another repository or a task-local API adapter. The existing record has 437 copy groups and 990 files, so the built-in immutable API reader performs substantial acquisition before writing the result.
Seed-side adaptation: deploy.json now declares publicSettings=[MAIL_PROVIDER], vars.MAIL_PROVIDER=direct, and the optional MAIL_PROVIDER environment binding. This matches the existing Wrangler default. The supported declaration generator propagates it to management/integration/managed-deploy.json; credentials remain declared secrets.

## Source and check boundaries
The selected-field eligibility read retains the prior SLA query scope through fieldVisibility's optional field-ID selector. publicField now fails closed unless fieldVisibility supplied form_eligible=1. All callers were audited: form settings, definition validation, public definition/list/load and account publication use the eligible catalogue; the SLA raw-row caller was the exception. The policy transaction also rechecks publicFieldReadSql against current custom roles.
The two focused public-route flows passed: SLA field eligibility and the existing translated conditional request-form journey (touched-routes.log). A final check follows the selector change and refreshed copies.
No contract statuses, gaps or evidence cells were changed. The generated acceptance counts on supplied main are Core 4 done / 71 partial / 11 missing and Agent surface 0 done / 0 partial / 5 missing. Their statuses remain the lander's responsibility. One SLA registration was added and the existing internal-email browser journey was extended; no existing main test was deleted, skipped or weakened. test-counts.json records the before/after top-level journey registration count (109 → 110).

The final SLA transaction reuses formFieldGuard, rather than duplicating its predicate. This includes publicFieldReadSql plus the field revision and imported-source visibility snapshot, so a role or source change between validation and commit returns a conflict instead of admitting stale eligibility.

## Browser flow placement
The separate assigned internal-ticket prototype passed, and the existing request-form field browser flow passed (touched-browser-final.log; 165,935 ms and 170,142 ms). Because an emitted runtime costs nearly three minutes here, the internal reload assertions were then consolidated into the existing newTicketConfigurationBrowser private-email flow, retaining the workspace/global Yours, matching count, leave/reload and reopened private-note assertions. The final diff adds one SLA registration and extends one existing flow, rather than adding another browser runtime to Verify. The consolidated flow is executed separately in internal-email-browser-final.log.

The environment availability refresh interrupted the first consolidated browser run during its disposable migration setup; it produced no outcome. Product files and prior receipts were retained. A detached retry also ended without an exit receipt; neither interrupted attempt is counted as a test outcome. The final retry uses a foreground session plus an explicit exit receipt.

## Final candidate
Branch cloud/hh-stranger11-followups-1, full head 5ab76253ed29375ff862a79ed5c2ee7f52a6abc2. Fresh main was fetched again and the merge was already up to date at 654419a28cc71d7e62c34b5c8af59411100f49af. Source lock was generated after staging the removed prototype (an initial pre-staging lock attempt correctly refused the missing tracked file); the subsequent source check and first-party rer check passed. The final candidate has no CI-skip marker. Both candidate commits have fleet author and committer, no trailers, and fully inspected messages (candidate-identity.json). The cloud push guard succeeded on its first attempt (push-candidate.log).

The final checks are recorded in CHECKS.json. The new SLA route and existing translated form route passed; the field browser and internal prototype passed; the consolidated private-email browser journey passed with exit 0 at 2026-11-16T20:19:00Z. Its retained mixed-ticket assertions now run in the existing Verify flow. The first-party rer check, typecheck, declared source check, offline Base copy check, deployment declarations and rer build all passed. Rer describe completed with browser and Playwright advice present (describe-receipt.json). No full local suite was run, following the brief's scoped-check limit; the complete exact-SHA Verify is the CI bar.

## Final public-door and browser results
All after receipts identify 5ab76253ed29375ff862a79ed5c2ee7f52a6abc2 and a clean product worktree. Fresh rer setup → dev v2 → private RER_OPEN reached the real local owner's usable Setup in 15,248 ms. The first cold entry showed calm “Opening your workspace… We’ll continue automatically.” and normal loading copy, with no failed HTTP responses; it did not show the old busy wording. This measures first owner entry on the retained cloud checkout after a fresh local reset/setup, not a hosted deployment or a claim that RER_READY itself waits for browser rendering.

The actual dashboard-prefix network-edge probe cut the document, returned two HTTP 503 health responses, and proved that no retry navigation occurred while health was still warming. Releasing health to 200 automatically restored usable Setup. The receipt's activation request count includes all matched activation requests; it is not a count of browser reloads. The quiet-document recovery and dashboard retry states retain their automatic waits, with calm copy.

Casey's assigned internal-only ticket remained in Yours after leaving and reloading Inbox: one visible row, list total 1, Yours count 1, and no public message. The consolidated existing journey additionally proves the private-only row among its public/outbound fixtures and global/workspace Yours consistency. The original disappearance is not reproduced on supplied main, so no unsupported Inbox query rewrite was made. Reports remains unchanged.

Both public documentation routes render zero internal signature lines after the removal (after-docs.json), down from one on each page. Their substantive guidance is unchanged.

Screenshots visually inspected at 1440 and 390: before/after Setup, before/after Casey's reloaded Yours list, before/after /docs/request-forms and /docs/macros-and-teamwork, plus after-entry-recovery-1440.png and after-entry-recovery-390.png. All changed screens retain the native layouts; the recovery message fits both widths.

## Boundaries and remaining uncertainty
No real blocker is known from local checks. The original intermittent busy event and stranger Inbox disappearance were not reproduced on supplied main; the cold-entry measurement and targeted recovery fixture are reported separately. No live installation, provider, customer data, DNS, AWS, real mail, public deployment or app.happytohelp.com was accessed. Base reported a React 19.3.1 preference versus the seed's 19.2.8; no selected source bytes changed and the seed's existing pin passed its app checks, so it was retained. Five acknowledged seed adaptations and the seed-owned Verify workflow were preserved; no migration was required. The complete publication scan and independent acceptance/landing remain with the fleet.

DEFAULT SLA-001: use the same current custom-role and imported-source eligibility as request forms.
GAP OUTBOUND-001: the reported internal-ticket disappearance is not reproduced on main 654419a28cc71d7e62c34b5c8af59411100f49af; preserve the working query and protect it with the extended private-email journey.
GAP NATIVE-001: no hosted/live-provider qualification is claimed; local cold entry and an explicit network-edge warmup fixture passed.

## Before/after counts and claims
| Observation | Before | After |
| --- | --- | --- |
| Restricted SLA field condition in a workspace with a custom role | HTTP 201 | HTTP 400; explicit all-role and unrestricted fields accepted |
| Published internal attribution paragraphs | 2 | 0 |
| Casey private-only ticket after Yours reload (fresh local fixture) | 1 row / count 1 | 1 row / count 1 |
| Top-level journey registrations | 109 | 110; one added SLA flow, one existing internal-email flow extended |
| Core clause statuses | 4 done / 71 partial / 11 missing | unchanged |
| Agent-surface statuses | 0 done / 0 partial / 5 missing | unchanged |

The following claims are deliberately partial with no promotion of a whole acceptance point; this follow-up proves the named corrections, not every obligation of each broad clause.

CLAIM SLA-001 PARTIAL points=none tests=tests/journeys/inbox.mjs#SLA field conditions admit only fields readable by every current workspace role
CLAIM FORMS-001 PARTIAL points=none tests=tests/journeys/knowledge.mjs#a translated request admits typed conditional values and attributes its prior article view exactly once through replay; tests/journeys/workflows-browser.mjs#a lead adds a readable ticket field to a public request form with default permissions and an empty read-role list
CLAIM OUTBOUND-001 PARTIAL points=none tests=tests/helpers/inbox/new-ticket-configuration.mjs#newTicketConfigurationBrowser
CLAIM DESK-001 PARTIAL points=none tests=tests/helpers/inbox/new-ticket-configuration.mjs#newTicketConfigurationBrowser
CLAIM NATIVE-001 PARTIAL points=none tests=packet/owner-entry-probe.mjs#nativeOwnerEntryAndRecovery
CLAIM PUBLIC-005 PARTIAL points=none tests=packet/docs-proof.mjs#publishedDocumentationAttribution
CLAIM SOURCE-001 PARTIAL points=none tests=scripts/edition-authoring/cli.mjs#check

Base custody clarification: the refresh changed only the copy-provenance record, not the selected local source bytes. The record covers 990 files and preserves five acknowledged seed-owned adaptations. The offline check proves unadapted byte equality and the adapted files' acknowledged local hashes/modes; it does not describe adaptations as verbatim upstream copies.

## CI status
Verify run 43948782221, https://github.com/just-every/run-happytohelp/actions/runs/43948782221, is still in progress on exact head 5ab76253ed29375ff862a79ed5c2ee7f52a6abc2 at this interim evidence save. The branch is PUSHED, not READY. Only the final exact-SHA outcome can establish readiness. This report-only publication protects completed local work and is not a product acceptance or landing signal.
