# HappyToHelp mailbox history carry

The product branch `cloud/hh-mailbox-import-1-c4` advertises `9ad3a3f49d4535d144c221b628e576e24ad03dfc` on `just-every/run-happytohelp`. Its one commit has one parent, `8e28f7e55376dbaba509dbe29627d16aeeb36db8`. The parent is the newest main observed immediately before the product push and includes the Verify shard rebalance.

## Plan and execution

1. Set the fleet Git identity and credentials, clone without a checkout, and fetch main and c3. Create and work on c4 directly from `origin/main`.
2. Apply c3's net patch from `50a96bfebd9b0fd9e11d50bc07251db848e2a330` to `8113ba7fad3b7d59eed18a21116ad4cfe2651688` using a no-commit cherry-pick. The patch applied without conflicts. The history-mode routes and send guards, importer catalog, UI and tests all carried as written. The candidate introduced no migration.
3. Run the documented contract generation and check, restore both view files from main, and regenerate and check the source lock. Validate the staged patch, typecheck and first-party rer check. Create one fleet-authored commit, verify its complete identity and message, and push c4 through the product push guard.
4. Verify the advertised SHA and compare each file patch with the corresponding c3 patch. Build and run the three claimed test registrations and the existing mailbox setup and history browser journey on that SHA. Track the exact-SHA Verify run and publish this packet on the separate evidence ref.

The comparison found 43 byte-identical file patches across the 44 changed files. The only difference is `sources.lock.json`, produced by the documented lock command against current main. See [PATCH-RECEIPT.txt](PATCH-RECEIPT.txt) for the complete per-file comparison.

## Contract and local checks

MAIL-001 remains Partial. The carry supports the point 2 claim. MOVE-IN-002 remains Partial and carries the supporting history claim with no points claimed. The contract source is byte-identical to main.

| Clauses | Done before → after | Partial before → after | Missing before → after | Total before → after |
| --- | ---: | ---: | ---: | ---: |
| Published | 2 → 2 | 24 → 24 | 0 → 0 | 26 → 26 |
| Target and push further | 2 → 2 | 47 → 47 | 16 → 16 | 65 → 65 |
| All | 4 → 4 | 71 → 71 | 16 → 16 | 91 → 91 |

The source lock check, typecheck, first-party rer check, build, contract checks and diff check passed. The mailbox setup and history browser journey passed with accessibility and width assertions at 1440. The captures at 390 show the same screens. The packet's screenshots redact synthetic email addresses. [CHECKS-RECEIPT.json](CHECKS-RECEIPT.json), [BROWSER-RECEIPT.txt](BROWSER-RECEIPT.txt)

| Screen | Desktop 1440 | Mobile 390 |
| --- | --- | --- |
| Mailbox editor | [Desktop](browser/editor-1440.png) | [Mobile](browser/editor-390.png) |
| Folder selection | [Desktop](browser/folders-1440.png) | [Mobile](browser/folders-390.png) |
| Import review | [Desktop](browser/review-1440.png) | [Mobile](browser/review-390.png) |
| History connection | [Desktop](browser/history-1440.png) | [Mobile](browser/history-390.png) |
| Live mail opt-in | [Desktop](browser/live-step-1440.png) | [Mobile](browser/live-step-390.png) |

All three requested test registrations passed once on the advertised SHA using the build made from that checkout.

| Journey | Result |
| --- | --- |
| Email admission, scoped replies and notifications, privacy, and uncertain provider outcomes | Passed |
| Read-only mailbox history for Gmail, Microsoft and IMAP | Passed |
| Move in review, import, repeat, repackage and undo | Passed |

[JOURNEY-RECEIPT.json](JOURNEY-RECEIPT.json)

CLAIM MAIL-001 PARTIAL points=2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome; tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP

CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP; tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly

## GitHub Verify

Verify run 44279318820 completed successfully on the exact product SHA. The result was confirmed at 2026-11-18T10:14:49Z through GitHub REST. [Run 44279318820](https://github.com/just-every/run-happytohelp/actions/runs/44279318820), [CI-STATUS.json](CI-STATUS.json)
