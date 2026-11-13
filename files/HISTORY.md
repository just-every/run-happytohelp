# Release comparison

Baseline main: 1e2eed487d03c8c0badc75115960c4ab089a43db.
Passing v0.4.22: 4dee2432081a64cee0bd12c59a31cb84371c3ab3.

`git log v0.4.22..origin/main -- src/modules/legacy-import/delta.ts tests/legacy-export/delta.mjs` lists 85b333b (durable guarded Worker slices), 21c82bf (prepared journal transaction), 59a0423 (admitted knowledge copies), 402b72f (atomic replay reset), 357cc9e (adoption mapping). There is no change to tests/legacy-export/delta.mjs in this interval.

85b333b replaced the standalone run INSERT and final completion UPDATE in importDelta with lease-asserting D1 batches and introduced the prepared replay batch. It retained confirm-on-error handling only on the row-group batch. These changes support migration 327's Worker scratch and prepared slices; the ordinary CLI package path calls importDelta once per table chunk without prepared state.

The contacts fixture fits in one group, as before. Its trigger expires the lease after journaling a contact. The group remains committed because its final action only clears the assertion. In v0.4.22 the unguarded final UPDATE completes that chunk and the next chunk's guarded row batch detects the expiry and calls confirm(). In main/v0.4.23 the newly guarded final UPDATE detects expiry first, rolls back its completion write, and leaks IMPORT_ATOMIC_GUARD because it lacks the catch. This is a product error-handling regression, not a stale fixture. The early guard itself is correct and must remain.

Historical GitHub comparisons (four CLI invocations):
- `gh run view 43332272798 --repo just-every/run-happytohelp --job 131579710755 --log-failed`: exit 0, zero bytes returned. The archive command was invoked once and was not retried. The shipped brief supplies the failure assertion and stack; these are not represented as independently downloaded logs.
- REST discovery on the exact v0.4.22 SHA found Verify run 43166501297 completed/success; its jobs include slow / legacy-export 131009567617 completed/success and verify 131019704508 success. Actual metadata is in v0422-runs.json and v0422-jobs.json.
- `gh run view 43166501297 --repo just-every/run-happytohelp --job 131009567617 --log`: exit 0, zero bytes returned. No claim is made about a downloaded passing log.

No migration, release-upgrade ledger, CONTRACT status/gap/evidence or generated-view change is intended.
