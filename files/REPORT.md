# HappyToHelp mailbox history carry

| Item | Value |
| --- | --- |
| Task | hh-mailbox-import-1-c3 |
| Repository | just-every/run-happytohelp |
| Product branch | cloud/hh-mailbox-import-1-c3 |
| Product head | 8113ba7fad3b7d59eed18a21116ad4cfe2651688 |
| Sole parent, fetched main | 50a96bfebd9b0fd9e11d50bc07251db848e2a330 |
| Gated head | 041209e8a422dccbc9116a7fc08aa5aee7e35dbc |
| Gated head parent | c81b5b436ffdd14abb88c82da67b91ad89d64970 |

## Plan and result

1. Fetch main and both gated references in the declared repository. Apply the net change from the c2 gate to main without creating a merge commit.
2. Resolve the three conflicts. Keep the developer handoff and its authorization guard intact in the mailbox editor. Add the gated Mode select and corresponding history-only IMAP inputs. Keep main’s setup browser steps in place, then run the gated mailbox-history flow. Regenerate the source lock after the tracked edits.
3. Compare the full changed-path set and the per-file additions and deletions against the gated diff. Run the contract generator and checks, source lock check, typecheck and first-party rer check. Commit with the fleet identity and inspect the entire candidate range.
4. Push the single linear commit. Test the three claimed registrations and the setup browser flow on its exact checkout, capture the changed screens at 1440 and 390, and observe exact-head Verify. Return the report and receipts on the evidence branch.

The product ref was created on the first guarded push and advertised the full head above. The candidate has one commit with one parent and no co-author trailers. All 41 non-conflicting files carry the same additions and deletions as c2. In a three-line unified diff, MoveInGuide.jsx also displays updated context from main’s separate Zendesk copy change. The carried mailbox-export line matches c2. PATCH.txt records the comparisons and all three conflict resolutions.

History-only connections retain the provider read-only paths for Gmail and Microsoft and the receive-only IMAP setup. The carried paths stage selected messages for Move in review, deduplicate the history, prevent sending from a history mailbox, retain inert imported records and take a separate explicit step to turn on live mail. The product diff introduces no migration, Base refresh, version pin change, acceptance view edit or gate follow-up.

## Contract and qualification

| Scope | Before | After |
| --- | --- | --- |
| Core | 4 done, 71 partial, 11 missing | 4 done, 71 partial, 11 missing |
| Agent surface | 0 done, 0 partial, 5 missing | 0 done, 0 partial, 5 missing |
| Full target | 4 done, 71 partial, 16 missing | 4 done, 71 partial, 16 missing |
| Field proof register | 0 passed, 0 failed, 21 not run | 0 passed, 0 failed, 21 not run |
| MAIL-001, point 2 | Partial | Partial |
| MOVE-IN-002 | Partial | Partial |

The candidate carries the existing fixture claims. CONTRACT.md and both generated view files match main. The protocol and browser evidence uses isolated synthetic fixtures.

CLAIM MAIL-001 PARTIAL points=2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome; tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP

CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP; tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly

## Local verification

- Source lock, typecheck, first-party rer check, both contract generator checks and the application build passed.
- All three claimed registrations passed in one invocation on the pushed head. The customer email admission ran in 808.1 seconds, the history-only mailbox registration in 8.5 seconds, and the reviewed export, notes, repeat and undo registration in 234.0 seconds. See JOURNEYS.txt.
- The first-owner and email setup browser registration passed. It exercised both the main developer handoff steps and the carried mailbox flow. It captured five changed states at 1440 and 390. BROWSER.txt contains the original capture inventory and checksums. The packet includes the address-free Move in review captures at both widths.

## GitHub Verify

Verify run 44271744006 completed with success on the exact product head. The terminal result was observed at 2026-11-18T09:34:50Z. The preceding gated run was 44251042711 on c2. [Exact-head Verify](https://github.com/just-every/run-happytohelp/actions/runs/44271744006)

No product blockers.
