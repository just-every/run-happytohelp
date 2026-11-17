# HappyToHelp setup Verify repair

Run Edit Run fleet, 2026-11-17 UTC.

Repository: just-every/run-happytohelp. Branch: cloud/hh-owner-design-setup-1-c1.
Parent: 4fd4965485351d1a45dd10f8e1b3ba69ea78afc1.
Final product SHA: 64f10a3948135a164d878c7313be6c45aafacf8f. Exact-head Verify: 44107579411, completed/success, confirmed at 2026-11-17T15:27:34Z. All 14 selected jobs succeeded and two non-selected jobs were skipped. Both repaired browser shards are green. No retry was required.

## Result and scope

The two failures from parent Verify 44090438878 reproduced independently on this cloud runner. Both are category (a): test structure assumptions invalidated by the parent’s deliberate D12 navigation and D6 developer hand-off decisions. No product regression or timing flake is needed to explain either result. DIAGNOSIS.md contains the exact failure locations, public-door guarantees preserved and the original log-retrieval limitation.

Only tests/helpers/first-run/outcomes.mjs, tests/helpers/ai/procedures-browser.mjs and the regenerated sources.lock.json belong to this repair commit. All parent product decisions and application files are retained. No release/version/tag metadata, pins, migrations, Base refresh, sign-in, password, time-zone, widget-confirmation code or CONTRACT.md judgment is changed. No new product wording or behavior claim is introduced. All tests use isolated synthetic tenants and network-edge fixtures; no live provider or installation is exercised.

## Reproduction and repair

| Journey | Before | Cause | Repair | After |
| --- | --- | --- | --- | --- |
| a first owner and a signed-in owner reach Setup and install a working widget | Server secret heading timeout, 20 seconds | Global Advanced click finds the newly added Settings navigation before the widget controls load | Wait for and open .widget-code__advanced > summary; retain all subsequent assertions | See candidate-identity.tap |
| a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release | Expected 0, actual 1 at procedures-browser.mjs:138 | Blanket pre count includes intentionally collapsed developer instructions | Continue to reject pre blocks outside the hand-off, preserve raw-error and result exclusions, and exercise real mailto/clipboard/fallback controls | See candidate-procedures.tap |

The procedure failure is deterministic in the missing-provider receipt. It is not the refund Version 1 flake mentioned in the brief, and no main comparison or flaky-shard rerun is needed for a category (a) diagnosis.

Both existing registrations are retained. The identity browser file has 6 registrations before and after; workflows browser has 10 before and after. The two selected journeys remain 2, with no added, removed or skipped registration. Before/after failing selected journeys: 2, then 0. Both corrected journeys passed in full, including the additional local email and missing-provider workspace helpers. Contract status counts remain 4 done, 71 partial and 16 missing; no clause status changes.

## Commands and validation

The toolchain was sourced for build/test commands. They use repository Node 22.20.0 and pnpm 10.12.4; headless Playwright uses /usr/bin/chromium and the existing helper’s --no-sandbox switch. Long-lived commands run through cloud_run. The installer was completed with a private local answers file, mail off and AI deferred; no generated value is part of this packet. Early installer attempts requested missing fields or refused an out-of-checkout answers path; the corrected contained file completed setup.

- npx -y @runeditrun/rer setup --owner-email fleet@runeditrun.com --non-interactive --answers .hh-setup-answers.json
- npx -y @runeditrun/rer build
- node --test --test-concurrency=1 --test-name-pattern='a first owner and a signed-in owner reach Setup' tests/journeys/identity-browser.mjs
- node --test --test-concurrency=1 --test-name-pattern='a lead compares saved procedure definitions' tests/journeys/workflows-browser.mjs
- pnpm run typecheck
- pnpm exec rer check --profile first-party
- node scripts/edition-authoring/cli.mjs lock, run after tracked edits
- node scripts/edition-authoring/cli.mjs check

The two selected journeys ran separately before the changes, then separately with the corrected tests. Full local verification was not run; branch Verify is the full check. Typecheck, rer check, source lock/check and both selected journeys all passed. Checks and actual exits are saved in receipt.json and their selected log files. The publication scan and landing remain the fleet’s independent gates on its own machine.

## Browser proof

The existing first-run journey captures first-owner Setup, widget Advanced, signed-in Setup and the installed customer widget at 1440 and 390. The procedure repair also captures the blocked receipt at those two widths. Assertions stay at 1440 except existing checks whose purpose is the phone header; the second width captures proof only. Images contain isolated synthetic data and masked server-secret controls.

Relevant names:

- screenshots-candidate/first-run-outcomes/first-owner-setup-{1440,390}.png
- screenshots-candidate/first-run-outcomes/widget-advanced-{1440,390}.png
- screenshots-candidate/first-run-outcomes/signed-in-setup-{1440,390}.png
- screenshots-candidate/first-run-outcomes/installed-widget-{1440,390}.png
- screenshots-candidate/procedures/procedures-blocked-{1440,390}.png

No application UI changes occur in this repair. The proof demonstrates the original decisions and preserved public-door behavior with the corrected journeys.

## Publication and claims

Main was fetched and reconciled before publication, retaining the linear parent history. Every candidate author, committer and trailer is inspected before the guarded product push. No main/default branch push or PR change is requested. The guarded product push succeeded on its first attempt. The remote head matches the tested candidate; the overall Verify run is completed/success on that exact SHA. Ten task GitHub calls were used. There are no blockers and no PR was created. CI-RESULTS.md and ci-jobs.json include the successful repaired shard IDs. Product custody and evidence-ref publication are reported separately.

CLAIM FIRST-RUN-001 PARTIAL points=1 tests=tests/journeys/identity-browser.mjs#a first owner and a signed-in owner reach Setup and install a working widget
CLAIM PROCEDURE-001 PARTIAL points=1 tests=tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release
GAP FIRST-RUN-001: No configured paid-provider qualification is claimed by this test repair.
GAP PROCEDURE-001: Historical replay, controlled live rollout and held-policy provider qualification remain outside this repair.

PLAN.md is the complete plan; DIAGNOSIS.md records the causes; receipt.json records terminal checks and provenance. Evidence is published only to evidence/hh-owner-design-setup-1-c1, separately from the product branch.

READY branch=cloud/hh-owner-design-setup-1-c1 head=64f10a3948135a164d878c7313be6c45aafacf8f
