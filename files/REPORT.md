# HappyToHelp 0.4.30 release preparation

Run Edit Run fleet, 2026-11-15. Task: sd-hh-release-0-4-30.

## Product custody

Repository: just-every/run-happytohelp.
Branch: cloud/sd-hh-release-0-4-30.
Candidate: efea73943b4995e951aa9c2e7a2577eaacfd5042.
Fresh main: 85bd29235181c90e7626cbebb6c1fe6b2564756d.
Product branch push succeeded on its first attempt. Remote ref was read back at the same SHA.
No PR was created; this task returns the branch to the fleet's existing guarded landing path.

## Plan and scope

The complete plan is in PLAN.md. This round verified fresh main and the latest published release, prepared only the authorized release metadata and upgrade-baseline entries, regenerated the source lock last, ran touched checks and the 0.4.28 upgrade journey, pushed the candidate through the supplied guard, and watches exact-SHA Verify through REST within the ten-call budget. Report transport uses a separate report-only evidence ref.

Only six product files changed: package.json, seed.json, RELEASE.json, CHANGELOG.md, tests/helpers/upgrade-baselines.mjs, and sources.lock.json. RELEASE.md and package-lock.json do not exist and were not created. pnpm-lock.yaml contains no root package version requiring a change and remains unchanged.

## Release selection and prerequisites

The latest published GitHub Release observed was HappyToHelp 0.4.28:
https://github.com/just-every/run-happytohelp/releases/tag/v0.4.28

Live Git ref probes found no v0.4.30 tag or pre-existing task branch. The v0.4.28 annotated tag object is 0ecfc8529b62c73e8108fdbc169d4f410ca08043, peeling to commit 41fb40246d2e69f928be397c48d952d147c39160 and tree bbef357df6a94dc92f84c94774143e030eb343fb. Both values were read from the fetched tag and checked against the assignment.

Fresh main contains hh-slow-delegation-1 at 85bd29235181c90e7626cbebb6c1fe6b2564756d and faults-4 at a7e05db8c6b5787328d56657453f551229d57405. Both ancestry checks passed. The immutable, retired v0.4.29 tag remains untouched and is explicitly described as unreleased in the changelog. previousVersion remains 0.4.28.

## Changes and before/after counts

- Package, seed and release metadata: 0.4.29 -> 0.4.30.
- Upgrade baseline records: 28 -> 29. The new 0.4.28 entry uses the verified commit/tree and 200 migrations with the existing populate03 public API fixture.
- The sole previous:true marker moves from 0.4.26 -> 0.4.28.
- Test registrations and assertions are unchanged.
- Migration inventory: 200 -> 200; added 0, removed 0, modified 0. Every published migration's bytes match v0.4.28. Highest numeric prefix remains 336, ending at 336_solved_time_rule_reads.sql; prefix 326 remains absent. RELEASE.json migrations and pendingMigrations remain empty.
- rer pin: 0.2.117 -> 0.2.117. Declared Node 22.20.0 and pnpm 10.12.4 are unchanged.
- Clause counts: done 4 -> 4, partial 71 -> 71, missing 16 -> 16, total 91 -> 91. Clause status changes: none. CONTRACT.md, ACCEPTANCE.md, docs/CLAIMS.md and their judgments remain unchanged.

The changelog and matching publicReleaseNotes describe the complete difference from v0.4.28: staff-only Zendesk field retention and explicit customer visibility, imported priorities and staff assignment, protected no-requester identity, assignees carried with pulled ticket batches, native public contact and mail-off guidance, installation identity and documentation, field visibility retained through erasure without retaining source identifiers, readability/layout corrections already on main, and the upgrade/delegation test-data corrections. Existing backup, recovery, older-release migration and no-reset obligations are retained. release-notes.md contains the exact new changelog section body; product.patch contains the complete product change.

## Local results

Frozen pnpm install and noninteractive rer setup succeeded. Setup output and local generated credentials are outside this packet.

The supplied toolchain shim retained the VM's newer Node 24.19.0. The first build, typecheck, first-party check and selected upgrade journey passed with it; those actual logs and the upgrade receipt are preserved under node24/. Node 22.20.0 was then installed explicitly for the repository-declared runtime and the touched qualification was repeated. All repeated checks passed on Node 22.20.0: typecheck, first-party check, rer build and the selected 0.4.28 upgrade. The source check was also repeated successfully on 22.20.0, and the final product checkout is clean.

The first selected 0.4.28 upgrade passed on the exact candidate SHA: 541 -> 541 tables, 200 -> 200 migrations, zero applied migrations, zero row/schema failures, one stored object/blob unchanged. The native owner and member signed in, both dashboard and widget retained five transcript messages, the article remained available through API/help center, invitation and second workspace survived, and attachment bytes matched. Current Worker operations and inert import/provider tables were checked by the existing journey. The exact receipt is node24/upgrade-0.4.28.json.

Source lock generation and its check succeeded after the final tracked edit. The first-party check and git diff --check succeeded. Identity and complete-message inspection covered every origin/main..HEAD commit, including side parents: fleet author/committer, no trailers. Actual receipts are source-lock.log, source-check.log, identity-audit.json and identity-audit.txt.

The final pinned-runtime upgrade receipt is upgrade-0.4.28.json; CHECKS.json records command outcomes. It retained 541 -> 541 tables, 200 -> 200 migrations, all 540 prior application tables byte-identical in their row snapshots, unchanged prior schema and one stored object/blob. It applied no migration, reported no row/schema exception or failure, and passed all native read-back checks in 246 seconds. The exact candidate SHA is recorded inside the receipt. No test was changed to obtain this result.

## CI and downstream gates

The initial exact-SHA REST discovery immediately after push found no run yet. A single watcher respects at least 300 seconds between discovery or reads of the same run. github-calls.json records the API budget. Exact-SHA push Verify remains **in_progress** at the last bounded read, run 43757709571: https://github.com/just-every/run-happytohelp/actions/runs/43757709571 . Terminal product custody is PUSHED; successful branch Verify remains pending. The final read began at 2026-11-15T20:47:28.739453+00:00; 7/10 explicit GitHub API calls were used, including the latest-Release read. The watcher has stopped.

The branch Verify result is a landing-candidate gate. The exact-tag slow-tier Verify remains required downstream before any signing request. This task does not create a tag, sign, publish a GitHub Release, deploy, or self-submit to landing. The cloud cannot run the fleet Mac's publication scan; that scan and the fleet's final landing gates remain required. No provider, company, homepage or contract-readiness claim is added.

## Evidence custody

This packet is outside the product clone and contains explicitly selected non-secret reports and actual receipts. Publication is only to refs/heads/evidence/sd-hh-release-0-4-30, independently of product READY/PUSHED custody. Evidence publication does not assert release qualification or landing. The terminal message carries the exact evidence ref/head for fleet retrieval and the required sd lane POST.

## Terminal result

PUSHED branch=cloud/sd-hh-release-0-4-30 head=efea73943b4995e951aa9c2e7a2577eaacfd5042

Exact-SHA push Verify remains **in_progress** at the last bounded read, run 43757709571: https://github.com/just-every/run-happytohelp/actions/runs/43757709571 . Terminal product custody is PUSHED; successful branch Verify remains pending.

All local touched checks passed. Clause changes: none. The fleet Mac publication scan, guarded landing and eventual exact-tag slow-tier Verify remain downstream gates. The report packet is complete and retained outside the owned clone.
