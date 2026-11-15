# HappyToHelp hh-slow-delegation-2

Builder: Run Edit Run fleet. Repository: just-every/run-happytohelp. Branch: cloud/hh-slow-delegation-2. Scope: test-only correction; no product change and no independent product-change gate requested.

## Before

The failing v0.4.30 tag Verify is run 43764365668 at efea73943b4995e951aa9c2e7a2577eaacfd5042, slow / Installer / delegation-fresh-clone-browser job 132966101228. Current origin/main was that same SHA when cloned.

The dedicated cloud reproduction used the supported direct cloud replacement for the heavy-slot command: `cloud_run pnpm run test:installer-nightly --test-name-pattern=agent.fix`, Chromium `/usr/bin/chromium` with the repository's no-sandbox launch option, one journey at a time. It failed with the original assertion `one visitor socket delivery did not reach its expected state` in 289886 ms. Only non-secret frame metadata was instrumented; all assertions and production code remained unchanged, and the fresh-installed app clone stayed at the main commit. See before.log, before-socket-probe.json, before-browser-result.json and probe-instrumentation.py.

Observed at 1440: two independent visitor WebSockets to conversation 07ca0414-4de7-47d7-a392-302a0de373ea. Each delivered visitor message 0548677d-2c2e-4681-bae6-d282d4295027 (event 1) once and operator message 80499855-5d24-4717-a7cf-9aca3d8cdc4e (event 2) once. Thus the page listener counted **two** frames for that operator message. The reply rendered **once**. The reply reached the visitor over both sockets; this was neither missing delivery nor a polling-only recovery.

## Cause and change

This is a stale test mount. Commit 5c2b3857eb596d3fcf1e56c41ad37dd24d05a7d7 introduced withInstallationContact and its native widget script on the installation's help page. The journey still injected `/widget.js` and initialized another widget after visiting that page. Separate evaluations of the IIFE each own a widget entry/React root/transport; the test consequently listened to two sockets for the same stored session. The before probe confirms one delivery per socket. The relevant widget transport, entry and mounting sources are byte-identical between 41fb4024 and current main; source-comparison.txt records the source comparison. No broader bisect is necessary after locating the second mount.

The correction waits for the help page's own `window.h2h` API and opens that existing widget, both on the initial visit and after reload. The visitor still supplies the required email. Every existing assertion is retained, including exactly one matching socket frame, exactly one rendered reply and exactly one reply after reload. The existing browser result also records non-secret socket/frame/render counts to make a future failure inspectable. No journey or test registration is added.

## Plan

The complete plan is PLAN.md: reproduce main with frame metadata; compare the known good baseline; correct the cause; run the existing target and relevant socket/widget journeys plus typecheck and source/first-party checks; refresh main and regenerate the source lock last; publish only the named branch after identity/message review; observe exact-SHA Verify through the bounded REST budget; return the complete non-secret packet through the separate evidence ref. No release metadata, tag, pin, migration, scanner or live-account change is authorized.

## Results and terminal provenance

The known-good baseline 41fb40246d2e69f928be397c48d952d147c39160 passed the identical existing journey plus the non-secret probe in 258311 ms: one socket, one frame for operator message ebb50fd6-dce5-4f5c-86ce-504312cd6641 (event 2), one rendered reply and a passing reload assertion. See baseline.log, baseline-socket-probe.json and baseline-browser-result.json. This agrees with the supplied known-green v0.4.28 Verify run 43656400070.

The main reproduction and baseline use the same pnpm 10.12.4 and VM Node v24.19.0 (the supplied toolchain selects its requested Node version only when the VM is older); exact-SHA GitHub Verify uses the repository's Node 22.20.0. The baseline probe changes diagnostics only. The candidate preserves the existing single asserted 1440 viewport and all existing test registrations; there is no product UI change requiring a second assertion width.

The corrected current-main worktree journey passed in 227752 ms (after.log): operator message d8ba3132-47fd-4713-8a7d-fcb47c61f434 arrived in one socket frame (event 2) and rendered once. The reload assertion passed. after-browser-result.json records success, successful cleanup, every completed delegation and non-secret socket delivery metadata. Before/after counts are sockets 2 → 1, operator frames 2 → 1, rendered copies 1 → 1; the one admitted operator message and fixture mutation remain unchanged.

The additional existing journeys passed 3/3 in 423931 ms: delegation-browser.mjs (paired computer/article proposal, Use/Send, visitor delivery and reload); runtime.mjs (native live delivery, files, foreign/stale refusal, durable cursor catch-up, Worker restart and connector pairing); widget.mjs (visitor/teammate durable replay, authority and revocation). These were serial, not a broad slow-tier rerun. Build, typecheck, regenerated source-lock check and first-party check also passed; local-checks.json links their full logs and hashes.

A final fetch/rebase found main unchanged at efea73943b4995e951aa9c2e7a2577eaacfd5042. The lock was regenerated last and rechecked. Commit bc12fd6c76c6e66d73c04e8e4733976656627589 changes only tests/helpers/delegation-journey/browser.mjs and its sources.lock.json hash. All candidate author/committer identities and complete messages/trailers were inspected; the single commit has the fleet author/committer and no trailers. The guarded push succeeded on attempt 1, and Git ls-remote independently confirmed the exact branch head. See product-receipt.json and push.log. No PR is required by this repository's instructions; no PR was created.

The exact committed-head fresh-clone rerun also passed: `cloud_run pnpm run test:installer-nightly --test-name-pattern=agent.fix`, 242529 ms for the target journey, all assertions retained, successful browser/server cleanup. See exact-after.log and exact-browser-result.json; screenshots/ contains all seven operator/visitor steps at the existing 1440 assertion width. The committed source was bc12fd6c76c6e66d73c04e8e4733976656627589 throughout the run. Its fresh-installed app now came from that candidate commit, not the main reproduction clone.

GitHub Verify run **43768761382 completed/success** on exact SHA **bc12fd6c76c6e66d73c04e8e4733976656627589**: https://github.com/just-every/run-happytohelp/actions/runs/43768761382 . No generated-view failure exception was needed. CI-RECEIPT.json and verify-poll-4.json record the actual terminal response. The published checkout remains clean at that SHA. There are no blockers. This is a test-only candidate; no independent product-change gate is requested, and landing/publication scans remain the fleet's responsibility.

## Other v0.4.30 shards

Run 43764365668's remaining jobs have now concluded. All nine other slow jobs completed successfully, including release-upgrades (132966101257), native-command-and-portability (132966101258), readme-clone-and-restore (132966101279), reproducible-build, portable-installation-compatibility, offline-deployment-preflight, import-and-report-scale, legacy-export and configured-live-provider. All eight regular Verify shards and size-check also succeeded. Only the known delegation-fresh-clone-browser job failed; the final verify aggregation is consequently red. No other HappyToHelp code/test failure needed repair. A successful configured-live-provider job does not establish live-provider qualification; that job's documented no-configuration skip remains a skip. See tag-jobs-conclusions.json for every job ID and conclusion.

## Clause judgments and counts

No clause status, Evidence or Gap is changed. DELEGATION-001, PUSH-001 and DELIVERY-001 remain partial. Contract summary counts are unchanged: Published 2 done / 24 partial / 0 missing / 26 total; Target and push further 2 / 47 / 16 / 65; All 4 / 71 / 16 / 91. No claim of live customer recovery, provider qualification or production acceptance is added.

## Boundaries

All builder-run application execution is local to this dedicated cloud VM and disposable loopback fixtures; GitHub Verify is recorded separately at the exact commit. The connector uses the existing scripted CLI provider boundary; no paid API or live company installation is used. Dependency installation and rer setup/build are under cloud_run's subreaper; each journey closes its own browser and server. Secrets, browser storage, setup answers, private scratch state and held-out gate material are excluded from the packet. Product READY is separate from evidence custody and landing remains the fleet's responsibility.

The initial historical-run metadata and job-list GETs were issued consecutively rather than 300 seconds apart. I corrected the polling cadence thereafter; exact-head discovery and subsequent polls are spaced at least 300 seconds apart. api-budget.json records every GitHub call. The owned failed-reproduction scratch was removed after successful process cleanup; the product checkout is preserved (cleanup-receipt.json).

GitHub API usage: 9/10 calls. Evidence custody is published separately to refs/heads/evidence/hh-slow-delegation-2; it conveys reports and receipts, not product landing or acceptance.

Signed: Sun Nov 15 22:59:16 UTC 2026 — Run Edit Run fleet
