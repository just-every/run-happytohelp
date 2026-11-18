# HappyToHelp owner Setup carry

Run Edit Run fleet · 2026-11-18 UTC · hh-owner-design-setup-1-c2

The gated five-commit candidate was 64f10a3948135a164d878c7313be6c45aafacf8f on bb70a0424b6f1efef5b10cb14992f1b579f1fc50. The carry is one commit with one parent, 154b8d638f3332ac29da9398a162fe48345b6aae, which matched the advertised main at publication. The product branch is cloud/hh-owner-design-setup-1-c2 and its remote head is dd123992c1bc1f308fa8eb3b3b8380df8926c936. The guarded push passed on the first attempt. Release and landing remain with the lane.

## Carried decisions

| Decision | Change |
| --- | --- |
| D6 | Shared owner-to-developer hand-off for AI keys, including the conversation generation error. Email and clipboard carry the same instructions. |
| D7 | AI and Setup show provider billing and the recorded-use safety limit. |
| D8 | Setup and Email share the local-mail banner. Unconfigured Gmail and Microsoft show provider-specific setup instructions. |
| D9 | Zendesk uses an account-manager hand-off and a plain export introduction. |
| D10 | The original-service screen names who can produce the export and links to the existing exporter documentation. |
| D12 | Everyday Settings links lead. Business hours and Help center have dedicated native routes, and Advanced discloses the remaining destinations. |

## Replay and custody

The original net patch and this branch change the same 39 paths. All 36 paths without conflicts match by zero-context diff hunks, comparing removed and added bytes without whitespace normalization and ignoring changed line offsets and patch metadata. The three remaining paths all had Git conflicts.

- src/ui/native/pages/MoveInGuide.jsx keeps main's supported-format sentences and Check what stays behind link alongside the gated plain explanation and collapsible developer Details.
- tests/helpers/first-run/outcomes.mjs keeps the updated developer disclosure label from main and scopes the click to the widget control. The server-secret, reveal, example language and installed-widget assertions still run.
- sources.lock.json was regenerated after the tracked edits using the documented lock command and passed its check.

Main's device-time-zone behavior and Zendesk loss-review assertion survived the automatic merges. Main's contract passed generation and check without document changes. The two generated views were restored from main. There were zero clause Status, Gap or Evidence edits. No migration, release, package pin, Base refresh, gate follow-up or PR was part of this carry.

| Count | Before | After |
| --- | ---: | ---: |
| Candidate commits | 5 | 1 |
| Settings destinations | 26 | 28 |
| Everyday Settings links | 26 | 9 |
| Settings links under Advanced | 0 | 19 |
| Top-level test registrations in tests/journeys | 123 | 123 |
| Full contract clauses done / partial / missing | 4 / 71 / 16 | 4 / 71 / 16 |
| Top-level migration ceiling | 336 | 336 |

Both commit identities are Run Edit Run fleet <fleet@runeditrun.com>. The one-commit candidate has no trailers. See commit-and-parent.txt, identity-audit.txt, patch-comparison.json and remote-product-head.txt.

## Validation

Node 22.20.0 and pnpm 10.12.4 ran the frozen install, local rer setup and build, typecheck, first-party rer check, contract generation/check and source lock/check. All returned zero. The build kept the tracked checkout clean. The journey and browser checks use the emitted Worker, system Chromium and isolated synthetic data. See static-checks.json and the terminal receipt for commands, results and provenance.

| Affected journey | Result |
| --- | --- |
| First-run provision, Setup receipts, configured-provider fixture, daily allowance and mail outcomes | Passed |
| First and signed-in owner Setup and working widget, including the local-email hand-off and Settings navigation | Passed |
| Zendesk connection, review, import, repeat and undo, including the original-service export flow | Passed |
| Saved procedure definitions, revision and evaluation before release | Passed |
| Blocked procedure simulation and its missing-provider hand-off | Passed as part of the saved procedure registration |
| Native Settings saves for owner and admin, with collaborator, operator and narrowed-admin refusal | Passed |

All five TAP receipts underpin the six journeys. The Move in journey recorded 77 browser checks and zero page errors. The standalone proof recorded 18 paired states at 1440 and 390, with zero page errors and no horizontal overflow. It includes the combined Zendesk guide at both widths and the AI hand-off from a real conversation action. Proof is in browser/current-head, with file hashes and layout results in metrics.json. Additional captured receipts cover the installed widget, blocked procedure and native Settings journeys.

The first native Settings harness omitted its synthetic workspace's allowed origin, yielding a 400 on save. A correctly bootstrapped workspace passed the same helper. The screenshot harness needed a case-sensitive Help center selector correction and then passed. Three shell exit receipts were interrupted by an edit to the temporary wrapper. The complete TAP output confirmed that each affected test passed. These corrections affected only temporary validation scripts.

The browser runs establish local product behavior using isolated fixtures and no live or paid provider checks. No Mac publication scan, landing or PR was performed.

## Exact-head Verify

Run 44209178990 on dd123992c1bc1f308fa8eb3b3b8380df8926c936 returned completed/success.
GitHub REST calls used 5 of 10. See ci-discovery.json and the polling receipts for the exact head and URL.

## Candidate claims

CLAIM FIRST-RUN-001 PARTIAL points=1 tests=tests/journeys/identity-browser.mjs#a first owner and a signed-in owner reach Setup and install a working widget
CLAIM PROCEDURE-001 PARTIAL points=1 tests=tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release

READY branch=cloud/hh-owner-design-setup-1-c2 head=dd123992c1bc1f308fa8eb3b3b8380df8926c936
