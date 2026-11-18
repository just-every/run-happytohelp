# HappyToHelp mailbox history carry

The branch `cloud/hh-mailbox-import-1-c5` contains commit `6113a584bab1ceb31808de200d69444625214dfd`. Its sole parent, `a61a0cd8499323d2fa242e44b09d2fcca2a1278d`, was the advertised main tip at the precommit check. The product push created the branch on the first attempt. The lane owns landing.

## Replay and conflict resolution

1. Apply the gated c4 patch from `9ad3a3f49d4535d144c221b628e576e24ad03dfc` without creating a commit during cherry-pick. Keep the behavior for Gmail, Microsoft and IMAP history-only mailbox connections, reviewed Move in imports, blocked sending, and explicit promotion to live mail.
2. Preserve the importer catalogue from main. Compute the Zendesk evidence fields from the merged bytes of `docs/moving-in.md`. The guide is 140,665 bytes with SHA-256 `4d75d0221379e1b3b767e1df1a678f19e0f0a5658b4fb8b14523c96464ad1912`. Keep the candidate's mailbox guide addition and main's later copy.
3. Run the contract generator and its check. Both generated views were current and the contract source matched main. Regenerate the source lock after the resolution and verify it.
4. Compare every file-level patch from the new commit to the original c4 patch, retaining hunk content, context, and modes while ignoring blob IDs and line offsets. **42 of 44** patches matched. Only `importers.json` (guide digest and byte count) and `sources.lock.json` (regenerated from the merged tree) differed. The route files, every test, and both cleanly merged UI and documentation hunks matched.
5. Run local checks and build with Node 22.20.0 and pnpm 10.12.4. Inspect the complete candidate ancestry and trailers, then push the single linear commit under the fleet identity. Run the exact-head fixture journeys and browser proof, then read the exact-SHA Verify outcome.

The carry includes the gated patch in one commit. It required zero migrations, pin changes, or additional follow-ups. Main's highest migration prefix was 336. The product branch contains the replay and two conflict resolutions. The packet is carried on a separate evidence ref.

## Contract counts and claims

| Tier | Done before and after | Partial before and after | Missing before and after |
| --- | ---: | ---: | ---: |
| Core | 4 | 71 | 11 |
| Agent surface | 0 | 0 | 5 |
| Later | 0 | 0 | 0 |
| Full target | 4 | 71 | 16 |

MAIL-001 and MOVE-IN-002 both remain Partial. MAIL-001 carries point 2 and MOVE-IN-002 carries supporting evidence without a point claim. The provider evidence uses synthetic network edges. Field qualification remains 0 passed, 0 failed, 21 unrun.

CLAIM MAIL-001 PARTIAL points=2 tests=tests/journeys/email.mjs#a customer email is admitted once, receives safe scoped replies and notifications, keeps suspicious and partner mail private and never replays an uncertain provider outcome; tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP

CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/email.mjs#read-only mailbox history uses reviewed inert imports, deduplicates selected folders, refuses sending and undoes unchanged records for Gmail, Microsoft and IMAP; tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly

## Exact-head local checks

- Source lock check, contract generation/check, typecheck, first-party rer check, build, Git whitespace check, and runtime secret declaration check passed.
- Three targeted tests passed in the two journey files. The email admission journey covered safe scoped replies, notification and private-mail boundaries, and uncertain-outcome replay prevention. The history journey covered reviewed inert Gmail, Microsoft and IMAP imports, overlap deduplication, send refusal and exact undo. The Move in journey covered reviewed history, private notes, repeat and repackage idempotency, exact undo, and the Zendesk catalogue evidence assertion.
- The email setup browser journey passed. The packet includes the history editor, folder selection, connected history mailbox, live mail confirmation, and Move in review at 1440 and 390 pixels. Mailbox-history browser assertions ran at 1440. The 390 captures record the phone layout. The public captures mask synthetic addresses.
- The optional offline Base-origin comparison reported one inherited adaptation digest mismatch for `.github/workflows/verify.yml`. The workflow and its adaptation record are byte-identical to main. This command is outside the push Verify workflow.
- Non-interactive setup passed with a contained, owner-only local answers file. The initial invocation needed two required fields, and the CLI refused a temporary answers path outside the checkout. The final fixture run used the checkout-local path and exited successfully.

## GitHub Verify

Verify run 44396187234, attempt 1, completed successfully on `6113a584bab1ceb31808de200d69444625214dfd`. No CI rerun was needed. [Verify run](https://github.com/just-every/run-happytohelp/actions/runs/44396187234)
