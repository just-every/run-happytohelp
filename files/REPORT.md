2026-11-17 — Run Edit Run fleet

# Procedures race candidate replay

Repository: just-every/run-happytohelp
Branch: cloud/hh-procedures-race-2-c1
Pushed head: 42e70dfea02469c967a4eb456fb51d40c288b8b5
Terminal custody: BLOCKED per the explicit environment-loss rule; product commit remains pushed.
Parent / newest main at final pre-push fetch: b6f16fc44feaad1164753d895419bb78e61e40e3
Prior candidate: 48c4f14b9d36f1013440519e8b9f94a28055f572
Prior base: 55e2f106c506e4f671d2e474c737124e760e2233

## Plan and scope

PLAN.md records the full plan. The prior candidate's three commits were rebased onto current main before this branch was published, then squashed to one linear commit. No conflicts occurred. The source lock was regenerated last by node scripts/edition-authoring/cli.mjs lock, never edited by hand. The final pre-push main fetch still returned b6f16fc44feaad1164753d895419bb78e61e40e3.

The product branch was pushed once, through cloud-push.py, with fleet author and committer and no trailers. Every commit in origin/main..HEAD was inspected. There is exactly one commit and exactly one parent, the fetched main. product-receipt.json and product-push.log record actual custody. No PR is required by this repository's AGENTS.md; none was created. No main push, force push, published-history rewrite, Base refresh, dependency pin change, migration, proof/ directory or contract edit.

## Patch equivalence and retained main

For every non-lock changed file, the pushed patch against b6f16fc44feaad1164753d895419bb78e61e40e3 equals the prior candidate patch against 55e2f106c506e4f671d2e474c737124e760e2233 byte for byte:

| File | Patch equality |
| --- | --- |
| src/ui/native/pages/ProcedureSettings.jsx | true |
| tests/helpers/ai/procedures-browser.mjs | true |

patch-equality.json records both patch hashes and their equality on the pushed head. sources.lock.json is the only exception: it was regenerated from the combined main plus candidate inventory, retaining main's newer owner-fix source hashes. The final branch changes precisely these three files. The full tree intentionally includes newer main's owner changes, so it differs from the old candidate's full tree; the requested candidate changes are preserved exactly.

## Cause and unchanged qualification boundary

The existing fix gives list reads a generation counter. Only the newest read may expose a draft, replace the saved-version list or set a read failure; a post-save read advances that same counter, and unmount invalidates older reads. The existing browser helper holds an older native GET across a refresh and a save, waits for its response completion and render, and proves that it neither exposes an unavailable draft nor erases refund Version 1. It retains the single-POST repeated-Enter assertion. Its existing read-only Playwright maxRetries:1 handles only ECONNRESET; writes and assertions are not retried.

This task adds no product behavior beyond the prior fix. The parent's accepted evidence reports both controlled schedules failing 1/1 on baseline and fourteen consecutive fixed-candidate passes before its environment loss. Those are inherited facts from the brief, not newly executed baseline measurements here. This run tests the rebased pushed head separately.

## Local verification

Actual touched-checks.json records exit 0 for source lock regeneration, source check, pnpm run typecheck, pnpm exec rer check --profile first-party and git diff --check. The emitted native build through cloud_run npx -y @runeditrun/rer build completed with exit 0. The repeat proof uses project Node 22.20.0 and system Chromium /usr/bin/chromium with --no-sandbox through the repository's existing browser helper.

The required initial rer setup was attempted with --owner-email fleet@runeditrun.com --non-interactive and exited 3 requesting private WIDGET_ORIGIN and OWNER_PASSWORD answers. No live installed owner was needed or configured: the build and browser proof use isolated native runtimes. This is the same setup limitation recorded by the parent, and does not block the source checks or emitted-runtime tests.

## Counts and clauses

workflows-browser.mjs registrations: 10 before / 10 after. Target registration: 1 before / 1 after. No assertion removal or test-registration addition. Before/after clause progress remains Core 4 done / 71 partial / 11 missing / 86 total; Agent surface 0 done / 0 partial / 5 missing / 5 total; Full target 4 done / 71 partial / 16 missing / 91 total. CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md are unchanged. No clause status, gap or evidence edits.

CLAIM PROCEDURE-001 PARTIAL points=1 tests=tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release

Historical replay, operational context, controlled production rollout, live-provider quality and version-linked production recovery remain unqualified. This synthetic-only browser proof does not promote the clause.

## Browser proof method

The proof imports the actual unchanged workflows-browser.mjs registration twenty times and selects its exact existing third test by name. Every pass includes its missingProviderProcedureBrowser subjourney. The harness applies CDP CPU rate 6, 250ms network latency, download 750000 bytes/sec and upload 250000 bytes/sec to this task's Chromium pages. It changes no product or test assertion and adds no timeout or fixed assertion sleep. Its only runtime optimization is copying an empty fully migrated state snapshot, captured before any fixture seeding, into a separate directory for each later runtime. Migration application still runs and each fixture gets isolated storage. Browsers and Workers close through the existing test finally blocks and cloud_run subreaper.

Raw browser traces and raw TAP are retained outside the public packet because they may contain transient synthetic session headers. Only sanitized actual logs and explicit non-secret receipts are published. The harness sources are included for review. Additional screen proof captures the changed procedure screen once at 1440 and 390; assertions remain at 1440.

## CI and final proof result

Actual repeat results: run 1 PASS, run 2 PASS, run 3 PASS, run 4 PASS, run 5 PASS, run 6 PASS. The seventh pass was interrupted, not passed or failed. There were six consecutive complete passes and zero reported assertion failures. The 20-run proof is incomplete and no clean process exit was observed. proof-20.tap is the sanitized actual TAP; proof-20-receipt.json and interruption-receipt.json retain the count and process states.

At approximately 22:38 UTC the managed environment reconnected (its status returned to starting, then ready), aborted the attached tool, and terminated the proof's Node/Chromium/Worker processes. The old proof processes were confirmed zombies under PID 1, rather than assumed alive from their retained PIDs. There was no proof-exit.txt. Per the brief's explicit environment-loss rule, the proof was not restarted and no further product commit or product push was made. The product branch remains pushed and verified at the original head, with a clean checkout. This is an execution-environment blocker, not a demonstrated procedure assertion failure.

The separate screen proof completed successfully before interruption and records the exact pushed head, 1440 and 390 captures and the 1440 assertion boundary in screen-proof.json. The full target remains partial.

Verify run 44189251083 is on exact head 42e70dfea02469c967a4eb456fb51d40c288b8b5. The final observed status at 22:49:59 UTC was in_progress, conclusion null; ci-final-receipt.json records the exact-SHA REST result and URL. Six GitHub REST calls were used, with status polls more than 300 seconds apart. No failed completed run or failed-job assertion was observed, so no failed-log read or rerun was issued. No CI success or READY is claimed. The task ends BLOCKED under the explicit environment-loss instruction, with six complete passes, rather than PUSHED with Verify in flight. The remaining CI budget was not spent after the environment-loss blocker made a READY return unavailable under this brief. Product and evidence refs are separate. The fleet performs its own publication scan and landing; this cloud task does neither.


## Terminal return

The branch is preserved on GitHub at 42e70dfea02469c967a4eb456fb51d40c288b8b5, one linear fleet-authored commit above b6f16fc44feaad1164753d895419bb78e61e40e3. The source checks passed and non-lock patches are identical to the parent candidate. There is no product push rejection or unpushed product work, and no rescue bundle is required. The branch was pushed once and never changed after that push. The exact-SHA workflow has not yet been observed complete. BLOCKED reason: environment reconnect terminated the proof at six completed passes, zero reported assertion failures; the brief explicitly requires BLOCKED after environment loss. No proof restart, additional product push, self-gate, landing or submit action.

The packet is published separately to refs/heads/evidence/hh-procedures-race-2-c1. Raw traces, local synthetic sessions, runtime databases, credentials and environment dumps are not selected. All packet files were explicitly selected and checked for injected credential values before publication. Evidence transport makes no acceptance or landing claim.
