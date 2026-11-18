# HappyToHelp Verify shard balance

Branch `cloud/hh-ci-shard-balance-1` at `729c3989345ff2e156945f0c4996c12e3d9b343e`. One commit based on `154b8d638f3332ac29da9398a162fe48345b6aae` from `origin/main`. The remote branch advertised the same head after the guarded push.

## Plan and change

- Measure per-file runtime in two successful Verify runs using top-level Node TAP `duration_ms`. Assign each subtest by its unique title in the journey files named in its shard command.
- Move `restore.mjs` to `public-and-import-browser`, `move-in-admission.mjs` to `connections-and-computers`, and `first-run.mjs` to `identity-and-repair-browser`. This splits the two longest shards and uses spare capacity to trim the identity shard. Each file moves intact.
- Check the push matrix against the existing route and browser script lists during Verify planning. Check the names and exact membership, including duplicate assignments and any browser journey without Chromium.
- Regenerate the source lock after the tracked edits. Run the coverage check, lock check, typecheck and first-party rer check, then measure the new layout on the pushed SHA.

The eight shard names, browser flags, job dependencies and 30-minute timeouts are preserved. The coverage receipt records the same 32 direct journey files before and after (25 route, 7 browser). Contract counts are 4 done, 71 partial, 16 missing out of 91 before and after. No clause status, gap or evidence changed.

## Historical measurements and projection

A is [Verify 44209178990](https://github.com/just-every/run-happytohelp/actions/runs/44209178990). B is [Verify 44212333009](https://github.com/just-every/run-happytohelp/actions/runs/44212333009). The GitHub CLI downloaded both workflow archives. Its rendered log output was empty, so the measurement reads the same TAP from the cached ZIPs. All 116 top-level TAP tests per run matched a unique journey file and passed. The latest two successful pushes on main reused existing proof and had no shard logs.

Journey numbers in parentheses are measured TAP minutes in A/B order. File paths are relative to `tests/journeys/`, with `.mjs` omitted. Before wall time spans the first and last archived job-log timestamps. For each run, the projection sums the reassigned files' TAP times and retains each destination shard's measured runner overhead. The maximum expected wall time fell from **23.74** to **20.43 minutes**. The highest of the 16 paired projections is **21.21 minutes**.

| Verify shard | Before journey files | After journey files | Before wall (A/B min) | Projected wall (A/B min) | Projected mean (min) |
| --- | --- | --- | ---: | ---: | ---: |
| identity-and-desk | identity (1.58/2.28), erasure (6.76/9.87), inbox (3.32/4.60), first-run (1.42/2.02), customers (2.15/2.44) | identity (1.58/2.28), erasure (6.76/9.87), inbox (3.32/4.60), customers (2.15/2.44) | 15.66/21.71 | 14.24/19.69 | 16.96 |
| assistant-and-knowledge | ai (2.46/2.56), context (0.31/0.32), knowledge (5.90/5.92), email (8.64/8.59) | ai (2.46/2.56), context (0.31/0.32), knowledge (5.90/5.92), email (8.64/8.59) | 17.91/17.95 | 17.91/17.95 | 17.93 |
| connections-and-computers | connections (4.52/3.12), widget (0.09/0.07), delegation (2.83/1.97), delegation-computers (0.61/0.42), connector (0.14/0.10), upgrade (1.18/0.84), runtime (1.40/1.08), provider-preflight (0.02/0.01) | connections (4.52/3.12), widget (0.09/0.07), delegation (2.83/1.97), delegation-computers (0.61/0.42), connector (0.14/0.10), upgrade (1.18/0.84), runtime (1.40/1.08), provider-preflight (0.02/0.01), move-in-admission (6.83/10.97) | 11.36/8.13 | 18.19/19.11 | 18.65 |
| import-and-reports | move-in-admission (6.83/10.97), move-in-custody (0.53/0.83), move-in-erasure (0.16/0.24), move-in-zendesk-pull (0.94/1.42), reports (0.52/0.81), legacy (5.95/9.36), public (3.22/4.25) | move-in-custody (0.53/0.83), move-in-erasure (0.16/0.24), move-in-zendesk-pull (0.94/1.42), reports (0.52/0.81), legacy (5.95/9.36), public (3.22/4.25) | 18.58/28.38 | 11.75/17.41 | 14.58 |
| support-workflow-browser | workflows-browser (18.08/14.46) | workflows-browser (18.08/14.46) | 18.66/15.07 | 18.66/15.07 | 16.87 |
| support-and-recovery | inbox-browser (16.75/12.81), restore (9.82/6.82) | inbox-browser (16.75/12.81) | 27.28/20.20 | 17.46/13.38 | 15.42 |
| identity-and-repair-browser | identity-browser (8.45/12.07), delegation-browser (1.14/1.42) | identity-browser (8.45/12.07), delegation-browser (1.14/1.42), first-run (1.42/2.02) | 10.22/14.24 | 11.65/16.26 | 13.95 |
| public-and-import-browser | public-browser (6.69/7.41), move-in-browser (2.69/3.16), erasure-browser (1.23/1.37) | public-browser (6.69/7.41), move-in-browser (2.69/3.16), erasure-browser (1.23/1.37), restore (9.82/6.82) | 11.39/12.83 | 21.21/19.65 | 20.43 |

## Local checks

```text
Coverage check: 32/32 journey files exactly once before and after. Same file set and same workflow shape outside shard commands.
Coverage failure cases: duplicate, omission and browser assignment without Chromium rejected.
Source lock regenerated last: node scripts/edition-authoring/cli.mjs lock — exit 0.
Node 22.20.0 / pnpm 10.12.4:
  node scripts/edition-authoring/cli.mjs check — exit 0.
  pnpm run typecheck — exit 0.
  pnpm exec rer check --profile first-party — exit 0.
  node src/site/base/contract-docs.mjs check — exit 0.
  node scripts/contract-docs.mjs check — exit 0.
  node scripts/ci/verify-lifecycle.mjs --plan — exit 0, full coverage selected.
  git diff --check origin/main..HEAD — exit 0.
Cloud frozen dependency install, rer setup with a private checkout-local answers file, and rer build — exit 0.
The branch advertises the commit recorded in ci-receipt.json.
```

See `coverage.txt` for the full inventory, workflow shape comparison and failure cases. See `timings.csv` for the file-level inputs and assignments.

## Exact-head Verify

Exact-head Verify completed successfully. [Verify 44229637158](https://github.com/just-every/run-happytohelp/actions/runs/44229637158).

| Verify shard | Job ID | Conclusion | Wall time |
| --- | ---: | --- | ---: |
| identity-and-desk | 134551807515 | success | 19:30 |
| assistant-and-knowledge | 134551807417 | success | 18:06 |
| connections-and-computers | 134551807496 | success | 23:23 |
| import-and-reports | 134551807404 | success | 15:42 |
| support-workflow-browser | 134551807598 | success | 13:07 |
| support-and-recovery | 134551807389 | success | 13:50 |
| identity-and-repair-browser | 134551807606 | success | 15:13 |
| public-and-import-browser | 134551807403 | success | 23:18 |

Longest exact-head shard was **23:23** (Verify / connections-and-computers). All eight finished within 24 minutes.

