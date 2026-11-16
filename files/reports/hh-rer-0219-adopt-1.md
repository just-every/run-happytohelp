# HappyToHelp: rer 0.2.119 and independent contract-docs verification

Result: **READY**. The combined product candidate is pushed. Exact-SHA Verify [43847690039](https://github.com/just-every/run-happytohelp/actions/runs/43847690039) was last observed **completed / success** at 2026-11-16T11:28:54.761717+00:00.

Tag: hh-rer-0219-adopt-1  
Repository: just-every/run-happytohelp  
Branch: `cloud/hh-rer-0219-adopt-1`  
Head: `2044dfa31d6b5e43dea1224bca08e0b509e48396`  
PR: none; the supplied seed landing rules do not require a PR for this branch handoff.  
Blockers: None for this candidate. The fleet still performs its independent publication scan, integration checks and landing on its own machine.

## Before and after

| Item | Before | After |
| --- | --- | --- |
| @runeditrun/rer | 0.2.117 | 0.2.119, exact dev dependency |
| Base copy pin | 47a3a3f3300dd861fa9d05fa33a88f1e7b73e7d8 | bbab5d84b72e333ff1e9a6f234c0512e5721b1d9 |
| Base copy records | 437 | 437 |
| Recorded copied files | 988 | 990 |
| Verify job definitions | 8 | 9 |
| Push shards | 8 | 8 |
| Core: done / partial / missing | 4 / 71 / 11 | 4 / 71 / 11 |
| Agent surface: done / partial / missing | 0 / 0 / 5 | 0 / 0 / 5 |
| All: done / partial / missing | 4 / 71 / 16 | 4 / 71 / 16 |

All 91 clause statuses and text are unchanged. CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md are byte-identical to the main baseline. Product version 0.4.31, release metadata, applied migration bytes, release-upgrades baseline, size-check.json, scanner configuration and product tests are unchanged. Seed-owned source was preserved; upstream copy changes came only from the official refresh.

## Full execution plan

1. Configure the fleet's global and clone-local identity, decrypted-bundle Git helper, push guard and commit hooks. Read launcher and seed instructions and capture baseline pins, counts, adapted-source hashes and protected-source identities.
2. Install the exact rer 0.2.119 package at the seed root. Refresh Base through the installed official CLI at the immutable full commit with `--from-api`; do not clone another repository.
3. Move both existing contract generator commands into an independent checkout/install job. Preserve build, matrix, size, slow and proof job behavior, and require the new job explicitly in the aggregate Verify gate.
4. Stage the two newly copied sources and regenerate the source lock after all tracked edits. Check installed-package and seed lock readers, local copy identities, both generators, typecheck, first-party checks and the external job-graph comparison. Run rer verify as requested; resolve a local fixture environment failure through a pinned-Node isolated retry, with no product/test edits.
5. Fetch fresh origin/main, commit the combined candidate with explicit fleet author/committer environment, rebase before the first publication and inspect every candidate identity, full message and trailer. Push only the named branch through the prescribed guard as soon as the first real commit exists.
6. Discover the exact-SHA Verify and observe it at least 300 seconds apart within the task-level API budget. After its cancellation, request only the last active import-and-reports job and dependent gates again on the same SHA; reserve the terminal observation until its timeout window plus queue/gate allowance has passed. Keep all checks intact.
7. During the CI wait, capture and inspect actual refreshed local-auth handler output at 1440 and 390. Keep all non-secret plan/report/receipts outside the product checkout, explicitly select the complete packet and publish it through the separate evidence branch. Return exact product/evidence custody and signed hh/sd inbox lines.

PLAN.md retains the initial plan and execution adjustments. No default branch, tag, PR, live installation, customer data, DNS, mail, AWS or public application was changed. No paid model API was used.

## rer adoption and Base refresh

`pnpm add --save-dev --save-exact @runeditrun/rer@0.2.119` changed only rer's package and pnpm lockfile entries. The installed official command was:

```sh
pnpm exec rer refresh-base --ref bbab5d84b72e333ff1e9a6f234c0512e5721b1d9 --from-api
```

It completed successfully after validating immutable commit/tree/blob identities through the official provider reader. The target inventory contains 4,823 blobs. No other repository was cloned. The complete actual output is in refresh-base.log; refresh-summary.json is the compact receipt.

All 437 copy records advanced to the requested target. Two copied files were added: `src/vendor/agent-base/modules/agent-door/policy-event.ts` and `src/vendor/agent-base/modules/operator-auth/dev/invited.mjs`. None were removed, retired, relocated or withheld. No edition migration or workflow template adoption was requested.

All five existing seed adaptations were retained without upstream conflict. The four adaptations outside Verify remain byte-identical. The seed-owned Verify adaptation was explicitly reacknowledged after the requested job edit. The refresh reported a React advisory (seed 19.2.8 versus Base 19.3.1) for unchanged hydration copies; the seed pin was retained within this scope. Miniflare and Wrangler pins already match Base.

The source lock was regenerated last with `node node_modules/@runeditrun/rer/edition-authoring/cli.mjs lock`, after the newly copied sources were staged. Installed and seed source checks both passed. The offline copy check binds local bytes to recorded SHA-256; it does not independently acquire origin. Immutable API acquisition in the refresh supplies the upstream origin evidence.

## New Verify graph

The `contract-docs` job has no `needs` or selection condition. It checks out full history, installs pinned Node 22.20.0 and pnpm 10.12.4 with frozen dependencies, and runs both original commands unchanged:

- `node src/site/base/contract-docs.mjs check`
- `node scripts/contract-docs.mjs check`

Build retains its plan dependency, source-lock check, typecheck, first-party check, build, light readers, artifacts and source-preservation checks. All eight shard definitions, size selection, slow workflow and push/nightly proof jobs are unchanged. Aggregate Verify adds contract-docs to `needs`, retains `always()`, and requires its result to equal success before the existing gates.

The external YAML job-graph check compares all retained jobs with the baseline, allowing only the two moved build steps and added aggregate gate. It verifies the new gate rejects failure, skipped and cancelled outcomes. There is no dependency path from contract-docs to build or selected shards. A clause-text candidate selected for full coverage therefore still runs its shards when stale generated views fail the independent job. Existing light/reuse selection is retained. No clause was changed to manufacture a failing CI run; this conclusion is from the graph.

The actual candidate run also demonstrates independence: contract-docs ran 10:18:44–10:19:17 UTC, while build started at 10:18:58, before contract-docs finished. The job layout receipts and actual comparison script are included. [Immutable workflow](https://github.com/just-every/run-happytohelp/blob/2044dfa31d6b5e43dea1224bca08e0b509e48396/.github/workflows/verify.yml).

## Validation results

| Check | Actual result |
| --- | --- |
| Installed-package source check | exit 0 |
| Seed CI source check | exit 0 |
| Offline Base-copy byte check | exit 0 |
| Shared contract-docs check | exit 0 |
| Seed contract-docs entry point | exit 0 |
| Typecheck | exit 0 |
| First-party check | exit 0 |
| Workflow graph and aggregate negative-state checks | passed |
| Index/worktree whitespace checks | passed |
| Existing email journey, direct Node 22.20.0, concurrency one | 2 passed; 0 failed; exit 0; 601.32 seconds |
| Refreshed-handler browser proof | passed at 1440; separate inspected 390 captures |
| Broad local rer verify attempt | stopped with exit 130 after one environment-specific cleanup failure; not a full local pass |
| Exact-SHA GitHub Verify | completed / success |

The broad `pnpm exec rer verify` attempt recorded 51 passing tests, one failing test and 11 cancellations. Its original failure was `Journey server PID has no owned control socket` at `tests/helpers/rer-command.mjs:17`, during `tests/helpers/email/local-mail.mjs:144` cleanup. The supplied toolchain accepted newer VM Node 24 for package scripts, while rer re-executed its command under Node 22, changing the fixture's tracked child PID. The exact-head CI assistant-and-knowledge shard passed the same email test under Node 22.20.0. The isolated local retry under the exact pin also passed both tests. No test or product source was patched to mask this failure.

Only the recorded owned rer verify PID was interrupted after that known failure and successful CI evidence. Every recorded descendant exited. All later browser fixture pages, browser processes and server were closed. The actual full-attempt, stop and pinned-Node retry receipts/logs are included; no full local rer verify pass is claimed.

## Exact-SHA CI and recovery

Run ID: **43847690039**, bound to `2044dfa31d6b5e43dea1224bca08e0b509e48396`. Discovery and all observations used the prescribed REST endpoints, at least 300 seconds apart. The initial attempt ended **completed/cancelled**. Its jobs receipt had contract-docs, plan, build, size-check and seven push shards completed successfully; import-and-reports was the last observed active shard. No assertion failure or timeout cause is invented from that cancellation.

The existing import-and-reports job 133232682548 and its dependent gates were re-requested through the supported rerun-job endpoint. GitHub accepted the request with **HTTP 201 at 2026-11-16T10:57:07 UTC**. The product SHA, workflow and tests were unchanged. The final API read was reserved until after that job's 30-minute window plus queue/gate allowance. Its actual terminal observation is **completed / success at 2026-11-16T11:28:54.761717+00:00** on the same SHA.

The budget receipt counts task-level gh invocations, including the extra source-inventory query; the mandatory official refresh performs its own immutable source acquisition. No required check, input or publication scan was disabled. The actual ci-*.json receipts preserve all observed states and the accepted rerun request.

## Browser proof of refreshed local-auth outputs

Six actual Chromium captures exercise the candidate's copied upstream handler outputs with the unchanged seed theme. Each state is recorded once at 1440 and 390; assertions run at 1440 only. Chromium is `/usr/bin/chromium` with `--no-sandbox`.

| Handler state | Desktop | Phone |
| --- | --- | --- |
| Owner-only gate: invitation hint absent | [1440](browser/gate-owner-only-1440.png) | [390](browser/gate-owner-only-390.png) |
| Invited-person gate: invitation hint present | [1440](browser/gate-invited-1440.png) | [390](browser/gate-invited-390.png) |
| Refused local one-click: readable 404 text | [1440](browser/one-click-refused-1440.png) | [390](browser/one-click-refused-390.png) |

The captures were visually inspected. This is renderer-fixture evidence using test-only inputs; the refusal case injects an AuthError through a fixture account adapter. It does not establish a native workspace journey, a live owner entry or hosted installation. The three copied implementations of each handler are byte-identical (browser-source-identities.json). The actual script and receipt are included. No UI source or product test was edited for this proof; no clause promotion follows.

## Product and evidence custody

Fresh main before publication was `e5fb53dc305f53a71ff0b6db81d5eec7dfd0104f`. There were no new main commits and the pre-publication rebase was a no-op. One combined product commit was created with explicit fleet author and committer environment. Every candidate identity, full message and trailer was inspected after rebase: fleet identity in both roles, no trailers or co-authors. Commit hooks remained active. The guarded named-branch push succeeded on its first attempt. A post-save main fetch also showed no newer commits at that time. Published history was never rebased, amended or force-pushed.

The product checkout is clean and all evidence stays outside it. The report-only evidence transport targets `refs/heads/evidence/hh-rer-0219-adopt-1` and leaves the product head and index unchanged. Its exact published head is returned separately in the final EVIDENCE line. Evidence publication does not signal acceptance or landing; the fleet's independent publication scan and integration/landing checks remain its own responsibility.

Clause changes: **none**. Before/after totals: **4 done, 71 partial, 16 missing; 91 total**.

Signed 2026-11-16T11:29:20Z — Run Edit Run fleet.

READY branch=cloud/hh-rer-0219-adopt-1 head=2044dfa31d6b5e43dea1224bca08e0b509e48396
