# hh-ai-mode-followups-2 results

Repository: just-every/run-happytohelp. Branch: cloud/hh-ai-mode-followups-2.

The handover preserves all four K18 follow-ups from published ccb7197677aeeeb7fe37b9dbab06c936b56e8008. Fresh main is d1d77817b9562eb3f2e42e04ae0b9e518cd89c13; the branch merges it rather than rebasing published history. The merge has no conflicts. All eleven product and test files from the prior candidate remain byte-identical (continuity.json). Main's K15b initial-private-note behavior, K18 AI-mode behavior, later erasure code, tests, documentation and migration 311 remain intact. No new migration or unrelated feature was added.

The fixes retain settings fields through concurrent policy/general/widget saves using guarded transactional retries; restore the saved AI-mode select value after an actual refused save; disable proactive help in draft/off while preserving automatic offers; and emit one guarded terminal managed-mail rejection audit without credential, recipient or message content.

CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md are unchanged from main. No Status/Gap/Evidence edits or clause promotions. Before/after: all 91 clauses, 4 done, 71 partial, 16 missing. Core remains 4 done, 71 partial, 11 missing of 86; surface remains 0 done, 0 partial, 5 missing. Field register remains 21 not run, 0 passed, 0 failed. CLAIM points=none. DEFAULT: none needed. GAP: existing contract gaps retained; local synthetic/provider-boundary evidence does not qualify a live provider, hosted deployment or publication.

See PLAN.md for the full plan and final-receipt.json for terminal product/CI custody. Logs preserve actual touched-check results. No CI dispatch or rerun is authorized or performed. No PR is required by the repository instructions; landing and publication scans remain lane actions.

Validation: the selected AI answering journey (including replyModes, proactiveReplyModes and replyModeMailHolds) passed 1/1; the selected workflow browser journey (including replyModeBrowserJourney) passed 1/1. Browser proof shows the saved draft choice after a real 403 refusal at desktop and phone widths. Build, typecheck, source lock/check, first-party and contract-generator check passed. No contract prose regeneration was needed. Setup initially required explicit private answers and a contained answers path, and one retry refused a live test process; the final setup receipt records its completed outcome. Private answers and setup logs remain excluded.

Product head: `9b238cf006b53e22ca124e013a027dbb4b7a47e7`. Product push succeeded on the first attempt through the cloud guard. Exact-SHA Verify run: 42475134770 (https://github.com/just-every/run-happytohelp/actions/runs/42475134770); final status is recorded in final-receipt.json.

Runtime detail: touched journeys ran under the supplied cloud toolchain default Node 24.19.0; final typecheck and successful local setup used pinned Node 22.20.0 with pnpm 10.12.4. Headless Chromium used /usr/bin/chromium with --no-sandbox. The second typecheck confirmed the pinned Node configuration.

Final setup completed successfully with private answers. The checkout is clean; both candidate identity/message audits contained only fleet author/committer and no trailers. The merge adds no product change beyond the original candidate: 12 files, 215 insertions and 38 deletions relative to fresh main, including the regenerated source lock. There are zero new migrations, and main still ends at migration 311. No blocker is known locally; exact-SHA CI custody remains independently recorded.

Local evidence provenance: the merge was held with --no-commit while local checks ran. The browser helper's actual followup-promise-receipt.json therefore records HEAD ccb7197677aeeeb7fe37b9dbab06c936b56e8008 even though it exercised the merged working tree. That receipt is retained unchanged; it is not an exact-final-SHA CI receipt. The merge was then committed as 9b238cf006b53e22ca124e013a027dbb4b7a47e7 without further product edits. GitHub Verify independently runs the final pushed SHA.

Final CI result: Verify run 42475134770 completed/success on exact head 9b238cf006b53e22ca124e013a027dbb4b7a47e7. Five GitHub REST calls were used, with discovery and subsequent polls spaced at least 300 seconds apart. No dispatch, rerun, failed-job log download, PR, force push, default-branch push, deployment or landing was performed. Blockers: none. Independent publication scan and guarded landing remain fleet/lane actions.

READY branch=cloud/hh-ai-mode-followups-2 head=9b238cf006b53e22ca124e013a027dbb4b7a47e7
