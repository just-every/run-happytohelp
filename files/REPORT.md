# HappyToHelp owner inbox replay

Repository `just-every/run-happytohelp`  
Branch `cloud/hh-owner-design-inbox-1-c2`  
Pushed head `08ab40cf54560e2bbc43a7e38ee4419f93503b8f`  
Sole parent `154b8d638f3332ac29da9398a162fe48345b6aae`  
Original candidate `4fd307fda11bcee6391689fc36b701e7a1c91aa7`  
Original base `bb70a0424b6f1efef5b10cb14992f1b579f1fc50`

## Plan and replay

1. Clone with blob filtering and depth 200. Fetch main, the previous candidate, and the historical resolver. Confirm the main tip again before the commit.
2. Replay the net patch for D4, D11, D13, D14, D15, D16, D18, D21 and D22 with a squash onto main. Resolve the two unmerged paths and preserve main's contract.
3. Regenerate the contract views and run their check. Restore the views from main. Regenerate the source lock as the last tracked edit and check it, then run typecheck and the first-party rer check.
4. Audit the complete outgoing range, publish the single-parent commit on the named branch, and run the touched journeys and browser proof against the published SHA. Use GitHub Verify for the exact SHA and publish the evidence separately.

The resolver was consulted for the identity conflict. The candidate branch descends directly from main. `git log origin/main..HEAD` has one entry and the commit has one parent. Author and committer are both `Run Edit Run fleet <fleet@runeditrun.com>`. The commit message has zero trailers. The product branch was pushed once and checked using the remote ref. No PR was created.

## Patch comparison

| Range | Commits | Files | Insertions | Deletions |
| --- | ---: | ---: | ---: | ---: |
| Original base to original candidate | 5 | 56 | 354 | 141 |
| Latest main to replay | 1 | 56 | 354 | 141 |

Both ranges touch the same paths. Per-file Git patches are equal for **54 of 56 files** after normalizing blob IDs and absolute hunk offsets. The comparison retains modes, text, patch context, and hunk sizes.

- `tests/journeys/identity.mjs` had overlapping insertions. Kept all four main first-hour registrations covering local owner re-entry, password setup, timezone choice, and authenticated widget confirmation. Appended the candidate's saved-reply audit registration, which checks that names respect personal and role visibility. No test bodies or assertions were dropped or weakened.
- `sources.lock.json` conflicted because both sides changed source custody. Used main's lock as the starting point and ran `node scripts/edition-authoring/cli.mjs lock` after every other tracked change, then ran its check.

The two sides also edited `src/modules/management/projects.ts` in independent hunks. The automatic merge kept main's profile password-custody field and the candidate's bootstrap mail mode. Its normalized patch matches the original candidate. Main's highest migration was `336_solved_time_rule_reads.sql`. The candidate adds no migration, Base refresh, dependency pin change, or generated contract view.

## Contract and before/after counts

The full target remains **4 done, 71 partial, 16 missing (91)**. Core remains **4 done, 71 partial, 11 missing (86)**. The agent surface remains **0 done, 0 partial, 5 missing (5)**. The three claims below remain partial with zero points. The replay changes no contract Status, Gap or Evidence.

- `AUDIT-001` remains partial. The exact claim exercises scanner-safe one-use sign-in, factor enrollment and passkey login, step-up audit export, and current-session sign-out.
- `CUSTOMER-001` remains partial. The exact claim covers the phone inbox reply, company customer, and labelled link/unlink without customer authority changes.
- `STATUS-001` remains partial. The exact claim covers ticket fields, queue configuration, bulk preview/apply and workflow preview/publish/pause.

## Local checks

- `git diff --check`, regenerated contract views and contract check, declared source lock command and source check, `pnpm run typecheck`, and `pnpm exec rer check --profile first-party` passed.
- `npx -y @runeditrun/rer build` passed under Node 22.20.0 and pnpm 10.12.4. The build used the same tracked tree as the pushed commit.
- The pushed checkout was clean before the journey run. The journeys used the repository's emitted runtime and synthetic fixtures, with system Chromium and no sandbox.
- Both contract check entrypoints pass. The documented generator wrote zero contract documents.
- An additional offline Base copy audit reported that the adaptation hash for the Verify workflow is stale. The workflow and the adaptation record have byte-identical copies on main and at the pushed head. This inherited audit result is outside the Verify workflow and the instructed replay patch.
- The non-interactive local setup completed with private fixture answers after the journey processes closed.

## Journeys on the pushed head

| Journey | Passed | Total |
| --- | ---: | ---: |
| tests/journeys/customers.mjs | 3 | 3 |
| tests/journeys/identity-browser.mjs | 7 | 7 |
| tests/journeys/identity.mjs | 15 | 15 |
| tests/journeys/inbox-browser.mjs | 7 | 7 |
| tests/journeys/workflows-browser.mjs | 9 | 10 |
| **Total** | **41** | **42** |

The completed local verification returned 1. JOURNEYS.json records the individual results, plus dimensions and SHA-256 for each of the 30 paired screenshot files.

The cloud environment reattached during the original workflow-browser file and stopped the test process after four files had reported. The recovery ran all ten registered workflow cases in disjoint groups on the same SHA. The receipt retains the original results from the four completed files.

Failed local assertions

- tests/journeys/workflows-browser.mjs — a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow. TypeError: fetch failed during the synthetic webhook test POST in tests/helpers/api001-outcomes-browser.mjs:25

## Exact-head GitHub Verify

Run 44207467165 reported completed/failure for 08ab40cf54560e2bbc43a7e38ee4419f93503b8f. [Verify run](https://github.com/just-every/run-happytohelp/actions/runs/44207467165)

- `Verify / support-workflow-browser` job 134477822300 failed at `Run shard checks`. The single archive command `gh run view 44207467165 --repo just-every/run-happytohelp --job 134477822300 --log-failed` exited 0 with zero output bytes. It returned no assertion or HTTP error.
- `Verify / import-and-reports` job 134477822277 was cancelled during `Run shard checks` after 30 minutes 18 seconds, consistent with the configured 30-minute job timeout.
- The aggregate `verify` job 134491845810 failed at `Require the plan and every selected check`. The contract docs, build and size check jobs succeeded. The two jobs associated with the brief's known flaky cases, `support-and-recovery` and `identity-and-repair-browser`, both succeeded.
- The failed browser job's check-run annotations contained the generic failure “Process completed with exit code 1” and a Node action-runtime deprecation warning. Neither response identified the CI assertion.
