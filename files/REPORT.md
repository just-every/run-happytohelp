# HappyToHelp mailbox history carry

| Item | Revision or ref |
| --- | --- |
| Product repository | just-every/run-happytohelp |
| Product branch | cloud/hh-mailbox-import-1-c2 |
| Gated candidate | 21c744c6183d4eac6ba98e845aaa73d5227d227b |
| Gated candidate parent | b6f16fc44feaad1164753d895419bb78e61e40e3 |
| Current main and sole parent | c81b5b436ffdd14abb88c82da67b91ad89d64970 |
| Pushed product head | 041209e8a422dccbc9116a7fc08aa5aee7e35dbc |

## Plan and execution

1. Fetch main and the gated branch into a depth-200 blobless clone. Confirm the gated candidate's parent and its merge base with current main.
2. Apply the gated commit without creating a commit, on a new branch from current main. Carry both imports in the conversation routes. Main keeps its widget-address allowlist check for WebSocket origins. The gated patch adds the customer visibility filter for imported mailbox conversations in the list and single-conversation access paths. The history route, live-only sending and mode helpers apply as gated. The importer catalog applies cleanly.
3. Generate and check the contract views, restore them from main, typecheck, then regenerate the source lock and run its check and the first-party rer check. Leave the contract judgments, database migrations, Base pin, release inventory and CI files at main's versions. Carry the gated tests and assertions verbatim.
4. Compare each file patch against the gated version, inspect the one-parent commit and its identity, and push the named product branch once. Verify its advertised remote SHA.
5. Build the pushed head with Node 22.20.0 and pnpm 10.12.4. Run the three named assertions from the two claim journey files once against that head. Run the existing browser journey at 1440 with screenshots of the same surfaces at 390.
6. Observe Verify for the exact SHA and return the report, receipts and browser proof through the evidence ref.

## Comparison and custody

`git log origin/main..HEAD --format='%H %P %s'` returned one line.

```text
041209e8a422dccbc9116a7fc08aa5aee7e35dbc c81b5b436ffdd14abb88c82da67b91ad89d64970 Add read-only mailbox history imports and explicit live-mail activation
```

Both changes affect 44 paths, with 642 insertions and 98 deletions. The per-file unified patches match on 42 paths after removing the whole-blob Git index line from each diff. The matching set includes every journey and helper test and `importers.json`. All changed paths are listed in `patch-identity.json`.

- `src/modules/conversations/routes.ts` has the upstream widget-address import alongside the mailbox-history privacy import. The customer SQL filters carry the gated behavior while the socket route keeps the upstream widget-address policy.
- `sources.lock.json` was regenerated after tracked edits using `node scripts/edition-authoring/cli.mjs lock`; the output accounts for the carried files and current main.

The candidate has one verified parent and fleet author and committer identities with no trailers. The first guarded push succeeded, and a separate remote ref read returned the exact SHA. The product diff contains only the carried paths. No migrations or gate follow-ups were added. No PR was opened.

## Local checks and clause counts

| Check | Result |
| --- | --- |
| Contract generator write and check | Passed. Zero generated files changed, zero prose errors and warnings. |
| Source lock generation and check | Passed. See `source-check.txt`. |
| `pnpm run typecheck` | Passed. |
| `pnpm exec rer check --profile first-party` | Passed. |
| `git diff --check` | Passed. |
| Exact-head build | Passed. See `build.txt`. |

| Tier | Done before / after | Partial before / after | Missing before / after | Total |
| --- | --- | --- | --- | ---: |
| Core | 4 / 4 | 71 / 71 | 11 / 11 | 86 |
| Agent surface | 0 / 0 | 0 / 0 | 5 / 5 | 5 |
| Later | 0 / 0 | 0 / 0 | 0 / 0 | 0 |
| Full target | 4 / 4 | 71 / 71 | 16 / 16 | 91 |

MAIL-001 remains partial, with the carried claim for point 2. MOVE-IN-002 remains partial, with supporting journey evidence and no new point judgment. The field register remains 0 passed, 0 failed and 21 field runs not run.

## Journeys and browser proof

One invocation on the pushed head selected the three exact claim test names and ran the two files with Node's test runner and concurrency 1. The full TAP receipt records three passes, zero failures, zero cancellations and zero skips.

| Claim journey | Result | Duration |
| --- | --- | ---: |
| `tests/journeys/email.mjs` · customer email admission, scoped replies, notification privacy and uncertain outcome | Pass | 608.15 s |
| `tests/journeys/email.mjs` · read-only mailbox history for Gmail, Microsoft and IMAP | Pass | 8.49 s |
| `tests/journeys/move-in-admission.mjs` · reviewed export, private notes, repeat, repackage and exact undo | Pass | 220.97 s |

Each synthetic mailbox provided two distinct source messages, one imported thread, two imported messages and two attachments. Repeat was a no-op, undo restored the prior state exactly, send and customer access were refused, and scheduled reads stayed at zero across all three providers. The mailbox reads used GET at the HTTP provider fixtures and EXAMINE, LIST, UID SEARCH and UID FETCH BODY.PEEK at the IMAP fixture. The receipt contains only synthetic fixture results.

The candidate's existing first-owner and email setup browser test passed on the pushed head in headless system Chromium. Its mailbox assertions ran at 1440 px. The Add mailbox editor, folder picker, Move in review, history and live-mail settings, and live activation confirmation were each captured at 1440 px and 390 px. `browser-captures.json` lists all ten screenshots and hashes. The Move in review capture includes the mailbox history guide.

## Carried claims

```text
CLAIM MAIL-001 PARTIAL points=2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome; tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP
CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP; tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly
```

## Exact-head Verify

GitHub discovery at 2026-11-18T06:25:11Z returned Verify run [44251042711](https://github.com/just-every/run-happytohelp/actions/runs/44251042711), attempt 1, in progress for the pushed SHA.

At 2026-11-18T06:57:26Z, the REST run response returned completed/success for the exact pushed SHA. Verify passed on its first attempt, using 6 GitHub calls total. No blockers.
