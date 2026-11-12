# hh-importer-custody-2 — B implementation result

Status: BLOCKED on final exact-SHA Verify source-preservation failure. Product work is pushed; no READY, acceptance, landing, release or customer qualification is claimed.

Repository: just-every/run-happytohelp. Branch: cloud/hh-importer-custody-2.
Base: 403c8317144571852bcbcaae34ba4e3ce8bcc06c (fresh clone and subsequent main fetch match the accepted R1/R2 prerequisite).
One writer, no helper agents. All supplied rules/policies read inline; launcher and repository guidance read from their real files. No INBOX/STATE files, customer package, provider account or production resources were read or changed.

## Product result

Adds migration 329 and generic pre-start custody under `src/modules/legacy-import/custody/`. Registry stores only SHA, scope/provenance, generation, retention and cleanup coordinates. Exact keys are server-derived exporter ordinals; no content, arbitrary filename, source JSON or session value is persisted in these tables.

Upload helper registers first, validates bounded submitted bytes/checksum, conditionally reserves a unique random nonce, checks native session/permission and permanent scope fences, then replaces only that reservation's ETag using R2 SHA-256 integrity. Accepted originals are immutable/idempotent only after submitted bytes are checked. Reservation takeover changes the nonce/ETag. A stale loser never deletes a winner. Source readiness requires accepted metadata plus actual stored R2 checksum/size, not ETag or nonce contents.

The actual contact erase door adds the permanent scope fence to the admitted-identity transaction and performs one cleanup quantum. Safe 409 `source_cleanup_pending` plus Retry-After keeps the contact erasing and retains its lease on R2/D1 interruption. Authenticated erasure GET reports pending counts even before a completion row exists. Canonical and provider/audit/lease completion batches assert cleanup, including current child/key absence, rather than accepting an earlier read or an old contact-erasure record.

Cleanup closes package/run generations, scrubs source-derived run diagnostics, and deletes all four scratch families plus part descriptors pagewise. A step deletes at most 100 R2 keys and 250 total child rows. It retains canonical history/journals/counts and terminal SHA/scope tombstones. Retained ordinal-only coordinates allow later cleanup to sweep a harmless late nonce. Cleanup service authority does not depend on the importing session or native workspace activity. Workspace deletion fences/schedules custody without altering ordinary project creation.

Retention: initial/partial uploads, paused/stopped/resume and verified-completion windows are 24 hours after explicit valid activity/transition; legitimate progress remains capped by the original absolute seven-day deadline. Status reads do not renew. Closure, including ordinary expiry/discard, is terminal for the SHA. Any scope fence, previous contact erasure or unfinished erasure lease (including expired) refuses new remote intake for every SHA in the involved custody/source/destination scope.

See API.md for exact signatures and C's required call/batch locations. PLAN.md contains the complete implementation/validation plan.

## Actual local proof

B's test-only harness mounts the real generic APIs over workerd D1/R2 and invokes the unchanged public native contact erase route. This is not a claim that the application upload or JOBS mount is wired. Synthetic fixture manifests supply source binding to the generic custody helper; C still owns full exporter manifest/descriptor policy on the actual intake door.

Observed in focused storage checks:

- Native sessions and scope are used; operator, unauthenticated and foreign-owner writes refuse. Digest mismatch and non-ordinal filenames refuse without accepted bytes. An exact repeat is idempotent. Polling preserves retention timestamps.
- A pending reservation is not ready source. Takeover with a new nonce/ETag wins; the delayed old writer fails and cannot delete or replace the winner.
- Barriers before/after reservation and before/after body replacement overlap actual contact erase/storage calls. Body-before-delete is removed, delete-before-body cannot recreate it, and a reservation arriving after deletion can leave only a nonce which is then swept.
- Injected R2 deletion failure and D1 child-page failure return fixed pending diagnostics, write no successful completion, retain retryability and do not advance a failed cursor.
- 255 scratch/parts rows (251 context rows plus message/media/identity/part rows) purge across two successful quanta after failure recovery; the first deletes 250, then one context row remains. All four families and descriptors are gone at completion. Peer contact and canonical media bytes remain.
- A package with 102 real registered R2 bodies loses 100 on the first erase quantum, stays 409/pending with two left, then completes with none.
- Source and adopted destination indexes discover packages held in another setup workspace. Same-SHA and new-SHA staging after erasure refuse; an expired unfinished erasure lease also refuses fresh intake.
- Expiry denies resume before cron; due discovery and a replacement workerd instance with the same persisted storage complete cleanup, and duplicate cleanup is idempotent. Deleted-workspace cleanup runs through tombstone service authority.
- Ordinary unauthenticated and authenticated imported-file routes expose no staging entitlement.

The focused harness supplies real storage/ordering proof, not CPU/heap or customer-scale throughput qualification. Isolate CPU/heap and allocation sharing with the runner's existing cron budget are NOT MEASURED by B and remain C's measured integration work.

## Counts and clause custody

Literal journey registration inventory: 104 before / 104 after; two existing registrations extended, zero new registrations. This is a literal root journey inventory, not a claim to recount every independent CI assertion script. No test was deleted, skipped or weakened. MIGRATION-001 remains PARTIAL; no acceptance point, Status/Gap/Evidence cell or generated claim was edited. Public customer source, remote adoption, mail activation and all original release holds remain unchanged.

CLAIM MIGRATION-001 PARTIAL points=none tests=none
DEFAULT MIGRATION-001: Whole-package source invalidation across custody/source/destination scopes; 24-hour explicit-activity windows, absolute seven-day cap, terminal SHA closure and no new remote intake after any erasure/unfinished lease.
GAP MIGRATION-001: C must wire every actual upload, adoption destination, worker batch, cleanup queue/cron/result and old-v1 cleanup path, supply measured shared budgets and release integration, then obtain the lane's independent gate and full mounted v2 qualification.

## Exact remaining seams

1. Canonical copy reservation: `src/modules/legacy-import/worker/object-step.ts`, `copyObject()`, still writes canonical object bytes with conditional-create, confirms the lease, and only later records `legacy_import_objects` through checkpoint. Death after copy has neither an erasure-discoverable ownership reservation nor journal. C owns reservation before copy under the destination lease/custody fence, preserving native-held-media ownership. This file is read-only to B and was not changed.
2. Application integration: package-in/worker/queue/jobs/Env/UI/contract/RELEASE are outside B. Existing v1 uploads are not silently reinterpreted as v2. C must seed old synthetic custody cleanup-only, add the cleanup job variant and dispatch before native activity gating. No customer use is authorized by this B harness.
3. Generated deployment projection: a successful local rer build regenerates `management/integration/deployment-spec.json` to include migration 329. B's exclusive allowlist does not include that file; it was restored to main. Its additive generator output and RELEASE migration/buyer steps require lane/C integration. Exact-SHA Verify will determine the actual CI effect; no out-of-scope generated file was silently committed.
4. COMPLETE publication scan: supported publish-check.sh/full-history scanner is unavailable in this cloud. Pending Mac scan with repository https://github.com/just-every/run-happytohelp#main and edition just-every/happytohelp. This is not a scan bypass or landing permission.

Final SHA, exact-SHA workflow status/run IDs, actual command receipts, packet transfer and terminal custody are recorded below after validation completes.

## First committed product and local receipts

Head: 6d4d4e29a691419d8371a87d2a3d82323e481ea3. Base after final fetch/rebase: 403c8317144571852bcbcaae34ba4e3ce8bcc06c. Product push succeeded on attempt 1; all author/committer/trailer candidates passed and the product checkout is clean. No PR was created; this assignment uses branch custody.

Touched journeys: 3 passed, 0 failed, 0 skipped, duration 720747.305764 ms on this VM. Build, typecheck, source lock, source check and first-party check exited 0. Full hosted wall is Verify run 43261020994 on the exact head; initial status in_progress. Source check contains the complete generated check result, with other actual command outputs beside RECEIPTS.json.

No clause status changes: MIGRATION-001 partial -> partial, proven acceptance points none. No UI change or screen proof applies to B.

## Final retention fix and current head

Final pushed head: fb705f8c7ef2043f8d012d0de9300c59d6d567d1. A normal second commit retains the original published history. Fresh origin/main was unchanged; merge reported already up to date. All candidates, including both commits, passed author/committer/trailer checks before the second guarded push (attempt 1 success). No PR was created.

A persisted retention-state fence prevents idempotent uploads and repeated stopped/completed transitions from extending a stopped or completed deadline. Explicit resume is needed before new committed progress. Added behavioural checks use a controlled retained deadline and prove it remains unchanged across actual native-session PUT/transition requests. Both extended journeys passed again (2/2, 0 skipped, 59249.683195 ms); the final focused workerd storage run, typecheck, source lock/check and first-party check all exited 0. The original complete touched command had passed 3/3 earlier; ordinary erasure/archive behaviour was unchanged by this retention-only follow-up. The final-head rer build also exited 0 and reproduced the same generated deployment projection boundary.

Initial exact-SHA Verify 43261020994 on 6d4d4e29a691419d8371a87d2a3d82323e481ea3 completed failure at build step “Confirm build preserves source”; the final verify job consequently failed and route/browser shards were skipped. Reading its build failure archive once with `gh run view 43261020994 --repo just-every/run-happytohelp --job 131332280343 --log-failed` failed with sanitized transport error `EOF`, HTTP status not supplied. That archive was not retried. The final verifier log was read once and records BUILD=failure/CHECKS=skipped. The exact local build drift is preserved in DEPLOYMENT_PROJECTION_DIFF.patch; the blocked archive prevents claiming its precise CI diff was independently read.

Final-head Verify 43263108181 was discovered on fb705f8c7ef2043f8d012d0de9300c59d6d567d1 and is being polled separately at the required interval. Its terminal result follows below. No green claim is made from the earlier head.

## Terminal result

BLOCKED branch=cloud/hh-importer-custody-2 head=fb705f8c7ef2043f8d012d0de9300c59d6d567d1

Final exact-SHA Verify **43263108181** completed **failure**. Build job **131339537452** failed only its “Confirm build preserves source” step; every preceding selected build/check step succeeded. Aggregate verify job **131340600052** failed as a consequence; route/browser shards were skipped. The final local build reproduced only `management/integration/deployment-spec.json` drift, adding migration 329. This file is outside B's exclusive ownership; RELEASE.json integration is explicitly C-owned. No out-of-scope repair or main push was attempted. The complete generator diff is in DEPLOYMENT_PROJECTION_DIFF.patch for lane/C integration. The CI failure is not the generated CONTRACT view exception, so no READY line is emitted.

Eight GitHub calls total: initial discovery/poll/jobs/two one-time failed-job log reads; final-head discovery/poll/jobs. No duplicate dispatch/rerun, no short-interval polling and no blocked build archive retry. Final failed-job archives were not downloaded after the initial archive transport returned EOF. This report identifies the exact CI failed step and the exact local drift; it does not claim the failed CI diff itself was read.

Requested lane action/default: integrate the generated deployment projection and pending migration/release buyer steps with C, preserve both B commits and A's work, then rerun normal exact-head checks through the lane's authorized integration. Keep customer remote source/adoption and release holds intact. The canonical-copy reservation seam and all actual intake/worker/queue/result wiring remain C's named acceptance, documented in API.md. The independent lane gate and supported Mac COMPLETE publication scan remain pending.

Final clause status/counts: MIGRATION-001 PARTIAL -> PARTIAL, points none; no CONTRACT/generated claim edits. Literal root journey registrations 104 -> 104; zero new registrations and two extended. Initial touched run 3/3 passed; retention follow-up 2/2 passed; final focused storage, typecheck, source lock/check, first-party check and final-head build passed. Product custody is the pushed branch/head above, separately from evidence publication.
