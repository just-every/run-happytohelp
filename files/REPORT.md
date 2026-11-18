# HappyToHelp legacy import fidelity carry

Task hh-import-legacy-fidelity-1-c2. Repository just-every/run-happytohelp.

## Plan and product provenance

1. Fetch main, the gated one-commit candidate and the resolver. Check the gated and resolver tips against the brief. Create the named cloud branch from the latest advertised main.
2. Apply the gated commit with cherry-pick --no-commit. Resolve the importer catalogue against main and regenerate the lock after all other tracked work. Run contract generation and both document checks, then restore main's two generated views. Commit the resolved change once.
3. Compare both patch ranges path by path. Confirm the sole parent, both fleet identities, empty trailers and a clean tree. Push only the named cloud branch. Build the pushed head and run the two claimed journeys. Check push Verify by exact SHA.
4. Return this report and the receipts on the task's evidence ref.

| Ref | Commit |
| --- | --- |
| Gated base | bb70a0424b6f1efef5b10cb14992f1b579f1fc50 |
| Gated candidate | c91ad58f146f84520d942986dcf6974ae3f85a16 |
| Resolver inspected for comparison | 728a8baa23888290495ba6f30ef686c455bac824 |
| Advertised main at push and sole parent | 4fb1862757d389782b28cc66688302726eab37f6 |
| Pushed cloud/hh-import-legacy-fidelity-1-c2 | 71a3f8c7f08c744ab06dd724d5b6c75a75717da9 |

The product range contains one commit and one parent. The push guard succeeded on attempt 1. A subsequent Git ref probe returned the exact head.

## Patch comparison

Both ranges touch the same 39 paths. There are 37 identical per-file patches when Git's blob-ID header is excluded. Of those, 36 match byte for byte even with the header. The `docs/moving-in.md` hunk matches byte for byte. Its blob IDs differ because main edited other parts of the guide.

- `importers.json` retains both entries from main. The gated patch changes only one entry's Zendesk documentation hash and length, which now bind to the combined guide. SHA-256 is `4c592dd2d3563273396b4719d7acbb84cd454363b25a9db60862c99f2ba10a9b` and the length is 138,356 bytes.
- `sources.lock.json` was regenerated with `node scripts/edition-authoring/cli.mjs lock` from the resolved tree after restoring the two generated views. The documented lock check passed.

The patch carries the gated importer, synthetic fixtures, assertions and guide intact across the non-conflicting paths. The highest migration is 336 before and after. The source and generated contract views match main. No Base refresh, dependency pin change, migration, gate follow-up, or PR is part of the carry.

## Clause and counts

| Scope | Before | After |
| --- | --- | --- |
| MIGRATION-001 | PARTIAL | PARTIAL |
| Published clauses | 2 done, 24 partial, 0 missing | 2 done, 24 partial, 0 missing |
| Target and push further | 2 done, 47 partial, 16 missing | 2 done, 47 partial, 16 missing |
| All 91 clauses | 4 done, 71 partial, 16 missing | 4 done, 71 partial, 16 missing |

The carried qualification is for points 1 and 2. The MIGRATION-001 Status, Gap and Evidence entries retain main's wording.

CLAIM MIGRATION-001 PARTIAL points=1,2 tests=tests/helpers/legacy/custody.mjs#legacyCustodyJourney; tests/move-in/legacy-adoption-integration/journey.mjs#mountedAdoptionJourney.

## Verification

Node 22.20.0 and pnpm 10.12.4. Frozen dependency installation, typecheck, source lock check, first-party rer check, contract regeneration and both contract-document checks succeeded. Both contract generators reported current views.

The emitted build succeeded on the pushed SHA. Both claimed journeys passed on that exact checkout:

- legacyCustodyJourney completed in 232 seconds. It exercised both CLI import transports, identity and permission custody, exact historical money and media, interruption recovery, repeat, conflict refusal, no outbound work, contact erasure and replay fencing.
- mountedAdoptionJourney completed in 56 seconds. Its receipt records upload and package sizes, owned-worker stops, bounded index recovery, journal agreement, attachment completeness, unchanged work counts and successful contact erasure.

My first mounted launch used Node's inline ES module flag. Miniflare's worker inherited that flag and could not initialize its CommonJS loader. I stopped the stalled launch before assertions and confirmed the Node worker error with a minimal reproduction. The successful launch imported the same test from a temporary module file outside the checkout and ran its assertions once.

Source and index checks after both journeys show a clean checkout.

GitHub Verify run 44235519783 completed successfully on the full pushed SHA on attempt 1. The status was read through the exact-SHA Actions API. [Verify run](https://github.com/just-every/run-happytohelp/actions/runs/44235519783)
