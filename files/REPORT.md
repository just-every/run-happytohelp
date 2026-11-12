# hh-importer-index-drain-1 — guarded knowledge-index continuation

Product repository: just-every/run-happytohelp  
Branch: cloud/hh-importer-index-drain-1  
Base: 9a4f9408a2fd46159086df698dba9ebcf3f5d657  
Head: 7f21bac240747db1e2bed5112e92380f0646c702  
PR: none created; this task publishes a branch for the lane's independent gate.  
Product push: succeeded on the first guarded attempt. No default branch was written.

## Result and scope

An owner can import 25 published articles followed by a 16,439-byte macro through the existing HTTP start/result routes and actual Worker queue handler without making a native reply or unrelated application write to drain the knowledge index. A deliberately lost wake is recovered by the real scheduled dispatcher. The same package completes with byte-faithful source journals, native reference protection and zero rows applied on replay.

Only the Worker runner, its existing legacy journey registration/test fixtures, and generated sources.lock.json changed. No migrations, permissions, package-in/worker contract, adoption/custody policy, recovery, mail, UI, homepage, release metadata, contract status, generated claims or acceptance views changed. No knowledge-index interface change was necessary. No UI changed; browser screenshots do not apply.

## Before and after: identical public-door case

Package manifest SHA-256: `9b35b11ad87837873b07bdfa0a314ec4b7452cf5d5aacb079e3312a79ac155c4`.

| Observation | Fresh main | Candidate |
| --- | --- | --- |
| Published articles followed by long macro | 25 / 16,439 bytes | same package |
| Runner outcome | paused in rows: knowledge_index_not_ready | complete / verified |
| Dirty sources | 25 | 0 |
| Ordinary owner Resume | pauses again; still 25 dirty | no unrelated action required |
| Explicit fallback drain steps | none | 25→24→23→22→21→20, one source per wake |
| Drain queue statement counts | no committed drain | 45, 44, 44, 44, 44 |
| Source journal | macro blocked | 26 rows; every source_json and digest checked against original exported row |
| Replay applied rows | blocked before completion | 0; journal unchanged |
| Whole-installation work counts | no unrelated writes in probe | unchanged |
| Provider requests | 0 | 0 |

The final macro plan uses the existing bounded planner once the remaining backlog fits its ordinary bound. Its canonical writes, planned index writes and knowledge guard remain one transaction. The importer does not increase any row, byte, statement or knowledge-planning limit.

Actual receipts are in before.log, after.log and before-after.json. BEFORE-PROBE.mjs preserves the exact synthetic main reproducer. The after probe and the committed journey use the same manifest digest; after.log additionally proves four fenced drain attempts and cron recovery.

## Implementation and fencing

`rowsOrIndex` calls the existing row engine for rows and row preflight. It handles only the exact KNOWLEDGE_INDEX_NOT_READY planning error. Planning has not written source rows, native targets or reference blocks at that point. The runner plans one knowledge source and commits only those existing index statements through `checkpoint`, with its ordinary run-version/token/state/session/authority guards and both workspace lease assertions. It retains the pending row cursor, releases the claims through the existing path, and schedules the next normal wake. It never retries row planning in the same quantum. Other planner failures still take the existing pause path.

The existing test-only storage barrier now exposes the real index transaction, without replacing its statements or result. Before a pending drain commits, the journey separately stops the run through HTTP, revokes its approving session, expires its workspace lease and expires its run lease. Each case blocks the transaction, retains all 25 dirty sources and leaves the index, journal, macro and cursor unchanged. Stop stays stopped; revocation pauses with import_authority_revoked; lease failures retain the existing database_unavailable pause classification. An existing admin explicitly resumes after revocation. The ordinary drain then converges and replay changes no journal row.

The earlier Worker journey remains intact and passes: 116 rows, two actual Worker process deaths, stop fencing, revoked-authority pause/takeover, two media objects/129 bytes verified, byte-exact literal reads, native-change delta conflicts and zero-row replay. The adjacent preparation registration also passes its source custody/read-only planning assertions. Registration count stays 6→6; the two touched Worker registrations execute 2/2 with no skipped or cancelled tests.

## Plan executed and checks

The complete initial plan is PLAN.md. It covered fleet identity/auth/hooks/toolchain setup, fresh-main reproduction, bounded guarded continuation, public HTTP/queue/cron and fencing assertions, touched checks, fresh-main integration/source lock, guarded publication, exact-head CI and separate report return. No helper agents were used.

Passed locally:

- Two existing Worker registrations in tests/journeys/legacy.mjs, selected by the Worker package reader and bounded legacy package names: 2 passed, 0 failed. This includes the extended source-backlog case.
- The same standalone before/after public-door probes, with identical manifest SHA-256.
- pnpm run typecheck.
- pnpm run source:lock, followed by pnpm run source:check, including regeneration after the final fresh-main rebase.
- pnpm exec rer check --profile first-party.
- cloud_run npx -y @runeditrun/rer build.
- git diff --check, a clean committed product checkout, and all candidate author/committer/trailer inspection.

The two touched registrations ran with Node 22.20.0 and pnpm 10.12.4. The supplied toolchain kept the VM's newer Node 24.19.0 for the plain pnpm typecheck/source commands; rer setup/build selected the project Node 22.20.0 itself.

An initial whole legacy-file invocation was stopped during the unrelated emitted-Worker command test's migration preparation, before any assertion result was emitted. It is recorded as interrupted/NOT COMPLETED, not as passing. Work was narrowed to the two existing Worker registrations that cover the changed runner. Initial standalone probes incorrectly used --input-type=module; this flag was inherited by Miniflare's CommonJS worker thread and blocked its bridge. An ordinary .mjs entrypoint resolved the harness issue; no workaround or instrumentation was retained in product/test runtime source.

Fresh main was fetched and rebased immediately before the candidate commit. It remained the recorded base. Source lock was generated last. Two candidate commits exist; every author and committer is Run Edit Run fleet <fleet@runeditrun.com>; no trailers. Full history was fetched before the fresh-main integration. The first real commit was immediately pushed through cloud-push.py. The first exact-head Verify found that the source lock omitted the newly added helper: the lock had been generated before staging the new file, and its tool enumerates tracked files only. This was corrected in a separate published commit containing only the generated helper entry in sources.lock.json. Main was fetched and merged (already up to date) before that correction; source lock/check passed after the helper became tracked. There was no rebase after publication and no force push.

## Honest boundaries and holds

The test uses wholly synthetic offline source data and the existing immutable package fixture upload, not a real package or a new intake path. Package upload itself remains NOT EXERCISED by this runner fixture. No provider, production, customer or DNS action was performed. Local setup used an ephemeral isolated owner and a synthetic widget origin; only the required fleet transport bundle was read for Git/GitHub authentication. No product, provider or customer secret was accessed.

NOT RUN: full local suite; browser screenshots (no UI change); production/provider/customer/real-package work; independent acceptance gate. The supported publish-check.sh scanner is absent from this cloud launcher, so the COMPLETE publication scan remains PENDING_MAC_SCAN with public base https://github.com/just-every/run-happytohelp#main and edition just-every/happytohelp. No scan PASS or bypass is claimed.

CLAIM MIGRATION-001 PARTIAL points=none

Clause status changes: none. No DONE claim. Independent gate remains required before landing; this builder neither lands, submits, deploys, tags nor releases.

## Exact-head CI

Initial head ee9e91031cd04bf99e8eeab332c24fd106b29b5f failed Verify run 43251427718 at the source-lock check; test shards were skipped and the aggregate verify job failed as a consequence. The build job log was read once through gh run view. The four-line generated-lock correction is now pushed at 7f21bac240747db1e2bed5112e92380f0646c702. Its exact-head Verify is run 43252518744 (https://github.com/just-every/run-happytohelp/actions/runs/43252518744). The final REST observation, after fifteen minutes, was in_progress with no conclusion on the exact corrected SHA. Eight of the ten GitHub calls were used. Polling ended under the brief's budget-short rule, retaining two calls rather than exhausting the budget on further status polling. The watcher was stopped; CI itself was not cancelled. Terminal custody is PUSHED, with no green, READY, acceptance or landing claim. Both attempts' discovery and receipt files are included in this packet. No dispatch, rerun or duplicate watcher is used; calls are separated by at least 300 seconds and stay within the ten-call budget.


## Handoff

The runner repair and generated lock are published. The pending exact-SHA Verify, independent gate and COMPLETE Mac publication scan remain for the lane. No account or policy ruling is missing, and no known uncorrected product failure is claimed. The initial red source-lock check was fixed without rewriting history. No PR was created. The owned clone is removed after the complete explicit report packet is transferred; all product work remains on the named branch, and the full patch and receipts remain outside the clone. No watcher or server is left for continuation.

PUSHED branch=cloud/hh-importer-index-drain-1 head=7f21bac240747db1e2bed5112e92380f0646c702
