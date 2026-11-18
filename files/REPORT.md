# HappyToHelp seed fault replay

## Plan and delivered changes

1. Clone the declared repository with history depth 200 and blob filtering. Fetch main and the two earlier task branches, then create `cloud/hh-seed-faults-3` directly from the advertised main.
2. Apply `0383239aebd8319a79f841a5f2d133d4db1ed387` without committing. It carries the four earlier fixes together. The source parent and current main matched, so the replay applied cleanly. Its Move in patch adds the refusal report while preserving main's legacy package and review behavior.
3. Check all test references to the renamed navigation link. Update the single stale link locator at `tests/helpers/identity/invitation-browser.mjs:8` from `getByRole('link',{name:'Agents',exact:true})` to `getByRole('link',{name:'Team',exact:true})`. Main renamed it in `590ccee78c2d150d73af4af4d4c1b25e276526ad` (Carry the gated owner setup design onto current main). The other identity matches label an Agents checkbox. The identity journey uses the corrected locator through the helper. Every other assertion and timeout retains its prior behavior.
4. Run the contract generator and its check, restore the two generated views to main, then regenerate and verify the source lock. Run typecheck and the first-party rer check. Verify one parent, compare every file's full patch, scan every candidate commit for the required identity and trailers, and push the single candidate through the fleet guard.
5. Check the advertised product SHA, build from it, and run each CLAIM-named browser case once. Record exact-SHA GitHub Verify separately and attach the packet by the evidence ref.

The invitation UI confirms a successful clipboard write without rendering the link as page text. Its explicit fallback exposes the value only in a read-only field when the clipboard is unavailable. Undo whole import identifies native records that block reversal and leaves the blocked changes in place.

## Product custody and patch proof

- Branch `cloud/hh-seed-faults-3`, head `a61a0cd8499323d2fa242e44b09d2fcca2a1278d`.
- One commit with one parent, `bec54d7793e87fb337c2fae45b68a07ae751f8fd`, the latest advertised main checked before the commit and push.
- The guarded product push succeeded on attempt 1. The branch advertised the exact head before the browser build. No PR was created.
- 13 of 15 full file patches match the source byte for byte, including `src/ui/native/pages/MoveIn.jsx`. The two differences are the required locator and the resulting source-lock digest. There were zero conflict resolutions. See `patch-and-contract.txt` for per-file diff checksums.
- Contract counts before and after (done, partial, missing) are 2/24/0 published, 2/47/16 target and push-further, and 4/71/16 total across 91 clauses. Main's contract status for IDENTITY-001 stays partial and MOVE-IN-001 stays done. The builder CLAIM lines retain their original PARTIAL wording for both.
- The candidate contains no changes to the contract, generated views, Base pin, or migrations.

## Local verification on the advertised product head

The exact-head build, lock check, typecheck, first-party rer check and contract generator check passed. Both named browser cases ran once with system Chromium on the pushed SHA. Identity passed 1/1 and Move in passed 1/1. The Move in case recorded 77 checks with zero serious or critical accessibility findings, zero horizontal overflow and zero uncaught page errors.

The undo fixture exercised three distinct results. Undo completed for an import whose historical staff member later became a native teammate, and the teammate remained present. A changed native contact produced one named conflict. A later native reference stopped undo at checkpoint 0 and retained all 44 changes. The response counted 22 conflicts and named the 20 shown in the bounded list.

The packet includes 1440 px and 390 px captures of the clipboard confirmation and the named undo refusal. The captures mask visible fixture email text.

## GitHub Verify

The push-triggered Verify run 44294938530 completed successfully on the exact product head. The final REST receipt records the branch SHA, the run ID, its result, and the timestamped status observations. [Verify run](https://github.com/just-every/run-happytohelp/actions/runs/44294938530)

CLAIM IDENTITY-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session

CLAIM MOVE-IN-001 PARTIAL points=none tests=tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
