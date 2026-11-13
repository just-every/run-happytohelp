# README guide and deploy truth

Task: main-happytohelp-readme-truth-1
Repository: just-every/run-happytohelp
Branch: cloud/main-happytohelp-readme-truth-1
Baseline: acdcff44b1dae61a4c5559807c33430fd0891dbd (package version 0.4.24)

## Plan

1. Read launcher and seed instructions, preserve fleet identity and commit hooks.
2. Reproduce the README guide failure over public HTTP, identify an already served guide and the /run page.
3. Run the release-version checkout's dry run without Cloudflare credentials, inspect the printing code and real-deploy/preflight boundaries.
4. Edit only README guidance and the generated source lock. Add no tests, change no contract judgments or generated acceptance views.
5. Run the existing docs link checker, typecheck, first-party check and source check; inspect the changed rendered README at 1440 and 390.
6. Fetch current main before the first candidate commit; rebase if needed, regenerate source lock last, commit and push the named branch with fleet identity.
7. Observe exact-SHA Verify using REST within the ten-call and five-minute polling limits. Save actual receipts and publish the explicitly selected report packet to the evidence ref.

## Baseline findings

Public curl requests reproduce item 1: /docs/getting-started returns 404; /run, /docs/install and /docs/run-locally return 200. See public-links-before.json. Python urllib initially returned 403 for every route, so those transport results were replaced with the actual curl response receipts, not mistaken for site status.

The README points at the missing page. The current docs manifest already lists the getting-started source, but the public site does not serve that route yet. The existing Install guide is served and covers installation and local running. Use its repository-relative Markdown link so the existing docs builder validates the README destination and rewrites it to /docs/install. Also link /run explicitly.

Item 7 is present in README: it says credentials are required for dry-run, performs three provider GETs and refuses without credentials. AGENTS.md and scripts/installer/offline-deploy.mjs describe a local build and validation instead. hosted-deploy.mjs routes dryRun to offlineDeploy; real deployment follows ownerDeploy/nativeMailgunDeploy after real inputs are validated. A separate consented provider preflight remains unimplemented and unqualified.

## Scope and proof boundaries

No rer/deploy implementation changes, no site deployment, no other stranger findings. No contract Status, Gap or Evidence edits and no DONE claim. No tests added, deleted, skipped or weakened. Browser evidence covers the README as rendered at /docs, at 1440 and 390; no UI design changes.

Initial noninteractive setup refused missing local answers, then an answer file outside the checkout. Retried with generated private local answers inside ignored .seed; private setup logs and answers are excluded from the public packet.

## Results

The credential-free public command `pnpm exec rer deploy --dry-run` exited 0 in 31.35 seconds on baseline acdcff44b1dae61a4c5559807c33430fd0891dbd, the v0.4.24 source/version named in the stranger report. Provider credentials were excluded from the child environment. It built and validated locally, printed both the adapter's offline receipt and rer's completion message, and named missing Cloudflare and production-mail inputs as requirements for a real deploy. It reported target secrets and remote readiness unchecked. This was a local command probe, not a hosted deployment or independent live provider qualification. The emitting adapter and installed pinned rer code are captured in deploy-source-receipt.md.

README now links the existing installation source docs/INSTALLER.md, which the current site's docs builder rewrites to /docs/install. That public route returns 200. The README also links https://happytohelp.com/run, which returns 200. The missing /docs/getting-started public route is left alone; no site or routing change is needed for this fix.

The deploy section now puts the credential-free local dry run first. It separately describes real deployment's account credentials, production owner/mail inputs and private environment file. It says the independent consented read-only remote preflight remains unimplemented and unqualified. It no longer says the dry run performs three GETs or requires credentials. No rer implementation, contract source or generated acceptance view changed.

The existing verifyDocs helper passed with zero link/anchor problems, including the new repository-relative README guide link. It rendered all current listed documentation, and reported the README guide destination as /docs/install and the quick-start destination as https://happytohelp.com/run. The real rer site build passed (44 pages). Chromium loaded that emitted README, followed its guide link successfully and captured the two changed sections at 1440 and 390. Visual inspection found the changed text legible and wrapping within both widths. The 1440 check also asserted the page fits the viewport. Browsers and the proof server were closed.

`pnpm run typecheck`, `node scripts/edition-authoring/cli.mjs lock`, the corresponding `check`, and `pnpm exec rer check --profile first-party` passed. The supplied toolchain shell selected pnpm 10.12.4 and retained the VM's newer Node 24.19.0 for direct shell commands; rer itself selected project Node 22.20.0, as recorded in the command logs. No full local suite or rer verify was run; exact-SHA branch Verify is the full wall.

Fetched main and ran the required rebase before the first candidate commit. Main remained acdcff44b1dae61a4c5559807c33430fd0891dbd. Regenerated the source lock last; it changes only README's digest. Commit 468b2315286bc97f7781d5d0ea3e6da5d576633e contains README.md and sources.lock.json only, has fleet author/committer, no trailers and no skip marker. All candidate commits and messages were inspected before the guarded product push, which succeeded on attempt 1. The checkout is clean. No PR is required by the seed instructions; none was opened. The fleet lander retains main and publication-scan custody.

## Before and after

- Broken README guide destinations: 1 → 0 (replacement route confirmed working).
- README links to /run: 0 → 1.
- Incorrect README dry-run explanations: 1 → 0.
- Tests added/removed: 0/0; existing registration count unchanged, no budget increase.
- Contract summary judgments: 4 done / 71 partial → 4 done / 71 partial.
- NATIVE-001 and PUBLIC-005 remain partial. No Status, Gap or Evidence changes and no DONE claim. The command/link/documentation probes support this documentation correction; they do not newly prove all obligations of a numbered acceptance point, so no new clause-point promotion is requested.

GAP NATIVE-001: Separately started owner-consented provider preflight remains unimplemented; live remote provisioning remains unqualified, as before.

## CI and publication

Exact-SHA push Verify: run 43425743385, https://github.com/just-every/run-happytohelp/actions/runs/43425743385, head 468b2315286bc97f7781d5d0ea3e6da5d576633e. Discovery saw in_progress. One watcher polls with at least 301 seconds between calls. Its complete actual receipt is ci-receipt.json; final outcome will be appended before evidence publication.

The actual report, command/check receipts and browser images are kept in this packet outside the product clone. No setup answers, private setup logs, credentials, environment dumps or held-out gate material are selected. The separate evidence ref carries this packet only; it is not product READY or a landing signal.

## Final observed CI outcome and custody

The initial exact-SHA Verify completed **failure** after the seventh scheduled observation. Run 43425743385 remains tied to product head 468b2315286bc97f7781d5d0ea3e6da5d576633e. Build, identity-and-desk, assistant-and-knowledge, connections-and-computers and every browser shard succeeded. `Verify / import-and-reports` (job 131887254733) failed at `Run shard checks`. The final `verify` job (131899319475) consequently failed at `Require the plan and every selected check`; full-push-proof was skipped.

After completion, fetched job metadata once. Ran exactly once:

`gh run view 43425743385 --repo just-every/run-happytohelp --job 131887254733 --log-failed`

That command exited 0 and returned **zero bytes**. Its actual empty log file is retained; no failure assertion or transport error was supplied. Do not infer a failure cause from absent output. The job includes importer/report/public route checks; no implementation or test in that shard was edited by this round. The local docs checker and emitted-site browser proof passed, and the full CI build/public browser shard succeeded, but these facts do not make the whole Verify green.

Requested **one** failed-jobs rerun through `POST repos/just-every/run-happytohelp/actions/runs/43425743385/rerun-failed-jobs`. The request succeeded (see actual HTTP receipt in ci-receipt.json). All ten budgeted GitHub calls are now used: seven spaced workflow observations, one jobs read, one failed-log command and one rerun request. No further status read was made. The rerun outcome is **not observed**; no green exact-SHA Verify or acceptance is claimed. The final custody status is PUSHED, for the fleet to watch the rerun and repair or land under its independent gates.

There is no implementation/account/credential blocker for this README correction. The pending verification gate is the rerun of the named import-and-reports shard and dependent Verify job. No test or product change was made to mask the failure. Report-only evidence publication is separate from this product custody status.
