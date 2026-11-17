2026-11-17 — Run Edit Run fleet

# Procedures list-read race

Repository: just-every/run-happytohelp
Branch: cloud/hh-procedures-race-2
Candidate: 48c4f14b9d36f1013440519e8b9f94a28055f572
Starting main: 55e2f106c506e4f671d2e474c737124e760e2233
WIP save: a9e2bd4bdb9fb9fc6ff9cac90266a0cdedf51580 (pushed with [skip ci]).
Revised candidate is pushed; Verify 44167863000 is completed/success on exact SHA 48c4f14b9d36f1013440519e8b9f94a28055f572. Previous candidate c706b09c67d6155151270a178d413b8eec4bf9e0 was pushed; its observed Verify run was 44165616563 (in progress at discovery; superseded by the read-transport fix).
Proof restarted from zero after a demonstrated read-transport failure in the first attempt. Revised candidate has its first complete pass; remaining passes are running. No READY claim yet.

## Plan and execution

1. Refresh the authorized fleet bundle; install the bundle-reading Git helper, push guard and clone-local forwarding/co-author-cleanup hooks. Clone only the declared product repository and create the named cloud branch.
2. Read the target registration, procedures browser helper, response-hold helper, native transport and actual procedures page. Inspect the contract/acceptance boundaries without editing clause judgments.
3. Begin with CPU-throttled, slowed-network baseline runs and Playwright traces. Obtain only bounded historical job/log/annotation evidence.
4. Hold actual native responses to test ordering, classify each demonstrated symptom and make a cause-level fix. Extend the existing journey without removing any original assertion, increasing a timeout or adding a fixed sleep.
5. Audit nearby Verify browser navigation/readiness patterns; change only demonstrated races.
6. Run typecheck, rer check, source lock/check, the touched registered journey and at least 20 consecutive passes under the same browser throttle. Use one heavy process at a time.
7. Push the named product branch through the fleet guard after inspecting every candidate identity/message. Require exact-SHA Verify; keep evidence transport separate from product custody. Leave landing and publication scanning to the fleet.

The cloud adaptation replaces heavy-slot/Mac load polling with direct commands in this dedicated VM. Browser load comes from CDP throttling of this run's own Chromium, never CPU-burn workers.

## What failed and why

Both controlled symptom classes are PRODUCT races. The initial list read and an explicit Refresh versions read could overlap. The page had an alive flag but no ordering token for list reads. Every completion could set versions and mark the list ready, even after a newer refresh or save had completed. The selected-receipt fetch already had an ordering token; the versions list did not.

| Controlled schedule on baseline | Before | Observable failure |
| --- | --- | --- |
| Hold the initial empty GET; start and hold a newer Refresh; release the older initial GET | 1/1 failed | A draft form appeared during the still-pending newer refresh: expected 0, actual 1. |
| Hold the initial empty GET; complete a newer Refresh; save refund Version 1 and see it; release the older initial GET | 1/1 failed | The visible saved-version button disappeared; locator.waitFor timed out after 30000 ms waiting for exact button refund · Version 1. |

These are actual native GET/POST responses, not fabricated application responses. The save POST returned 201, the fresh native list contained the version, and the later stale initial response contained the earlier empty list. This is loss of visible state, not loss of the immutable database row. The before receipts include sanitized native response ordering and final page state.

Baseline commands and harness details are in DIAGNOSTICS.md; the exact experiment helper and runner are included as race-reproduction.mjs and diagnostic.mjs. loading-before-receipt.json and save-before-receipt.json are actual experiment receipts.

Historical-cause limit: the unmodified current/historical helper passed all four completed spontaneous baseline runs (one at CPU rate 6 / 100 ms latency, three at CPU rate 6 / 250 ms). Two additional attempts failed before browser execution because the early repeat harness reused a fixture email; those are excluded from journey rates. The controlled schedules reproduce both reported symptom classes through ordinary refresh/save doors, but the historical logs do not establish that those CI runs used this exact interleaving. No spontaneous before-failure rate or direct historical trace match is claimed.

## Fix and regression coverage

src/ui/native/pages/ProcedureSettings.jsx now assigns an increasing generation to list reads. Only the newest generation can apply success/failure state. The list read following a committed save advances the same generation, and unmount invalidates it. An old response cannot finish a newer refresh, replace its saved list or apply a stale failure.

tests/helpers/ai/procedures-browser.mjs extends the existing registered journey:
- Deliver an older initial read while a newer Refresh is held; assert the draft stays unavailable.
- Keep another initial empty read pending across refresh and the first save; assert refund Version 1 remains visible after the old response arrives.
- Retain the original one-POST repeated-Enter assertion and add a native list count of exactly one after that save.
- Preserve all original save validation, comparison values, dirty-draft dismissal/confirmation, source definition/cases/tools/budgets, source snapshot/receipt retention, revision fresh-evaluation, configuration/provider failure, release refusal, role denial, focus, focus-ring and visible-feedback assertions.

Negative assertions follow requestfinished and browser rendering turns. No timeout was increased and no fixed-duration test sleep was added. Existing simulation polling conditions and intervals are unchanged. A demonstrated TCP reset during the first repeat attempt required one bounded Playwright read-only transport retry, described below.

## Proof and touched checks

The candidate's typecheck, source lock/check, rer check --profile first-party and git diff --check all returned exit 0. touched-checks.json records actual commands, start timestamps and exits. The emitted native build containing the guard completed successfully; subsequent commits change only the second regression, the read-only polling helper and their source lock.

The 20-run harness imports the actual workflows-browser.mjs registration 20 times and selects its exact existing test name. It also runs the registration's missingProviderProcedureBrowser path on every pass. Node 22.20.0 and system Chromium are used, with CDP CPU rate 6, 250 ms latency and bounded throughput. Native runtime creation copies a migrated empty state before any fixture seeding, giving every runtime its own state. Runtime queue/provider options and all test assertions are unchanged. Browser contexts and Workers close normally. Raw traces remain outside this public packet because they contain transient synthetic session headers.

Final result will be recorded in proof-20.tap and proof-20-receipt.json. A failure resets the consecutive-pass proof.

Registration counts: workflows-browser.mjs 10 before / 10 after; target journey 1 before / 1 after. No new registration or assertion removal. No full local suite.

## Neighbor audit and scope

NEIGHBOR-AUDIT.md records the source audit of training, advice procedures, triage, reply mode, tickets/workflow settings and HubSpot context. No other journey had a demonstrated equivalent race, and none was changed.

Only the procedures view, its existing browser helper and sources.lock.json are product changes. No release/version/tag metadata, pins, migrations, Base sources, sign-in/password/time-zone/widget-confirmation code, installation/company data, provider resources or deployed services were changed. Initial rer setup requested additional private local answers and exited 3; the emitted build and native isolated test runtimes do not use an installed owner's state. No live installation was configured.

CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md are unchanged. PROCEDURE-001 stays partial. This round retains synthetic initial-mode coverage of acceptance point 1; it does not qualify historical replay, operational context, live-provider quality or controlled production rollout.

CLAIM PROCEDURE-001 PARTIAL points=1 tests=tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release
GAP PROCEDURE-001: Existing historical replay, operational context and controlled production-release gaps remain; no clause judgment changes.
DEFAULT PROCEDURE-001: Preserve the approved synthetic-only initial mode and existing network-edge fixtures.

## Custody and API use

The WIP save, first candidate and revised candidate are pushed. A fresh main fetch after the revised push still matched the starting main. Product custody and report-only evidence publication remain separate. No PR or landing action is required by this checkout's AGENTS.md, and none was performed. No main/default-branch push, force push or published-history rewrite.

Seven GitHub calls used: four historical reads below and one exact-SHA discovery of the first candidate (run 44165616563).

Four historical GitHub calls:
1. Jobs for run 44094867861; support-workflow-browser job 134080357924 failed.
2. gh run view 44094867861 --repo just-every/run-happytohelp --job 134080357924 --log-failed returned exit 0 and zero stdout bytes.
3. Check-run annotations contained only a generic process exit (plus an actions runtime warning).
4. Historical helper contents at 4c86a426ccd1184b2be306de181a27ef85e767d3, byte-identical to baseline helper.

No blocked archive/download retries. Three calls remain; no further CI polling is needed for the unchanged successful candidate. The cloud cannot run the fleet's final publication scan; it makes no publication or landing claim.


## First proof attempt and read-transport repair

The first registered repeat attempt on c706b09c67d6155151270a178d413b8eec4bf9e0 passed three times and then failed on pass 4 with apiRequestContext.get: read ECONNRESET while polling the provider-error simulation receipt. Its UI ordering checks had passed. The actual sanitized failed-attempt log is proof-first-attempt.tap. That attempt does not satisfy the proof; it was stopped and the consecutive count reset to zero.

The procedures helper now centralizes its read-only API calls with Playwright maxRetries: 1. The installed implementation and API documentation restrict this option to ECONNRESET; it does not retry HTTP failures, other transport errors, assertion failures or any POST. This follows the real receipt state after a pooled connection closes and keeps every business assertion intact. It has a bounded framework transport backoff, rather than a test sleep or a timeout increase.

The revised proof uses the same CPU/network settings and a separate copy of the empty, migrated snapshot prepared before fixture seeding in the first attempt. Every runtime remains isolated. Raw runner logs are now kept outside the packet and copied into sanitized public receipts so Playwright error diagnostics cannot publish synthetic session headers.


## Tool reconnect during the revised proof

The attached runner was terminated with signal 9 during a tool-environment reconnect after 6 completed passes and no assertion failures. Its original PID was a zombie; an initial start-time-only check incorrectly suggested it remained live, and a subsequent process-state check corrected that assessment. This interrupted prefix is retained in proof-interrupted.tap and interrupted-proof-receipt.json and is not counted as a completed 20-run proof.

The same unchanged candidate is now tested in its own detached session under cloud_run. The launcher writes an actual exit-code receipt after the full node:test process ends. Raw runner diagnostics stay outside the packet; public TAP receipts redact synthetic session headers. No product code or test assertion was changed for this restart.

Exact-SHA CI receipt: run 44167863000 completed/success, checked via the Actions REST API at the timestamp in ci-final-receipt.json. The head_sha equals the pushed candidate exactly. No generated-view exception or rerun was used.
