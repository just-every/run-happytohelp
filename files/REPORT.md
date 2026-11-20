# HappyToHelp nightly legacy-export build

Run Edit Run fleet · 20 November 2026

- Repository just-every/run-happytohelp
- Product branch cloud/hh-ci-legacy-export-build-1
- Candidate 1ffe9e063072f94e01a5d116f20b2317ca824b77
- Sole parent d845c2095b61a69df817205a43b612b0c8ec01f3
- Historical failure [Verify 44676928798](https://github.com/just-every/run-happytohelp/actions/runs/44676928798)

## Plan and results

1. Reproduce the nightly failure before building. On a clean checkout at d845c2095b61a69df817205a43b612b0c8ec01f3, node --test tests/legacy-export.mjs ran against an isolated loopback MySQL 8.4.13 service. It exited 1 after 330 seconds at createRuntime, called by nativeReaders. The error was error: "ENOENT: no such file or directory, open '[checkout]/dist/server/wrangler.json'".
2. Review scheduled and reusable workflows and the CI command inventory for other emitted Worker consumers. The push Verify shards restore the shared build. Among the slow journeys, release-upgrades already builds the current checkout, installer tests build or serve fresh checkouts, scale fixtures bundle their own Workers, and configured-live-provider tests a separately configured installation. The missing build was in legacy-export.
3. Insert pnpm run build between the frozen install and test in legacy-export, matching release-upgrades. Regenerate the lock after the workflow edit. The commit audit verified the single workflow step and its SHA-256 pin. The source-lock check exited 0 and pnpm run typecheck exited 0 from the candidate. [Workflow](https://github.com/just-every/run-happytohelp/blob/1ffe9e063072f94e01a5d116f20b2317ca824b77/.github/workflows/installer-journeys.yml#L161)
4. Run the build and failing test from the candidate. pnpm run build exited 0 in 38 seconds and emitted dist/server/wrangler.json. The legacy-export command exited 0 in 565 seconds. TAP reported one passing test, with native-reader results for both fixture projects. Build and test took 603 seconds total against the 900-second job budget.
5. Publish the single-commit candidate and check the exact head. Git advertised the candidate at the product branch on 2026-11-20T10:46:07Z. Push Verify was completed / success, run 44722002329 (https://github.com/just-every/run-happytohelp/actions/runs/44722002329). The workflow_dispatch request targeted Verify on the candidate branch with tier=nightly. GitHub returned HTTP 204. Nightly Verify was in_progress, run 44722005322 (https://github.com/just-every/run-happytohelp/actions/runs/44722005322). The exact-head legacy-export job reported success (job 136239974668). Both the build and the export test steps passed. The hosted job took 466 seconds.

## Push Verify jobs

- plan (136239822539) — success
- contract-docs (136239823071) — success
- build (136240022640) — success
- slow (136240025886) — skipped
- size-check (136240626488) — success
- Verify / support-and-recovery (136240626505) — success
- Verify / import-and-reports (136240626583) — success
- Verify / identity-and-desk (136240626585) — success
- Verify / identity-and-repair-browser (136240626614) — success
- Verify / public-and-import-browser (136240626640) — success
- Verify / support-workflow-browser (136240626665) — success
- Verify / connections-and-computers (136240626673) — success
- Verify / assistant-and-knowledge (136240626914) — success
- nightly-proof (136241922634) — skipped
- full-push-proof (136251898901) — success
- verify (136251946107) — success

## Nightly dispatch jobs

- plan (136239840166) — success
- contract-docs (136239840590) — success
- build (136239974225) — success
- slow / Installer / delegation-fresh-clone-browser (136239974660) — success
- slow / legacy-export (136239974668) — success
- slow / Installer / import-and-report-scale (136239974738) — success
- slow / Installer / release-upgrades (136239974744) — in_progress
- slow / Installer / offline-deployment-preflight (136239974761) — success
- slow / Installer / portable-installation-compatibility (136239974784) — in_progress
- slow / Installer / reproducible-build (136239974799) — success
- slow / Installer / readme-clone-and-restore (136239974801) — in_progress
- slow / Installer / native-command-and-portability (136239974817) — in_progress
- slow / Installer / configured-live-provider (136239975004) — success
- size-check (136240680065) — success
- Verify / ${{ matrix.name }} (136240682982) — skipped
- full-push-proof (136242115244) — skipped

## Contract and test counts before and after

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 4 | 71 | 11 | 86 |
| Agent surface | 0 | 0 | 5 | 5 |
| Later | 0 | 0 | 0 | 0 |
| Full target | 4 | 71 | 16 | 91 |

Clause status changes and test registrations added or removed were zero. The workflow repaired the CI path for evidence associated with MIGRATION-001.

CLAIM MIGRATION-001 PARTIAL points=none tests=tests/legacy-export.mjs#project snapshot → attachment bytes → native import → safe replay → delta sweep since the watermark

The fleet lander owns the full publication scan and main landing. The cloud candidate diff was checked for exact change scope and whitespace.

## CI follow-up

The final push status and job list used the remainder of the ten-call GitHub budget. The hosted legacy-export job completed successfully. Other installer jobs were still active at the last nightly observation.
