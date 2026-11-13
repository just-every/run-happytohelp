# Product change

`src/modules/legacy-import/delta.ts` defines one local `leasedBatch` wrapper after requiring the lease. The wrapper executes the same D1 batch, calls `lease.confirm()` on rejection, and rethrows the original error if the lease remains valid. The existing lease implementation supplies the operator-facing `delta lease lapsed` message when the token expired or was replaced.

Run creation, prepared replay accounting, row groups, and final completion all call this wrapper. SQL statements, ordering, guards, transactions, assertions, journaling, replay and data selection are unchanged. There is no error-string matching and no success fallback. A failure does not advance completion. Already committed groups remain available to replay; D1 still rolls back the failing batch.

The existing tests/legacy-export.mjs registration and tests/legacy-export/delta.mjs fixture/assertions remain byte-exact. The integration test requires a nonzero lapse exit with the lease message, committed contact journal rows, zero message journal rows after the stop, and a successful replay with replayed>0 and messages journaled. It also retains erasure, R2 cleanup, repeat, retirement and safe replay checks.

Error-handled guarded call sites: 1 before, 4 after. Integration registrations: 1 before, 1 after. No test is added, skipped, removed or weakened. No migration, dependency/version, UI, contract clause, stage or provider change is made. Contract counts remain 91 total: 4 done, 71 partial, 16 missing; MIGRATION-001 remains PARTIAL, points=none.
