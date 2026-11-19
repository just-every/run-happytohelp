# HappyToHelp rer 0.2.125 re-pin and Base refresh

Run Edit Run fleet builder, 2026-11-19 UTC. Task `hh-rer-repin-1`.

The product branch `cloud/hh-rer-repin-1` advertises `a5f0b8e3d2d540fa9565848a53397aef203a470a`. Its only candidate commit has parent `d845c2095b61a69df817205a43b612b0c8ec01f3`, the fetched main at the push. The product push succeeded on the first attempt. The brief specified no PR and cited HTTP 401. No PR creation was attempted.

## Execution and results

1. **Pin.** Ran `pnpm add --save-dev --save-exact @runeditrun/rer@0.2.125`, exit 0. Only the package and lockfile held an active 0.2.121 pin. A frozen install succeeded on the candidate. `pnpm exec rer --version` printed `0.2.125`.
2. **Base.** Ran `pnpm exec rer refresh-base --ref 965e8d4e105f6f4d281dacb3c099f6a958a886e7 --base ../base`, exit 0, using the full-history blobless Base checkout. The regenerated inventory preserves five declared local adaptations, including Verify, and contains 441 copy entries. Offline verification exited 0 with empty drift and unrecorded-copy lists. The refresh recorded Base's React version divergence without changing HappyToHelp's React pin. No workflow or UI source was edited by hand.
3. **Restore qualification.** Used the existing Platform archive and packaged recovery journey fixtures. A disposable copy split the existing HappyToHelp inbox migration 313 into a declared owner ledger before core migration 314, preserving their actual schema application order. Public local export succeeded and recorded the combined history. Public import into a matching pre-applied empty target failed for the matching archive and for an archive with the owner hash changed. Both ran with the published package and wrote zero fixture workspace rows. The remaining local mutations were stopped after that failure. The built HappyToHelp Worker returned HTTP 404 on the rer portability import route. The shipped recovery journey exercises its supported native D1 backup and restore path, and the operations guide documents that remote rer transfer is unsupported. No production restore route was added, and the attempted assertion set stays outside product source. The separate package-level Worker harness restored its matching interleaved fixture successfully and returned a generic schema error for an omitted owner entry.
4. **Checks.** Exact-head generated views, typecheck, first-party profile, frozen install, package version and offline Base copy verification passed. I ran the generated source lock before staging the ten newly copied files. The pre-commit check saw the same index and passed, but the pushed commit's check failed because those ten paths now participated in the lock. Exact-head `pnpm exec rer verify` stopped at that check, exit 1. I regenerated the lock in an isolated copy from the published index and verified it there, exit 0. The 40-line repair is supplied as `source-lock-correction.patch`, SHA-256 `67307aee8605daf81fa500b2f323cc1d63d55cb9cd6a1a9703ecbc38bee81af1`. The published branch was preserved under the brief's one-commit, one-push rule. The full fleet publication scan belongs to the lander.

## Restore reproduction

The local fixture uses the repository installer, actual workerd D1, the repository's migrations and its portability policy. Within otherwise equivalent scratch targets pinned to the indicated versions, run `pnpm exec rer import --input <owner.rer-or-changed.rer> --yes --non-interactive --json`. The commands read the same archive bytes across versions.
The captured executions invoked the same installed CLI entry as `node <installed-rer-package-root>/global/rer.mjs import --input <archive> --yes --non-interactive --json`. After both 0.2.125 attempts the target had zero workspace rows and zero restore jobs. The archive contains 200 applied entries and orders the owner migration between core migrations 312 and 314.

| Archive | 0.2.125 | 0.2.121 |
| --- | --- | --- |
| Matching interleaved ledger | Exit 1, `Collecting local migrations failed (Error, code ERR_SQLITE_ERROR).` Zero fixture workspace rows | Exit 4, `Import refused before restore: invalid archive structure.` Zero fixture workspace rows |
| Changed owner hash with recomputed archive checksum | Exit 1, same SQLite diagnostic. Zero fixture workspace rows | Exit 4, same archive structure refusal. Zero fixture workspace rows |

To reproduce the package's Worker handler result independently, run `node worker-history-repro.mjs <installed-rer-package-root>` with Node 22.20.0. The 0.2.125 run prints `{"case":"matching","status":200,"rows":1}` followed by `{"case":"owner entry omitted","status":409,"body":{"error":"schema_mismatch"},"rows":[]}`. It exits 1 at the assertion for `schema_mismatch:owner_migration_history`. The same command with the 0.2.121 package root exits 1 earlier during migration evidence generation with `ERR_SQLITE_ERROR` and `no such column: note`.

The unmodified Base fixture run through the installed 0.2.125 package separately passed. It observed zero rows after refusals for changed SQL bytes, a missing owner ALTER, different applied chronology and an archive-extra data-only migration, with the requested owner-history code. A destination whose applied owner file was absent also wrote zero rows and returned generic `schema_mismatch`. The package fixtures are synthetic and exercise the Worker handler with a SQLite adapter. HappyToHelp's separately built Worker probe shows its own HTTP behavior.

Archive compatibility remains version 2. An archive carrying native owner migration history from 0.2.124 or later is rejected by runners through 0.2.123. The approximately 1.18 MB release-note increase applies to a Worker that bundles the owner replay WASM. No such size increase is claimed for the HappyToHelp artifact.

## Counts and clause disposition

| Count | Before | After |
| --- | ---: | ---: |
| Clause total | 91 | 91 |
| Done | 4 | 4 |
| Partial | 71 | 71 |
| Missing | 16 | 16 |
| Journey files covered by push Verify | 32 | 32 |
| Test registrations added in the product diff | 0 | 0 |

The contract, generated views and registered tests match main. PORTABILITY-001 remains partial.

CLAIM PORTABILITY-001 PARTIAL points=none tests=tests/journeys/installer-nightly.mjs#Platform and native migration histories retain portable business data and refuse invalid ledgers through rer export and import

GAP PORTABILITY-001: The matching interleaved fixture failed local import, the built HappyToHelp Worker returned 404 for the portability route, and the rer Worker handler returned a generic error for an archive omitting the owner entry.

## Product file inventory

### Pin and dependency lock

- `package.json`
- `pnpm-lock.yaml`

### Base inventory and adapted-file records

- `base-copies.json`

### Base-origin source

- `scripts/edition-authoring/README.md`
- `scripts/edition-authoring/api-source.mjs`
- `scripts/edition-authoring/archive-source.mjs`
- `scripts/edition-authoring/base-copies.mjs`
- `scripts/edition-authoring/cli.mjs`
- `scripts/edition-authoring/project-hashes.mjs`
- `src/modules/operator-auth/accounts/oa.mjs`
- `src/modules/operator-auth/dev-admission.d.mts`
- `src/modules/operator-auth/dev-admission.mjs`
- `src/modules/operator-auth/dev-gate-script.mjs`
- `src/modules/operator-auth/dev-gate.mjs`
- `src/modules/operator-auth/routes.mjs`
- `src/modules/operator-auth/terminal-guidance.mjs`
- `src/vendor/agent-base/modules/operator-auth/README.md`
- `src/vendor/agent-base/modules/operator-auth/accounts/oa.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev-admission.d.mts`
- `src/vendor/agent-base/modules/operator-auth/dev-admission.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev-gate-script.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev-gate.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev/index.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev/persona-entry.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev/persona-grant.mjs`
- `src/vendor/agent-base/modules/operator-auth/dev/sign-in-as.mjs`
- `src/vendor/agent-base/modules/operator-auth/routes.mjs`
- `src/vendor/agent-base/modules/operator-auth/terminal-guidance.mjs`
- `src/vendor/base/modules/operator-auth/accounts/oa.mjs`
- `src/vendor/base/modules/operator-auth/dev-admission.d.mts`
- `src/vendor/base/modules/operator-auth/dev-admission.mjs`
- `src/vendor/base/modules/operator-auth/dev-gate-script.mjs`
- `src/vendor/base/modules/operator-auth/dev-gate.mjs`
- `src/vendor/base/modules/operator-auth/routes.mjs`
- `src/vendor/base/modules/operator-auth/terminal-guidance.mjs`

### Generated source

- `sources.lock.json` was the sole tracked generated output. The correction adds the ten copied files omitted from the published lock.
- Builds emitted ignored runtime, migration and delivery artifacts. The generated contract views had no diff.

### Tests

The product diff contains zero test files. The red qualification check was retained as evidence without modifying the existing journey or its assertions.

## Exact-head CI

Verify run 44633893244 completed with failure on the published SHA. The plan and contract-docs jobs succeeded. The shared build failed and the final Verify gate failed. The shard matrix, size check and push proof were skipped because the shared build failed. The nightly-only jobs were skipped on the push event. There was no green result for this head.

[Verify run 44633893244](https://github.com/just-every/run-happytohelp/actions/runs/44633893244)

## Touched journeys

- `pnpm run test:restore` exited 1 from the exact product head. The packaged recovery case stopped before archive creation at the first `rer dev` owner entry. The error was `owner_entry_not_ready` after 60000 ms. The destination was observed returning HTTP 303 and the last page rendered with HTTP 200. The derived-table archive exclusion test passed.
- The existing nightly Platform and native migration history journey exited 1 before the proposed new assertion set. Platform export, Platform restore and Platform re-export passed. Its fresh native target rejected the additive restore with exit 4 and `The portability module refused or failed the archive operation (schema_mismatch).` The reduced exact-source reproduction seeded one workspace using the same Platform and native migration paths.

The earlier comparison run of the same restore journey passed both checks. Its local clone used main's 0.2.121 pin and completed owner entry, public export/reset/import, login and erasure. The separately packaged workload in that run used the pre-commit refreshed working tree, so its pass is supporting evidence with mixed provenance.

The reduced Platform-to-native reproduction completed. From the candidate checkout, run `node platform-native-repro.mjs <installed-rer-0.2.121-package-root>` with Node 22.20.0 and the frozen candidate dependencies. Platform export with 0.2.125 exited 0. The same exported archive and seed source imported into a fresh additive native fixture with 0.2.121, exit 0. With 0.2.125 it returned exit 4 and `The portability module refused or failed the archive operation (schema_mismatch).`

The reduced owner-entry command, `rer dev --foreground --non-interactive --json` after setup, announced readiness and exited 0 after owned cleanup on both 0.2.125 and 0.2.121. This retry did not reproduce the full restore journey's startup timeout.
