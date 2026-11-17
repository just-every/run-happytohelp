# hh-stranger13-ui-1-c1 plan and results

Carry gated candidate 94cc8ccc2d39d369695411554a3ac86113efec28 as one linear commit on current main b2b9bc602a73feb542017bca8a46529f68b631c4.

Plan:
1. Configure fleet identity, refresh launcher credentials, install Git guards, clone declared repository and fetch main/candidate.
2. Calculate merge base of candidate and a64ebd6dc51bcc8c349a6a0ebcc71f26985501a2: 94f64dfc35d938bd92b59bac9e938c11be10c27d. Apply its 20-file net change excluding the lock and receipt. Stop on any unexpected conflict.
3. Preserve main's receipt header, Technical details and version prop. Reapply blocked provider paragraph/link/notice, blocked Not-run status and suppression of duplicate setup notice. Regenerate source lock last.
4. Compare all 18 other non-lock file patches to the original candidate against a64ebd6d. Run source check, typecheck, first-party rer check, build and only procedures, merge and binding browser journeys. Capture changed screens at 1440 and 390.
5. Create one fleet commit, audit all candidate identities/trailers, push named branch once with cloud push guard, then verify the exact SHA through bounded GitHub REST calls. Publish report and actual receipts separately to the evidence ref.

Scope: no Base refresh, pin changes, migrations, CONTRACT.md edits, generated views, proof directory or gate follow-up implementation. No PR requested or created; no landing or gate performed.

Patch proof:
20 files total = 1 regenerated lock + 1 explicitly resolved receipt + 18 unchanged candidate patches. The brief's “19 non-lock files other than ProcedureReceipt” is arithmetically 18 when excluding that receipt; all 19 non-lock files are accounted for. For 17 files raw git diff bytes match. ProcedureSettings.jsx's diff hunks/context also match exactly; only the index blob hashes differ because main independently changed its receipt version prop. The full old and carried patches are included. See patch-equality.json and receipt.patch.

- src/modules/access/route-permissions.ts: identical patch (excluding blob-index metadata)
- src/modules/api-integrations/binding-options.ts: identical patch (excluding blob-index metadata)
- src/modules/api-integrations/settings.ts: identical patch (excluding blob-index metadata)
- src/modules/tickets/merge-search.ts: identical patch (excluding blob-index metadata)
- src/modules/tickets/routes.ts: identical patch (excluding blob-index metadata)
- src/modules/training-runs/runner.ts: identical patch (excluding blob-index metadata)
- src/ui/dashboard/components/conversation-actions/MergeConversation.jsx: identical patch (excluding blob-index metadata)
- src/ui/native/Navigation.jsx: identical patch (excluding blob-index metadata)
- src/ui/native/pages/Connections.jsx: identical patch (excluding blob-index metadata)
- src/ui/native/pages/MoveInReview.jsx: identical patch (excluding blob-index metadata)
- src/ui/native/pages/ProcedureSettings.jsx: identical patch (excluding blob-index metadata)
- src/ui/native/pages/connections/Tokens.jsx: identical patch (excluding blob-index metadata)
- tests/helpers/ai/procedures-browser.mjs: identical patch (excluding blob-index metadata)
- tests/helpers/ai/procedures.mjs: identical patch (excluding blob-index metadata)
- tests/helpers/stranger13-browser.mjs: identical patch (excluding blob-index metadata)
- tests/journeys/inbox-browser.mjs: identical patch (excluding blob-index metadata)
- tests/journeys/move-in-browser.mjs: identical patch (excluding blob-index metadata)
- tests/journeys/workflows-browser.mjs: identical patch (excluding blob-index metadata)

Contract status changes: none. Counts before and after: Published 2 done / 24 partial / 0 missing / 26 total; target and push further 2 / 47 / 16 / 65; all 4 / 71 / 16 / 91. The task claim lines retain PARTIAL scope, without altering main's clause judgments (MOVE-IN-001 done; PROCEDURE-001 partial; API-002 missing; FIRST-RUN-001 partial; CONVERSATION-002 partial).

Known gate C follow-ups intentionally deferred: closed-ticket search results may be refused by merge; workspace creation remains discoverable to roles whose creation door refuses access.

Toolchain notes: rer setup initially required private WIDGET_ORIGIN and OWNER_PASSWORD answers; the answers path must be checkout-contained, so setup was retried using the documented ignored .seed/local-answers.json path with owner-only permissions. No private answers are included in evidence. Rer uses the project-pinned Node 22.20.0. Initial direct commands used available Node 24.19.0; final non-browser checks and separate blocked-receipt proof use Node 22.20.0.

Setup completed successfully with 200 local migrations and an owner account using private, ignored answers. The final lock regeneration includes all three added files after adding their intent-to-add index entries; the earlier lock did not include those untracked paths. No tracked source change was made to address this.

Browser receipt proof: missingProviderProcedureBrowser passed under pinned Node 22.20.0, with the unchanged candidate helper asserting no provider attempt, zero reservation/spend, four Not-run cases, setup notice and link. Screenshots at 1440 and 390 show the retained main receipt header and Technical details. Merge search journey passed with tenant isolation, requester/subject lookup, explicit survivor, preview and retained private history; both widths captured.

Product head: bb70a0424b6f1efef5b10cb14992f1b579f1fc50. Parent/main: b2b9bc602a73feb542017bca8a46529f68b631c4. git log origin/main..HEAD contains exactly one commit with exactly that one parent (linear-history.txt). 20 files, 275 additions, 54 deletions. All 18 committed non-receipt/non-lock patches match the parent candidate against a64ebd6d after excluding blob-index metadata. Product push succeeded on attempt 1, once, without force. Fleet author and committer verified; no trailers. Working tree clean.

Local final results: source check, typecheck, first-party rer check and build passed. Touched browser tests: 3 passed / 0 failed (merge search, procedures including blocked receipts, binding selectors); no full suite. Separate missing-provider receipt proof passed. Screenshots include merge preview, bindings and blocked receipt at 1440 and 390. Verify run 44054528057 was discovered queued for this exact head.

Task-scope claims (no CONTRACT status promotion):

CLAIM MOVE-IN-001 PARTIAL
CLAIM PROCEDURE-001 PARTIAL
CLAIM API-002 PARTIAL
CLAIM FIRST-RUN-001 PARTIAL
CLAIM CONVERSATION-002 PARTIAL

Exact-head job evidence: Verify run 44054528057 has 16 completed jobs; every required job succeeded and only slow/nightly-proof were intentionally skipped. Final verify job 133956935571 completed successfully at 2026-11-17T09:51:23Z. No failed jobs, log downloads or reruns were needed. See ci-jobs.json.

Final exact-head Verify receipt: completed/success, run 44054528057, head bb70a0424b6f1efef5b10cb14992f1b579f1fc50, https://github.com/just-every/run-happytohelp/actions/runs/44054528057. Eight GitHub calls used, no failed log calls or reruns. No blockers. Product READY custody is separate from independent gate/acceptance/landing; none of those were performed here.

Signed lane return: 2026-11-17T10:00:15Z Run Edit Run fleet — hh-stranger13-ui-1-c1: one linear commit on b2b9bc602a73feb542017bca8a46529f68b631c4; head=bb70a0424b6f1efef5b10cb14992f1b579f1fc50; Verify run=44054528057 completed/success; clause changes=none; counts unchanged 4 done/71 partial/16 missing; touched browser 3/3 passed; no PR, blockers or reruns.
