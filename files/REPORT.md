# HappyToHelp stranger-13 recovery investigation

The CI stall remains unlocated. The exact recorded rebase passed both local restore assertions with the original test timeout. The carry is staged for the lane. The product branch is unpublished and has no candidate commit or exact-head Verify run.

Repository: just-every/run-happytohelp  
Tag: hh-stranger13-behaviour-1-c3  
Branch: cloud/hh-stranger13-behaviour-1-c3  
Latest main observed: 154b8d638f3332ac29da9398a162fe48345b6aae  
Recorded failing rebase: 31df4bbad43ffb30932b75cbe33032d367239545  
Gated source: b3660b6ee2772d005185bc0343f14cb9d7fd0d51 on 55e2f106c506e4f671d2e474c737124e760e2233

See [PLAN.md](PLAN.md) and [checks-receipt.json](checks-receipt.json) for the execution plan and actual commands, duration boundaries and exit codes.

## Historical failure and local reproduction

Verify run 44206734581 on 31df4bb was reported to stop producing output after “Recovery restore: guarded member erase” in jobs 134475338647 and 134491017754. Both REST receipts record the shard step cancelled after 29 minutes 36 seconds. Main Verify 44195108483 and the original gated candidate Verify 44156311769 are historical controls at different SHAs. The cancelled job's archive output for gh run view 44206734581 --repo just-every/run-happytohelp --job 134491017754 --log-failed was empty. The redirected artifact store returned Forbidden to gh run download 44206734581 --repo just-every/run-happytohelp --name browser-evidence-support-and-recovery-44206734581-2 --dir ../historical-browser-private. [Historical Verify](https://github.com/just-every/run-happytohelp/actions/runs/44206734581)

The initial exact shard command on the recorded commit had a hard eight-minute process limit and expired still in the browser file. The focused recovery test on the repo's Node 22.20.0 reached public import before the eight-minute process limit. These reproduce local duration limits, with different final markers from the CI stall. The separate packaged comparison passed with 541 tables, 200 migrations and six objects on the recorded rebase. A post-import checkpoint investigation on the same commit passed member erasure, pending capability revocation, owner session retention, owned dev shutdown and offline row assertions. An initial draft of that out-of-tree checkpoint used the wrong response shape for the session API and stopped before erasure. The corrected checkpoint exited zero.

The supplemental run used the unmodified restore test's original declared timeout, an observational fetch preload, the exact recorded checkout, and its emitted artifact. In tests/helpers/identity/recovery-restore/journey.mjs:92, the historical marker precedes multiple HTTP calls, dev shutdown and offline assertions. Locally POST /api/management/projects/[id]/agents/[id]/erase at line 96 returned 200 in 1.538 seconds. The capability read returned 401, the owner's session read returned 200, and the packaged comparison then reached its healthy runtime in tests/journeys/restore.mjs:24. Both restore subtests passed in 15 minutes 36 seconds. The comparison proved 541 tables, 200 migrations and six objects on the exact recorded rebase. [Redacted request trace](before-recovery-trace.txt)

## Candidate custody and scope

The gated net patch is staged on latest main. Relative to the original gated patch, 28 of 29 non-lock file patches are byte identical. tests/journeys/inbox-browser.mjs carries the same added hunk with changed line coordinates and blob IDs because main added the owner widget installation test above it. The other raw patch difference is the regenerated sources.lock.json. The entire staged tree equals 31df4bbad43ffb30932b75cbe33032d367239545. The staged patch is preserved outside the clone as staged-carry-full.patch, SHA-256 94903395724b06e486eff7c0b1c7f2c727505b5daae7f0cd2f62b8f0988748d1. [Per-file patch comparison](patch-comparison.json)

No clause Status, Gap or Evidence edits. DESK-001, MACRO-001, STATUS-001 and NOTIFY-001 retain partial status. Full-target count is 4 done / 71 partial / 16 missing of 91, before and after. Core is 4 / 71 / 11 of 86, Agent surface is 0 / 0 / 5 of 5, Later is 0 / 0 / 0, and field proof is 0 passed / 0 failed / 21 not run. Contract and generated views match main. Source lock generation and check, typecheck, first-party rer check and generated contract checks passed.

Browser smoke tests passed for competing replies and short-reference macro previews/title on the staged recovery tree. The packet includes 1440 and 390 browser captures of both. Scoped reference search passed using the synthetic loopback test fixture without the cloud proxy. The row-save and stale-write assertions ran before the workflow browser smoke printed its later automation checks. The complete workflow browser command expired at its local ceiling. Combined inbox and email, the isolated status lifecycle and the isolated notification checks did not complete under their local limits. Their results and the owned subprocess cleanup are recorded in the receipt. No after-fix journey or candidate Verify was run because the local recovery trace did not reproduce the CI stall.

## Historical candidate CLAIM lines

The lines below are from the gated candidate's report and describe its SHA only.

CLAIM carry: exact b3660b6ee2772d005185bc0343f14cb9d7fd0d51 published unchanged under cloud/hh-stranger13-behaviour-1-c2-c1; one commit, one parent.
CLAIM patch-equivalence: 29/29 non-lock patches byte exact against the original c2 candidate; sources.lock.json is the sole permitted exception.
CLAIM validation: local lock check, typecheck and rer check passed; exact-head same-repository Verify 44156311769 completed/success.
CLAIM clauses: no Status/Gap/Evidence changes; full-target counts remain 4 done, 71 partial, 16 missing.
CLAIM limits: no new gate, publication scan, landing or live-provider proof; C1 follow-up was not added.
