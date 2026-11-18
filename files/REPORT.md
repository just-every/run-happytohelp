# HappyToHelp seed fault replay

Fleet tag `hh-seed-faults-2` in `just-every/run-happytohelp`. The product branch `cloud/hh-seed-faults-2` was pushed once at `0383239aebd8319a79f841a5f2d133d4db1ed387`. Its sole parent is the main tip advertised before publication, `bec54d7793e87fb337c2fae45b68a07ae751f8fd`.

## Replay plan and results

1. Read the first builder’s evidence and diff all four commits from merge base `55e2f106c506e4f671d2e474c737124e760e2233` through `8e1369c07ff53f3be328f9cdb7f2c766075055e3`. Reapply the net patch with Git’s three-way merge tree and commit the result once on the named branch.
2. Resolve the three tracked conflicts. Keep the current export and legacy-fidelity UI and integrate the named Undo conflict report. Derive the importer guide receipt from the merged document. Regenerate the source lock last using the seed’s command.
3. Regenerate and check the contract views, restore the checked-in main views, and verify the source, typecheck and first-party rer checks. Audit the full candidate range for fleet identities and trailers, then publish the one-parent product commit through the fleet guard.
4. Build the pushed SHA, run each CLAIM-named journey once against its emitted Worker, and collect the changed screens at 1440 and 390. Observe the exact-SHA GitHub Verify and publish the report and actual receipts to the evidence ref.

### Product behavior

- A pending invitation’s Copy link action sends the issued link to the clipboard and confirms the copy without repeating the capability in page text or announcements. When copying fails, the user can explicitly choose Show invitation link to reveal a read-only field.
- Strict whole-import undo names the records blocking reversal. It checks up to twenty records per diagnostic turn, names up to twenty conflicts and counts the rest. It preserves later native work and keeps progress tied to committed reversals. A native staff account matching a historical author alone does not block undo.

### Linearity and patch equality

`git log origin/main..HEAD` contains exactly one commit. The parent check, clean-tree state and per-file comparison are recorded in `patch-and-provenance.json`. The old net patch and replay each change 15 files. All 12 conflict-free files have equal patch hunks. Ten match byte for byte. Two have identical hunk content and differ only in blob IDs or hunk locations.

| Path | Reconciliation |
| --- | --- |
| `docs/moving-in.md` | Main added guide material elsewhere. The Undo hunk matches, with updated Git coordinates and IDs. |
| `tests/helpers/identity/security-browser.mjs` | The candidate invitation additions match. Main’s later “Completed” audit-row assertion remains in place. |
| `src/ui/native/pages/MoveIn.jsx` | Retained main’s export-copy and legacy package affordances and applied the candidate’s named conflict alert. The added and removed lines match, with main’s export copy visible in the hunk context. |
| `importers.json` | Both branches changed the guide receipt. Recomputed the merged guide’s 138,734-byte length and SHA-256 `9ff9cc17af910358e94630572f4a7d0bb3d18da7b63241b3334d0343255546f9`. |
| `sources.lock.json` | Regenerated after staging the other 14 files so main’s source inventory and the candidate paths are all covered. |

### Contract and scope

Before and after, there are 91 clauses, with 4 done, 71 partial and 16 missing. There are no clause status, gap or evidence edits and no points added. The recorded main statuses are IDENTITY-001 partial and MOVE-IN-001 done. The two CLAIM lines below describe only the evidence of this replay.

The patch carries the prior test additions, preserves main’s test assertions and contains no dependency pin, migration, release, Base refresh or generated-view edits. Product publication used only the named cloud branch. The task uses the fleet’s independent landing checks and requires no pull request.

## Validation on the published SHA

Contract regeneration/check, typecheck, first-party rer check, build and source-lock validation before and after the build passed. All three importer catalogue assertions passed. The additional aggregate `pnpm run verify:build` reached its final offline Base-copy assertion and returned exit 1 for the pre-existing Base adaptation record for `.github/workflows/verify.yml`. The affected file, its copy record and the authoring scripts are byte-identical between the main parent and this replay. This check is recorded separately from the requested source-lock check and exact-head Verify.

- **Move-in CLAIM journey passed, 1/1.** It exercised Zendesk, retained legacy package behavior and the carried strict undo cases. A later edit held 2 records and named one changed contact. The larger case held 44 records, detected 22 conflicts and named 20 with 2 counted separately. A native staff match by itself permitted undo. The run recorded 77 Move-in browser accessibility observations and no browser errors.
- **Identity CLAIM journey failed, 0/1.** It passed through the prior teammate and ticket-scope stages, then timed out in `tests/helpers/identity/invitation-browser.mjs` line 8. The helper clicks the exact link “Agents.” Current main labels the same `agents` route “Team” in `src/ui/native/settings-destinations.js`. This is a deterministic locator conflict with the new Settings navigation. The minimal test reconciliation is changing that locator to the exact link “Team” while keeping the same click and invitation assertions.

Both named journeys ran once after the product push. The published commit stays one-parent and linear. A corrected one-commit candidate requires a fresh branch or explicit permission to change the requested publication shape. The packet records the failed journey independently of the invitation-only proof.

The invitation-only proof passed against the same emitted Worker after adapting only the temporary proof driver to select Team. It exercised invitation creation, clipboard success, explicit reveal after clipboard denial, and pending-copy reissue with zero browser errors. The packet contains the four changed-screen images, one per screen at each width. The invitation images mask synthetic fixture addresses.

## GitHub Verify

Verify 44283277242 reported completed with conclusion failure on the exact replay head. [GitHub Actions](https://github.com/just-every/run-happytohelp/actions/runs/44283277242)

- Verify / identity-and-repair-browser (134730711093) reported failure.
- verify (134743947091) reported failure.

The failed-job archive diagnostics are in `ci-failures.txt`. The identity shard archive command exited successfully with empty stdout. The stale locator diagnosis comes from the local exact-head run.

CLAIM IDENTITY-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session
CLAIM MOVE-IN-001 PARTIAL points=none tests=tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
