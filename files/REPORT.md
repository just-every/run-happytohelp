# hh-owner-design-widget-1-c1

Signed: Run Edit Run fleet, 2026-11-17 UTC.

Result: READY candidate cloud/hh-owner-design-widget-1-c1 at 6ad6464a3bb4c7e4a7858aba35b66274a862f5ce. Exact-SHA Verify 44113676650 completed successfully, observed 2026-11-17T16:00:00Z. Both original failures were class (b): missing widget mutation permission rules. The fix keeps every product decision and existing assertion, and adds real native-role checks. Two failing journeys now pass; the procedures reproduction and 36 browser screenshots pass. No blocker, clause status change, PR, deployment or landing. Full plan and receipts follow.

## Plan

1. Start at parent head 6b5d230a08c1b8c44d24617379490ec833d91518 on cloud/hh-owner-design-widget-1-c1; retain D1, D2, D3, D17, D19, D23 and D24.
2. Inspect completed parent Verify shards and their failed logs within the ten-call GitHub budget. Reproduce each failing journey sequentially in this dedicated cloud VM using the real emitted/runtime public doors.
3. Classify deliberate flow/wording fixture changes as (a), introduced product regressions as (b), and failures also reproduced on origin/main as (c). Preserve assertions and decisions; change only the affected parent scope.
4. Run touched journeys, procedures reproduction, typecheck and rer check. Keep browser assertions at 1440 and capture relevant screens at 1440 and 390. Regenerate sources.lock.json last and check it.
5. Inspect all candidate author/committer identities, messages and trailers. Push only the named cloud branch through the fleet guard. Keep published history intact. Wait for exact-SHA Verify through budgeted REST calls.
6. Record actual command/test receipts and publish this packet only to evidence/hh-owner-design-widget-1-c1. Report claims and lane relay lines separately from product custody.

## Initial observations

- Product repository origin/main at clone time: bb70a0424b6f1efef5b10cb14992f1b579f1fc50.
- Parent Verify 44102307499: identity-and-desk and connections-and-computers failed; support-workflow-browser passed; support-and-recovery still running at the first two reads.
- No contract status, gap or evidence changes are authorized.
- No Base refresh, migrations, version/pin changes, live installation or provider operations are authorized.
- Fleet launcher and credentials helper installed. Dependencies installed with the existing lockfile. Setup uses a generated private local password; no secret is selected for evidence.

## CI diagnostics

Parent Verify finished with exactly two failing test shards. All six other test shards, including support-workflow-browser and support-and-recovery, passed. Both failed jobs failed their Run shard checks step. Each prescribed `gh run view ... --job ... --log-failed` invocation exited 0 with zero stdout bytes and no transport error or HTTP status. These empty archives provide no assertion diagnosis; no blocked blob download was retried. Local real-runtime reproduction supplies diagnosis instead. Five GitHub command calls used so far.

## Reproduced failure: identity-and-desk — class (b)

The unchanged parent head fails `tests/journeys/identity.mjs#custom roles restrict native and delegated knowledge and ticket actions, and security retention and legal holds preserve accountable history`, at `tests/helpers/identity/roles-audit.mjs:21`: “every mutating door has a role rule”. Its actual unclassified routes are POST widget-owner-name, POST widget-addresses and DELETE widget-addresses under /api/management/projects/:projectId. These are all new parent widget routes. The existing assertion stays intact.

Cause: parent handlers were added without classifying their permissions in src/modules/access/route-permissions.ts. The role middleware refuses an unclassified write for collaborators, blocking their own-name confirmation, but allows an unclassified write for custom roles whose base is admin/operator, relying on the native handler. Address handlers check admin membership, so a custom admin without settings.manage lacks the intended narrowing on these new doors. This is an introduced permission regression, not a decided-wording fixture mismatch.

Correction: self authority for the signed-in member’s own name; settings.manage for adding/removing a widget address. Extend the existing roles journey with actual native calls proving personal confirmation works and restricted admins/collaborators cannot alter allowed addresses. Retain all prior assertions, including the exhaustive route classifier. No decisions change.

## Reproduced failure: connections-and-computers — class (b)

The parent head also fails `tests/journeys/connections.mjs#a connected product opens and appends one scoped support request, receives signed events and a safe team notification, then loses access on expiry, erasure and revocation without replaying uncertain delivery`. The failure is `tests/connections/api001-outcomes.mjs:10`, its exhaustive API role inventory, with exactly the same three unclassified widget mutation routes. The existing API inventory assertion remains unchanged. Local parent reproduction: 1 selected journey, 0 passed, 1 failed. Identity-and-desk parent reproduction: 19 journeys, 18 passed, 1 failed.

The code correction covers both failures. No decided wording/order/structure assertion needed a class (a) update; no reproduced failure has been assigned class (c). The procedures shard passed on the parent; it will be reproduced separately without a speculative change.

## Tests changed

Only the existing roles journey helper is extended: `tests/helpers/identity/roles-audit.mjs`, registered under the identity journey named above. It checks a collaborator can confirm their own real display name without renaming the owner; collaborators and a narrowed custom admin cannot add/remove allowed addresses; refusals preserve the saved address; ordinary owner/admin approval/removal still works. All old assertions stay. No new registrations, skips or deletions.

## Work custody

An intermediate product save was pushed immediately after the first real commit. See save-receipt.json and save-ref.txt. It carries [skip ci] and is not the final candidate. Before its push all four candidate commits (including parent commits) had fleet author and committer and no trailers. Main was freshly fetched and was already an ancestor; rebase before first publication was a no-op. No published commit is rewritten.

## Corrected journey results

Both original failing journeys pass together on the saved permission fix: 2 tests, 2 pass, 0 fail, 0 skipped, 108.638 seconds. The connections API inventory and identity exhaustive classifier remain intact. The strengthened native role assertions also pass: personal name confirmation; unchanged owner name; collaborator denial; custom-admin denial despite admin membership; saved allowance unchanged after refusal; owner add and ordinary admin removal.

Direct node:test journey registrations remain 121 before/after, with no generated loop registrations, additions, removals or skips. Existing verification assert scripts are additional and unchanged; this is not a claim to recount all historical/non-push scripts. Contract summary remains 4 done, 71 partial, 16 missing, total 91; no clause Status/Gap/Evidence or acceptance text is changed. See counts.json.

## Final product candidate

Branch: cloud/hh-owner-design-widget-1-c1

Head: 6ad6464a3bb4c7e4a7858aba35b66274a862f5ce

Fresh main merge check after the save: already up to date. Typecheck, rer check --profile first-party, fresh rer build, source:lock and source:check all exited 0. sources.lock.json was regenerated after all tracked source/test edits; its final commit contains exactly the two updated source hashes. Final head has no CI skip marker. Both product pushes used cloud-push.py; both succeeded on attempt 1, with no force or main push. All five candidate commits were checked for fleet author/committer and absent trailers. No product report/evidence files were committed.

Exact-SHA Verify: 44113676650, discovered in progress for this full SHA. Its final result is recorded below and in candidate-receipt.json. No PR is required by repository AGENTS.md; this is a branch candidate for the fleet lander. Publication scanning/landing remains with the Mac fleet as required by the cloud adaptation.

C1 changes only route classification, the existing role journey helper, and its source hashes. All parent product decisions D1/D2/D3/D17/D19/D23/D24 remain. No release metadata, migration, dependency pin, Base source, sign-in, password, time-zone or widget-confirmation code is changed.

## Browser proof and retained decisions

The existing ownerInstallationBrowser completed successfully against the fresh emitted build on final candidate 6ad6464a3bb4c7e4a7858aba35b66274a862f5ce. All behavioral assertions run at 1440; proof captures once at 1440 and 390. All 36 screenshots (18 states) were inspected in the five contact sheets; original full-resolution PNGs and hashes are retained. The fixture uses synthetic people/businesses and two real loopback websites, with actual native APIs, CORS, sessions, sockets and persisted messages.

D1: unsaved address disables snippet/copy; saved actual address is in developer handoff and copied working script. D2: denied customer sees the plain unavailable message, no premature Reconnect or owner instructions; owner cancellation leaves denial, explicit approval restores chat, removal closes it while retaining the other address. D3: actual name saved before installation; chat-bubble launcher; business support before a reply and actual replying name afterwards. D17: local customer request page has the chat route without technical mail prose, while request-form settings show the local-mail banner. D19: actual saved help-center alias resolves and copies. D23: email-first field gates the real durable message, with no close-details control while required. D24: website address is saved and shown on both widget tabs.

Screens cover article editor, Inbox approval, knowledge/help-center alias, customer request page, request-form settings, Setup rejected address, empty and pre-filled name prompts, allowed-address list, saved/unsaved code, first-open chat, launcher, replied chat, widget settings/texts, and unavailable chat with/without configured contact link. File names: screenshots/owner-widget/after-<state>-1440.png and -390.png, enumerated in browser-proof-receipt.json. C1 introduces no visible design change, so no invented before screenshots are supplied; the failed authority assertions are the before evidence.

No product-behavior sentence was added by C1. Reports describe code-path cause and actual observed native results; no live provider/mail/deployment outcome is claimed.

## Procedures triage

`tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release` passes on final candidate 6ad6464a3bb4c7e4a7858aba35b66274a862f5ce: 1 selected test, 1 pass, 0 fail, 0 skipped, 362.450 seconds including lifecycle setup. This is the named third registration from the brief, including its missing-provider continuation. Its comparison, unsaved-work, source-receipt and fresh-evaluation checks remain intact. The parent exact-head procedures shard also passed.

The sibling-round “expected 0 actual 1” failure is not reproduced here; no Settings/wording-caused regression is observed, and no procedures code or assertion is changed. A passing run alone does not prove flakiness, so this report does not invent a class (c) finding or claim it fails on main. No failed procedures job exists to rerun in the parent run. If the candidate shard fails, its completed failure will be triaged under the remaining call budget.

## Local completion and claims boundary

All requested local checks are complete: typecheck, first-party rer check, fresh build, two corrected authority journeys, installed owner/customer widget flow, procedures journey, source lock generation and source check. The full local Verify/suite was not run. The original failing identity shard was reproduced in full solely to locate its failed journey because the GitHub failed-log archives were empty. Product checkout remains clean. All local servers/browsers launched by the completed journeys were closed by their own finally blocks and the cloud subreaper returned.

No clause is promoted. ACCESS-001 native custom-role/collaborator checks are exercised by the unchanged registered roles journey, with new widget authority coverage. The external workforce-provider qualification in ACCESS-001 point 1 remains outside this task. UI-001, FIRST-RUN-001, WIDGET-001 and PUBLIC-005 retain their prior source judgments; browser proof records the parent decisions without converting local synthetic results into hosted/provider acceptance.

GAP ACCESS-001: Configured external workforce-provider qualification remains outside this local widget permission repair; no source judgment is changed.

CLAIM ACCESS-001 PARTIAL points=3,4,5 tests=tests/journeys/identity.mjs#custom roles restrict native and delegated knowledge and ticket actions, and security retention and legal holds preserve accountable history

## Terminal CI result

Verify run 44113676650 is completed/success on exact head 6ad6464a3bb4c7e4a7858aba35b66274a862f5ce: https://github.com/just-every/run-happytohelp/actions/runs/44113676650 . This is the actual REST result in candidate-status.json, not a different head or an in-flight claim. Parent run 44102307499 was failure, with the two test shards reproduced and repaired above. No workflow rerun, dispatch, main push, self-gate, submission or landing occurred. Seven GitHub command calls were used; the scheduled final read preserved the remaining budget. The wait survived an environment/session reset without another GitHub read or a product-history change; the prior watcher was confirmed absent before resuming the same deadline.

Before/after: two failing original journeys become two passing touched journeys; direct journey registrations 121 → 121; source clause summary 4 done / 71 partial / 16 missing → unchanged; no Status/Gap/Evidence edits. New source/test assertions preserve personal name authority and settings-role narrowing. Final candidate is a publication/landing input; the fleet runs its own publication and landing gates.

Reports and receipts are published separately through refs/heads/evidence/hh-owner-design-widget-1-c1, never placed on the product branch. Explicit regular-file selection excludes credentials, local setup answers, environment dumps, private held-out material and symlinks. Transport publication does not itself claim acceptance or landing.
