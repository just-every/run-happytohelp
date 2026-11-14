# hh-health-version-1

Product repository: just-every/run-happytohelp
Branch: cloud/hh-health-version-1
Base: 333af4b0580c4284616783f1d79fcc9aad3aefc5
Product head: 146143b9466352f0ad30619247b55f0088eef8e2
Status: PUSHED. Final local checks and the equivalent two-commit complete-source rehearsal passed. Exact-head Verify is still running after the final allowed observation; no green result or READY is claimed.

## Product result

/health now includes release.version from the committed package.json and release.sourceCommit baked by Vite. The build reads the schema-1 rer-upstream.json commit first; managed installation commits never replace its upstream source identity. A publisher checkout uses its own Git HEAD. An archive without either provenance or its own Git history reports null, documented in OPERATIONS.md. Invalid upstream provenance fails the build. No request reads Git, package files or the upstream record. Release identity is also present in a storage-failure 503 response.

The existing vendored src/base/deployment-health.ts remains byte-identical. The deployment object, ok flag and reachable-storage fields retain their prior meanings. The expanded existing runtime journey supplies all three deployment bindings and runs rer 0.2.112's actual healthRequest comparator against the built app. The comparator reads ok and the expected deployment fields, allowing the additive release object.

## Scope and counts

Seven product files changed: src/app.ts, src/platform/release.ts, scripts/delivery/release-source.mjs, vite.config.ts, tests/journeys/runtime.mjs, OPERATIONS.md and the generated sources.lock.json. No UI, migration, package/version, deployment configuration, vendored Base or contract/status edit. No stage, provider account, production, DNS, mail activation or legacy-app action. No CLAIM.

Top-level journey registrations: 103 before, 103 after; the runtime registration was extended. Contract counts remain 4 done, 71 partial, 16 missing (91 clauses). No clause Status/Gap/Evidence change. No test assertion deleted or timeout raised. No browser screenshot proof is applicable because no screen changed.

## Plan and validation

The full plan is in PLAN.md. Actual command logs and JSON receipts accompany this report.

- Local setup initially refused missing required inputs (exit 3). It succeeded (exit 0) after supplying generated private local answers; those values and the private setup log are excluded from this packet.
- Typecheck, contract write/check, source lock/check, first-party check and build have run. Contract write produced zero changed documents; generated views were restored from origin/main. The source lock was regenerated last after the final tracked edits.
- The first trial used the inherited newer Node and was interrupted while its Worker startup continued; its remaining owned server was stopped by PID. The subsequent Node 22 trial correctly refused an earlier built artifact whose baked commit was 80781767f84a7944bdff16eb4eb0bf1d1bf40248 after source HEAD advanced to 146143b9466352f0ad30619247b55f0088eef8e2. This is evidence that the new assertion detects stale build provenance. A clean Node 22.20.0 final-head rebuild and rerun supersede those trials: the one touched registration passed in 187.7 seconds. checks-receipt.json records six final checks with actual exit 0, and local-receipt.json binds build/journey success to this exact head.
- Source archive resolution without Git returns null; malformed upstream provenance refuses. source-resolution.json contains actual observations.

## Managed copy rehearsal

The Mac work/hh-rehearsal-2 fixture and run-operations.py were not shipped into this VM. Looking up evidence/hh-rehearsal-2 failed HTTP 404 on five attempts with launcher refresh and 15/45/90/150-second backoff. No alternate credential was sought. The exact Mac fixture was NOT RUN.

An equivalent complete-source fixture was built from the candidate's actual git archive. It has exactly two fresh installation commits and records schema-1 upstream repository just-every/run-happytohelp, tag v0.4.25 and candidate commit 146143b9466352f0ad30619247b55f0088eef8e2. Its own installation HEAD is 28cf134c627fc5740993296022a981a1e57f7272. The provenance addition receives its own source lock through the unchanged documented lock command; no source checker is skipped or altered. managed-fixture.json records both installation heads and the exact adaptations.

The equivalent run-operations.py reads the real rer-project.json declarations. All four executable declared operations passed: setup 9.554 s, build 22.175 s, verify 18.042 s, artifact 0.415 s. The declared verify runs first-party checks, typecheck, source lock check, secret declarations, contract check and offline Base copy verification; none was skipped. Recovery is a prose instruction, not an executable operation; no recovery or provider execution is claimed.

The emitted-Worker health probe PASSED (exit 0) over real local D1/R2. HTTP 200 reports release.version=0.4.25 and release.sourceCommit=146143b9466352f0ad30619247b55f0088eef8e2, matching the upstream tag/commit rather than installation HEAD 28cf134c627fc5740993296022a981a1e57f7272. All three deployment fields remain null without bindings. Hiding both Git and rer-upstream.json during a second HTTP request leaves the response identical, proving runtime independence. managed-health.json contains the complete actual response. The fixture worktree remains clean after restoring those files.

A separate fixture additionally omitted .github, as platform filters do. Its first URL-form repository record was rejected by rer's existing managed-record recognizer; this was corrected to owner/name. With the corrected record, all contract and source checks passed, but the offline Base copy checker reported missing .github/workflows/run-demo.yml and .github/workflows/verify.yml. The same offline check on main 333af4b0580c4284616783f1d79fcc9aad3aefc5 with the same omission fails on exactly those two paths (filtered-main-receipt.json and filtered-main-base-check.log). This is a pre-existing filtered-copy limitation; the complete-source two-commit rehearsal above passes all operations. The Mac's exact filtered fixture was unavailable, so no full platform-copy qualification is claimed and no unrelated copy-policy change was made.

## Publication and custody

The first real commit was preserved on the named product branch with [skip ci]. Fresh origin/main was merged before the final commit (already up to date). All candidate authors/committers are Run Edit Run fleet <fleet@runeditrun.com>; trailers are absent. History was unshallowed for the publication handoff. No main/default-branch push, force push, rewrite, tag, release or deployment ran. No PR is required by this branch-only brief, and none was opened.

REMOTE-NEEDS-LOCAL: supported publish-check.sh is absent from the launcher and product checkout. The COMPLETE supported full-history scan must run on the Mac lander for https://github.com/just-every/run-happytohelp#main, edition just-every/happytohelp. No replacement scan or published acceptance is claimed.

Report files are published separately on evidence/hh-health-version-1 and never enter a product commit. Exact-SHA Verify and final push custody are recorded below. Independent lane gate and landing remain separate.

## Final CI and custody

PUSHED branch=cloud/hh-health-version-1 head=146143b9466352f0ad30619247b55f0088eef8e2

Exact-head Verify: run 43530842220, https://github.com/just-every/run-happytohelp/actions/runs/43530842220. Its discovery plus four polls spaced at least 300 seconds apart all returned in_progress with conclusion null on this exact SHA. The final observation was at approximately 00:17:41 UTC on 14 November 2026. Five earlier fixture-ref discovery attempts plus these five CI calls exhaust the ten-call budget. No additional GitHub API call, duplicate workflow dispatch, rerun, failed-job archive download or claim of another SHA's success was made. The watcher exited at the budget limit; no continuation is armed.

No product blocker was found by the local checks. CI qualification is pending; this is PUSHED rather than READY or CANDIDATE. The COMPLETE Mac publication scan and independent lane gate remain required before landing. The missing exact Mac fixture and the pre-existing filtered-copy offline check remain the explicit qualifications described above. Terminal product provenance, local proof, equivalent rehearsal, all relevant failures and receipts are retained in this packet.

The named product branch has been read back from origin at the exact head. Report-only evidence publication uses the separate evidence/hh-health-version-1 ref. No PR was created. Disposable product/fixture checkouts are removed only after evidence publication and verification; the actual packet remains outside them.
