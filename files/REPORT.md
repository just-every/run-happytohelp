# hh-delta-lapse-fix-1

Repository: just-every/run-happytohelp
Product branch: cloud/hh-delta-lapse-fix-1
Product head: d0fee7f073e0d2128cfaf751ddd3fcad6236a8c0
Base main: 1e2eed487d03c8c0badc75115960c4ab089a43db
PR: none created; the repository's shipped AGENTS.md does not require one for this builder branch. The fleet owns independent gating and landing.

## Outcome and cause

The smallest product fix routes every lease-guarded delta D1 batch through the existing confirm-on-error behavior. A failed batch confirms the lease: expiry or token loss surfaces the lease's operator-facing `delta lease lapsed` message; a live lease preserves the original error. All SQL, transaction boundaries, guards and journal/replay behavior are retained. Only delta.ts and its generated source-lock hash changed.

The Worker commit 85b333b added lease guards to run creation, prepared replay accounting and completion, while keeping confirm-on-error only on row groups. The unchanged synthetic export emits contacts as its own chunk. The expiry trigger runs after that chunk journals contacts; the newly guarded completion UPDATE now detects expiry before the next chunk does. Its missing error handler leaked IMPORT_ATOMIC_GUARD. In v0.4.22 completion was unguarded and the next guarded row batch supplied the lease message. The fixture's premise is sound and has not changed since v0.4.22. HISTORY.md includes the exact comparison and limits of historical GitHub log retrieval.

## Plan and executed work

1. Refreshed the fleet launcher, installed bundle-backed Git auth and the guarded push entrypoint, cloned only the declared repository, set fleet identity and installed co-author cleanup hooks preserving repository hooks.
2. Read the shipped builder/hh rules, repository AGENTS.md, CONTRACT.md, ACCEPTANCE.md and HANDOVER.md. Read delta importer, lease, batching, package runner, original lease fixture, migration 327 and both CI workflows; compared history since v0.4.22.
3. Hosted local MySQL 8.4 and reproduced the exact raw-guard failure through the unchanged real tests/legacy-export.mjs journey on baseline main.
4. Consolidated the existing catch into one local helper called by all four guarded batches. Kept tests, fixtures, assertions, migrations, release ledger and clause judgments unchanged.
5. Passed typecheck, first-party rer check, contract view write/check and source check. Restored generated views from main. Fetched fresh main and merged (already up to date), regenerated the source lock last, and checked it before committing. Built the committed candidate successfully and confirmed a clean tracked tree. Completed local setup with ignored owner-only answers; no private setup values are in this packet.
6. Inspected all unpublished author/committer identities and trailers, committed with explicit fleet author/committer environment and active hooks, and immediately pushed the first real commit through cloud-push.py. The push succeeded on its first attempt. No default branch, tag, release, stage, provider or customer resource was changed.
7. Requested tier=nightly once on the candidate branch for exact-head slow coverage; ordinary push Verify is separate. Used REST for CI discovery/status and kept a ten-invocation GitHub budget. CI outcomes and run/job IDs are added below from actual responses.
8. Selected non-secret report and receipt files explicitly for the separate evidence ref. No credentials, environment dump, held gate material, private setup file or symlink is selected. Product and evidence publication are separate.

The full initial plan is PLAN.md. CHANGE.md explains the code and preserved semantics; PUBLICATION.md states the remaining fleet scan boundary.

## Local proof and limitations

- Before: the unchanged real MySQL/D1/R2 journey failed after 279258ms at tests/legacy-export/delta.mjs:265, expecting /delta lease lapsed/ and receiving IMPORT_ATOMIC_GUARD from the chunk completion batch. Exit 1; one registration, zero passed. baseline-receipt.json and legacy-before.log are actual evidence.
- After with the original six-minute limit: the unchanged journey passed its lease stop, committed-contact/zero-message and replay assertions, continued through later delta/resume/retire work, and wrote its final results after 375345ms. TAP cancelled the registration at 360000ms and returned exit 1. This is explicitly not reported as a passing standard run. legacy-after.log, checks.jsonl, journey-results.json and the complete emitted journey-complete-results.json record both the timeout and completed body.
- Supplemental local run: uses the same byte-exact test and fixture on the committed candidate with a clearly logged external runtime allowance of 900000ms. The loader changes only the registration's timeout in memory; it changes no assertion or repository file. local-runtime-allowance.mjs is the actual harness. CI retains the original 360000ms limit. Its result is recorded below when complete.
- Candidate build: exit 0 at the exact pushed head, with no tracked source changes.
- Typecheck, first-party rer check, generated contract view write/check and final source check: exit 0. Contract write changed zero documents. Source lock changes exactly delta.ts's hash.
- Historical v0.4.22 tag Verify 43166501297 and slow / legacy-export job 131009567617 succeeded on 4dee2432081a64cee0bd12c59a31cb84371c3ab3. Both historical gh log commands returned exit 0 with zero bytes; no downloaded historical logs are claimed. No retry was made.

## Counts and clause custody

Guarded delta batch call sites with confirm-on-error: 1 → 4.
Real export/import integration registrations: 1 → 1; none added, deleted, skipped or weakened.
Contract counts: 91 → 91 total; 4 → 4 done, 71 → 71 partial, 16 → 16 missing.
MIGRATION-001: PARTIAL → PARTIAL; no Status, Gap or Evidence cells changed; no acceptance point promoted.
Migrations added: 0. Release-upgrade ledger changes: 0. Product commits: 1.

CLAIM MIGRATION-001 PARTIAL points=none tests=tests/legacy-export.mjs#project snapshot → attachment bytes → native import → safe replay → delta sweep since the watermark
GAP MIGRATION-001: This repair proves lease-error reporting and the existing guarded replay behavior; it makes no new whole-clause DONE claim or production/cutover qualification.

## Publication and handoff

REMOTE-NEEDS-LOCAL: the supported Base publish-check.sh/public_hygiene scanner is not shipped in this VM. The clone has full history, candidate identities/trailers were inspected, and its minimal source diff was reviewed. The fleet must run its supported full-history exact-tree publication scan before landing. No scan waiver or COMPLETE scan is claimed.

No browser proof is applicable to this logic-only change. No production, provider, legacy-app, deploy, DNS, homepage, UI, mail, version or vendored-code action was performed. No INBOX or STATE file was read or written. Final hh POST lines relay custody; no landing/default-branch update is authorized by evidence publication.

## Supplemental local result

The full unchanged MySQL/D1/R2 journey passed on d0fee7f073e0d2128cfaf751ddd3fcad6236a8c0 with the documented local runtime allowance: 1 test, 1 pass, 0 failures/cancellations/skips; 405437ms. This includes the original lease message, partial-journal, zero-message and replay assertions, R2 lapse/erasure cleanup, safe repeats, resume and retirement checks. The tracked candidate remained clean. This supplemental local pass does not replace the unchanged six-minute CI job.

## Exact-head CI observations

Ordinary push Verify: 43364463680, exact head d0fee7f073e0d2128cfaf751ddd3fcad6236a8c0, still in progress at the first spaced status observation.

Nightly Verify: 43364490496, dispatched once with tier=nightly on the same head. The unchanged slow / legacy-export job **131685649936 completed/success at 04:23:23Z**. This is the required real six-minute CI test, independently green after the raw-guard baseline reproduction. Seven of ten slow jobs were green in the jobs receipt; native-command-and-portability (131685649989), readme-clone-and-restore (131685650050), and release-upgrades (131685650141) were still running. No red slow job was observed in that response. Configured-live-provider job success does not establish live-provider qualification. Nightly-proof is intentionally main-only and does not run on this builder branch.

Eight of ten allowed GitHub invocations have been used. The final two are reserved for terminal push/nightly run status; polling is spaced at least 300 seconds per run. github-calls.jsonl records the actual calls. No alternate API/browser polling or duplicate watcher is used. Final conclusions are appended when observed.

At 04:50Z, ordinary push Verify **43364463680 completed/success** on the exact candidate head. Its final REST receipt is push-verify-final.json. The nightly overall conclusion remains pending the final observation; its legacy-export job is already independently green.

## Final CI observation and custody

- push: run 43364463680, status=completed, conclusion=success, head=d0fee7f073e0d2128cfaf751ddd3fcad6236a8c0; https://github.com/just-every/run-happytohelp/actions/runs/43364463680
- nightly: run 43364490496, status=completed, conclusion=success, head=d0fee7f073e0d2128cfaf751ddd3fcad6236a8c0; https://github.com/just-every/run-happytohelp/actions/runs/43364490496

GitHub invocations used: 10/10. No further watcher or continuation remains. Product custody: **READY**. The exact-head slow legacy-export job 131685649936 is completed/success.
Both workflow runs completed/success on the exact candidate head. Nightly success includes the selected slow jobs and verify roll-up; nightly-proof is main-only. No failing slow job was observed.

CLAIM MIGRATION-001 PARTIAL points=none tests=tests/legacy-export.mjs#project snapshot → attachment bytes → native import → safe replay → delta sweep since the watermark
Clause status changes: none. Counts unchanged: 91 total, 4 done, 71 partial, 16 missing; integration registrations 1 to 1; guarded error handling 1 to 4. No PR was created.
