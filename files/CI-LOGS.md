# Exact-head failed job receipts

Product SHA `a5f0b8e3d2d540fa9565848a53397aef203a470a`, Verify run `44633893244`.

## Build job 135947556667

The log archive command `gh run view 44633893244 --repo just-every/run-happytohelp --job 135947556667 --log-failed` exited 0.

The failing step ran `node scripts/edition-authoring/cli.mjs check`. Its output was `Stale lock or source/tool integrity mismatch; run changes to inspect intentional edits before lock` followed by `Process completed with exit code 1.`

## Final Verify job 135947853822

The log archive command `gh run view 44633893244 --repo just-every/run-happytohelp --job 135947853822 --log-failed` exited 0.

The failed step was Require the plan and every selected check. Process completed with exit code 1.
