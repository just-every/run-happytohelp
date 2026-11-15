# HappyToHelp slow delegation repair — hh-slow-delegation-1

## Plan and scope

Follow `PLAN.md`. Reproduce the existing slow journey before changing it; inspect the visitor UI; adapt only its email-entry precondition; audit other installer paths; preserve every existing assertion and test registration; update the source lock last; run touched checks and exact-SHA Verify; publish reports only on the evidence ref. No product behavior, contract judgment, release metadata, upgrade baseline, scanner configuration, tag or version change is authorized or included.

## Before

At task start origin/main was `837b8cbe2279c20c0054c7bf1970a13fa7b2597a` (v0.4.29), matching the reported failing tag Verify **43738159465**. The brief reports identical failures on attempts 1 and 2; the reported prior good tag run was **43656400070** at v0.4.28 (`41fb4024`). These historical IDs are supplied context, not new API observations.

The dedicated cloud VM ran the workflow's exact command, `pnpm run test:installer-nightly --test-name-pattern=agent.fix`, through `cloud_run node scripts/ci/run-checks.mjs` with one test worker. It failed with the identical 30-second wait at `browser-ui.mjs:16` for the operator transcript's Spanish-store report. The target journey failed after 275791.932 ms; the Node runner reported 2 passes (filtered file entries), 1 failure, duration 279687.807 ms. See `before.log`, `before-receipt.json`, `before-browser-result.json` and `before-browser-failure.json`.

The initial VM entry Node was 24.19.0; rer setup selected the repository's supported Node 22.20.0. After this reproduction all further commands explicitly use rer's installed exact Node 22.20.0 and pnpm 10.12.4. Chromium is `/usr/bin/chromium` with `--no-sandbox`. No live provider or customer installation was used.

The first external click listener did not retain a browser snapshot. A one-off supported rer dev probe reused the retained disposable installation; diagnostic capture needed corrections for the exact existing error text and ShadowRoot serialization. The final probe passed: after Send the visitor showed an empty email field, **“Please enter a valid email address”**, and the report still in the composer. It observed **zero message POST requests**. The state and screenshots at 1440 and 390 are in `before-probe/`; `before-probe.log` records the successful observation. Only synthetic task-created data is included.

## Cause and change

`publicContact` (`src/modules/management/provisioning/public-contact.ts:11`) now provisions `widget_settings.settings.collect.require_email=true` for fresh workspaces. `withInstallationContact` (`src/modules/public-site/installation-contact.ts:26`) also mounts public Help with `requireEmail:true`. `SendMessage` (`src/modules/widget/js/SendMessage.jsx:39`) refuses the empty required email before calling the message sender. The stale visitor helper filled only the report and clicked Send, then the test waited for an operator message that had never been submitted. This is intended product behavior, not a product defect.

Add exactly one line to `tests/helpers/delegation-journey/browser.mjs`: fill `input[name=email]` with `visitor@example.test` before filling and submitting the report. This follows the established `tests/helpers/first-run/outcomes.mjs` pattern. No email ask is disabled. Every assertion in `case.mjs`, `browser-ui.mjs` and the visitor's socket/reload checks is retained. No test is added. `sources.lock.json` changes only this helper's hash.

Main advanced to `a7e05db8c6b5787328d56657453f551229d57405` during reproduction. The unpublished cloud branch was rebased to that main before candidate testing. Its newer product changes are retained; the delegation helper is unchanged between the two main SHAs.

## Other journeys

See `JOURNEY-AUDIT.md` for the file-by-file audit. The slow delegation browser journey is the only affected anonymous fresh installer widget submission. Other installer journeys use APIs with email or have no widget form. The ordinary hero and widget-identity browser flows use directly seeded tenants without fresh-owner contact provisioning. First-run and brand browser outcomes already enter email. The optional configured live-provider journey also lacks email entry, but no disposable configuration was supplied and live installations/provider work is explicitly out of scope; it is reported for the lane and is neither run nor modified. Release-upgrade baselines remain untouched.

## After and custody

The exact slow command passed: target journey **263467.682 ms**, Node runner **3 passed / 0 failed**, total **267404.710 ms**. `after-receipt.json` records Node **22.20.0**, pnpm **10.12.4**, runtime base `a7e05db8c6b5787328d56657453f551229d57405`, and SHA-256 identities of both tested working-tree files. `custody-receipt.json` proves those bytes are identical to the committed files. `after-browser-result.json` records `success=true`, `cleanupSucceeded=true`, real fresh install and automatic owner entry, three completed delegation jobs, one fixture mutation, independent readback and one human reply. Every prior assertion, one-socket-delivery and reload-persistence check passed. Screenshots retain all fourteen existing 1440px operator/visitor views plus two 390px step-a views; the screenshot-only external wrapper restored 1440 before continuing, without adding a test matrix or changing application requests/assertions.

Required local checks all exited 0: `pnpm run typecheck`, `pnpm exec rer check --profile first-party`, `node scripts/edition-authoring/cli.mjs check`, both existing contract-docs checks, and `git diff --check`. See `touched-checks-receipt.json` and `touched-checks.log`. The source lock was regenerated after the sole tracked helper edit and changes only its hash. No generated view was committed.

Final candidate: **cloud/hh-slow-delegation-1 @ 85bd29235181c90e7626cbebb6c1fe6b2564756d**, one product commit, two changed files (2 additions, 1 deletion). Main was fetched again before commit; it remained `a7e05db8...`. The final pre-push rebase was a no-op. Fleet identity, complete messages and trailers passed inspection; hooks remained active. The first guarded push succeeded. No PR is required by the repository rules and none was created. The product checkout is clean, and a separate `git ls-remote` confirms the named product branch advertises this exact SHA (`product-remote-ref.txt`).

Exact-SHA push [Verify **43747400009**](https://github.com/just-every/run-happytohelp/actions/runs/43747400009) completed with **success** on **85bd29235181c90e7626cbebb6c1fe6b2564756d**, observed at 2026-11-15T19:08:28.538884+00:00. This is an actual green workflow; no generated-view exception is used. Seven CI REST calls were used, all observations at least 300 seconds apart; no failed-job log call or other-SHA green result was used. `ci-receipt.json`, discovery and six poll records retain the actual responses.

Product custody is **READY** on the named cloud branch. No blockers remain. The product has not been landed or pushed to main. The fleet's publication scan and landing are performed by its own machine. Evidence is separately published through the mandated report-only entrypoint to `refs/heads/evidence/hh-slow-delegation-1`; the exact evidence commit is returned in the terminal report and verified by the receiving fleet. Evidence publication itself carries no product acceptance or landing claim.

The successful journey removed its own private scratch checkout and closed its browsers/server. The failed baseline scratch checkout was removed after retaining the non-secret failure evidence and successful visitor probe. Product clone, packet and receipts are preserved outside disposable runtime scratch.

## Counts and clauses

Existing installer registrations: **5 → 5**; new tests: **0**. Target journey: **1 failure before**, **1 pass / 0 failures after**. No clause status changes, no DONE flip and no new gate. Contract counts remain **4 done / 71 partial / 16 missing / 91 total** (published 2/24/0/26; target-and-push-further 2/47/16/65). `DELEGATION-001`, `UI-001`, `FIRST-RUN-001` and all newer main judgments remain unchanged.

Signed 2026-11-15T19:08:59Z — Run Edit Run fleet.
