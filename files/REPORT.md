# HappyToHelp Base copy verification

Fleet builder, 2026-11-21. Repository just-every/run-happytohelp, task hh-verify-base-ignores-1.

The product branch cloud/hh-verify-base-ignores-1 advertises 90e82986d345e1e9f91068ba8b1ea99b88cc2822. Its sole commit and parent were verified against origin/main at c9f4904b175366d0226fc2a4c33348d6e4f8ffc9 immediately before the push. The fleet push guard published the branch on its first attempt.

## Plan and results

1. Reproduce the source-origin findings on main before editing. The documented online verifier acquired Base through its built-in Git reader. The inventory's only recorded Base revision was c21583b3c700fd5d58e3fae820662ee0bf430af6. The verifier exited 1, with 441 copy entries, no drift and exactly the two unrecorded paths listed below.
2. Append both exact applied migration paths to the existing ignore array, stage the inventory and run the declared source lock command last. The inventory still has schema version 1 and 441 copy entries. The ignore array grew from 1 to 3 entries. Both migrations have identical bytes at main and candidate. The regenerated lock changed only the inventory's SHA-256. The product diff contains two files.

       base-copies.json  | 4 +++-
       sources.lock.json | 2 +-
       2 files changed, 4 insertions(+), 2 deletions(-)

3. Verify the committed candidate. Online Base verification exited 0 with 441 copy entries, no drift and no unrecorded copies. Offline Base verification exited 0 with no drift. The authoring lock and check, first-party profile check, typecheck, and both contract document checks exited 0. The baseline and candidate online results were identical across the launcher-selected Node 24.19.0 and the repository-pinned Node 22.20.0.
4. Inspect the full candidate ancestry before pushing. The range contained one single-parent commit with fleet author and committer identity and zero trailers. The full publication scan belongs to the fleet lander.

## Online output

The main run of node scripts/edition-authoring/cli.mjs verify-base exited 1.

    "ok": false
    "drift": []
    "unrecordedCopies": [
      {
        "path": "migrations/277_agent_door.sql",
        "originPath": "modules/agent-door/tests/fixtures/schema-0.2.93/agent-door.sql",
        "revision": "c21583b3c700fd5d58e3fae820662ee0bf430af6"
      },
      {
        "path": "migrations/316_agent_door_relay_privacy.sql",
        "originPath": "default-seed/migrations/core/0043_agent_door_relay_privacy.sql",
        "revision": "c21583b3c700fd5d58e3fae820662ee0bf430af6"
      }
    ]

The candidate run exited 0.

    "ok": true
    "drift": []
    "unrecordedCopies": []

No other unrecorded path appeared in either online check.

## Applied SQL fingerprints

| Migration | SHA-256 before and after |
| --- | --- |
| migrations/277_agent_door.sql | 016d8a98b964385f5c4a13447361c3c783910a76aaf4606b0e0081482bc819cc |
| migrations/316_agent_door_relay_privacy.sql | fb9e276013234f2f3afbd10dc654e93edc361b2165fd4cb2c0273ce44ab70a7a |

## Contract

SOURCE-001 stayed partial. Contract progress stayed at 4 done, 71 partial and 16 missing across 91 clauses.

CLAIM SOURCE-001 PARTIAL points=none tests=

## Exact-head GitHub Verify

The push Verify run 44907979368 finished with conclusion success. GitHub reported the exact product head 90e82986d345e1e9f91068ba8b1ea99b88cc2822. [GitHub Verify](https://github.com/just-every/run-happytohelp/actions/runs/44907979368)

| Job | ID | Conclusion |
| --- | ---: | --- |
| plan | 136857536858 | success |
| contract-docs | 136857537030 | success |
| build | 136857619994 | success |
| slow | 136857621230 | skipped |
| size-check | 136857884302 | success |
| Verify / support-workflow-browser | 136857884394 | success |
| Verify / support-and-recovery | 136857884434 | success |
| Verify / assistant-and-knowledge | 136857884437 | success |
| Verify / import-and-reports | 136857884453 | success |
| Verify / identity-and-repair-browser | 136857884463 | success |
| Verify / public-and-import-browser | 136857884487 | success |
| Verify / connections-and-computers | 136857884493 | success |
| Verify / identity-and-desk | 136857884502 | success |
| nightly-proof | 136858677895 | skipped |
| full-push-proof | 136863887653 | success |
| verify | 136863908291 | success |

Every job that ran succeeded. 14 jobs succeeded and 2 were skipped.
