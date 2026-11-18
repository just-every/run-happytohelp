# HappyToHelp owner inbox design round

Task hh-owner-design-inbox-1-c3 carries decisions D4, D11, D13, D14, D15, D16, D18, D21, and D22 to the latest main. The plan was to read the earlier Verify rerun, compare the predecessor's parent with main, reuse the original SHA if the parent matched, verify patch parity and touched checks, and wait for a completed Verify of that exact SHA. A repeat procedures race after the permitted rerun would trigger the brief's conditional review of the known fix.

## Product custody

- Repository `just-every/run-happytohelp`
- Branch `cloud/hh-owner-design-inbox-1-c3`
- Pushed head `08ab40cf54560e2bbc43a7e38ee4419f93503b8f`
- Sole parent `154b8d638f3332ac29da9398a162fe48345b6aae`, the advertised main at publication
- The c2 head already had that parent. The branch advanced directly to the c2 commit and the remote advertised the same SHA on the first push. One candidate commit, one parent, fleet author and committer, zero trailers, no PR.
- No changes were made during this round to the candidate code, tests, source lock, Base, pins, contract, or generated views. The procedures race patch was not incorporated.

## Patch comparison

Compared the original c1 round `bb70a0424b6f1efef5b10cb14992f1b579f1fc50..4fd307fda11bcee6391689fc36b701e7a1c91aa7` with `origin/main..HEAD`. Each range changes the same 56 files, with 354 insertions and 141 deletions. There were 53 byte-identical per-file patches including the Git blob IDs, and 54 when excluding those IDs.

- `src/modules/management/projects.ts` has identical hunks. Its blob IDs reflect main's separate password-installation confirmation in `/profile`. The candidate still adds `mailMode` to `/bootstrap`. The historical replay had no content conflict here.
- `tests/journeys/identity.mjs` had an end-of-file conflict in the historical replay. The carried commit keeps main's four owner-installation journeys and appends the candidate audit-access journey. The candidate's added lines are identical.
- `sources.lock.json` had a content conflict in the historical replay. The carried lock describes the combined source tree. The lock check passed for all 4,147 recorded files.
- The current round reused the resulting commit as-is. The per-file comparison and reproduced three-way conflict list are in `patch-parity.txt`.

## Checks and clause accounting

The source lock check, both contract-document checks, typecheck, and `rer check --profile first-party` passed with Node 22.20.0 and pnpm 10.12.4. The product checkout was clean. Browser journeys are delegated to exact-head Verify as directed by the brief. Its browser shards upload captures to the run summary. The saved-reply, bulk preview and inbox paths captured by the knowledge-reference journey use 1440 and 390 CSS pixels.

| Scope | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core, before and after | 4 | 71 | 11 | 86 |
| Agent surface, before and after | 0 | 0 | 5 | 5 |
| Later, before and after | 0 | 0 | 0 | 0 |
| Full target, before and after | 4 | 71 | 16 | 91 |

AUDIT-001, CUSTOMER-001 and STATUS-001 remain PARTIAL, with no points or contract edits.

## Exact-head Verify

The prior run 44207467165 was on its second attempt when this task began. GitHub confirmed completed/success at 02:11:36 UTC on `08ab40cf54560e2bbc43a7e38ee4419f93503b8f`. This satisfies the identical-SHA reuse rule in the brief. [Verify 44207467165](https://github.com/just-every/run-happytohelp/actions/runs/44207467165)

The c3 push also started Verify 44218250184 on the same SHA. The reused successful run is the readiness receipt. [Verify 44218250184](https://github.com/just-every/run-happytohelp/actions/runs/44218250184)

The claimed journeys are covered by Verify's identity-and-repair-browser, support-and-recovery, and support-workflow-browser shards. The earlier support-workflow browser failure and import-and-reports timeout were addressed by the existing failed-job rerun. There is no product blocker.

The exact-head browser evidence source is recorded in `browser-evidence-source.txt`. The attempt to copy its 1440- and 390-pixel captures into this packet reached a storage redirect that returned Forbidden. The product's Verify conclusion remains successful. [Browser evidence run](https://github.com/just-every/run-happytohelp/actions/runs/44207467165)

CLAIM AUDIT-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session

CLAIM CUSTOMER-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#an operator replies from the phone inbox, opens a company customer and reviews and reverses a labelled identity link without changing customer authority

CLAIM STATUS-001 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow
