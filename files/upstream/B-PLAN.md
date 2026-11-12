# hh-importer-custody-2 implementation plan

Base: just-every/run-happytohelp main 403c8317144571852bcbcaae34ba4e3ce8bcc06c.
Branch: cloud/hh-importer-custody-2. Single writer; no delegated agents.

1. Read launcher/repository guidance and supplied accepted v2 policy. Preserve A/core, runner repair, application mounts, queue/jobs, UI, contract, release metadata and other writers.
2. Add migration 329 with pre-start package custody, server-derived exact-key ledger, permanent indexed scope fences and durable cleanup claims/cursors. Never store source content or session values in this registry.
3. Implement generic native-session/permission and package/scope batch guards; manifest binding and ordinal-only key registration; unique nonce/ETag conditional source PUT and immutable checksum readiness; explicit valid activity retention, adoption destination statements, terminal discard/expiry/erasure closure.
4. Add bounded cleanup/discovery APIs using retained tombstones, <=100 R2 keys and <=250 source/descriptor child rows per step. Preserve canonical journals and counts; remove source diagnostics and all four scratch families. Keep cleanup coordinates to sweep late nonces.
5. Put the scope fence in the native admitted-identity transaction. Perform one cleanup quantum through the existing erase door, return safe 409/Retry-After while pending, and assert source completion in the canonical erasure batch and provider/audit/lease-completion batch. Integrate workspace deletion without changing project creation.
6. Extend existing custody/erasure registrations using an owned test-only mounting of the generic APIs, real workerd D1/R2, real native sessions and the actual application erase door. Exercise failure and precise reservation/body/deletion barriers. Keep product upload and JOBS integration explicitly pending C.
7. Run touched journeys, typecheck, source lock/check and first-party check. Fetch/rebase fresh main before first publication, regenerate lock last, inspect all candidate identities/messages and push only the named branch with the fleet guard. Wait for exact-SHA Verify with REST within ten calls and 300-second per-run spacing.
8. Publish actual public-safe report/receipts through evidence/hh-importer-custody-2 separately. Report API signatures, exact remaining canonical-copy seam, no clause promotion and all pending independent gates. Preserve branch provenance; no main push, release, account/provider/customer action or deployment.

Cloud adaptations: no Mac slot/load helpers; touched commands use cloud_run and repository pins. Full publication scan is reserved for the Mac supported scanner because that scanner is absent here. No INBOX/STATE files read or written.
