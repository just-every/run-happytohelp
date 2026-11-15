# hh-docs-truth-1 documentation truth report

Repository: just-every/run-happytohelp
Branch: cloud/hh-docs-truth-1
Product head: 1e2aaf87653740749ac15cd7882018f1e7af4b52
Fresh base: 6c9727736090d31ca7eb0cff86aa3462e9cd235b
Product custody: pushed successfully on first attempt through the prescribed cloud guard.
Verify run: 43693967238 — completed/success on exact head 1e2aaf87653740749ac15cd7882018f1e7af4b52.
PR: none created. This assignment returns the named branch to the fleet lander.

## Plan and scope

The full plan is in PLAN.md. It was executed as follows: establish the named branch from fresh main containing the required predecessor; inspect the four claims against the installer, /run source, local adapter, deployment adapter and frozen rer dependency; correct equivalent current documentation; run only documentation/provenance checks and rer check plus the explicitly requested real deployment dry-run proof; refresh main before the candidate, regenerate the source lock last, inspect identities/trailers, push one candidate, observe its exact-SHA Verify, and return selected evidence separately.

Fresh-main fetch before the candidate returned a 0/0 divergence: the branch already matched origin/main, so no replay or merge was needed. One final candidate commit was pushed without rewriting any published history.

Five product files changed: README.md, OPERATIONS.md, docs/INSTALLER.md, docs/INDEPENDENT-RELEASE.md and the regenerated sources.lock.json. The lock diff changes only the four edited documents' SHA-256 values. Total diff: 135 insertions, 64 deletions. No code, tests, scripts, versions, dependency pins, scanner settings, migration, RELEASE.json, size-check.json, contract source or generated contract views changed. No permanent tests were added. No cloud publication scanner was run. The actual complete before/after patch is product.diff.

## 1. Primary local command

Before (README.md:84 and equivalent current Operations/Independent Release entries):

> Start it with one line. You need **Node.js 22 or later** (with npm) and Git; check with `node --version`.
>
> `npx -y @runeditrun/rer dev just-every/run-happytohelp`
>
> Without Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp` brings its own.

After (README.md:84, OPERATIONS.md:5, docs/INDEPENDENT-RELEASE.md:279):

> Start the free local app with this single copy-and-run command. You do not need Node.js or npm installed first; the installer brings its own. Git is required.
>
> `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp`
>
> If you already have **Node.js 22 or later** (with npm) and Git, the alternative is:
>
> `npx -y @runeditrun/rer dev just-every/run-happytohelp`

Proof: docs/INSTALLER.md:3–8 already gives that exact combined command. src/site/base/run-site.ts:75 builds the same command for /run, and :77 labels npx “Have Node 22 or later?”. src/site/run.json supplies the repository identity. The installed pinned rer's install.sh:18 and :54–56 bootstrap its own Node when Node >=22 is absent; its header documents the combined invocation. scripts/installer/local.mjs:42–56 declares the pinned local runtime and native setup/dev hooks. All public commands remain byte-for-byte those in the installer guide, including the setup-only and later-restart commands. Current Node-first entry sections: 3 before, 0 after. The original stranger's approximately 84-second clean bootstrap was not re-timed; this round verified the source behavior.

## 2. Chromium download boundary

Before (README.md:97):

> The install also downloads Chromium (about 280 MB, into your user cache) the first time: `rer verify` and the browser checks run in it.

After (README.md:104 and :110):

> Normal setup and launch install the app's dependencies and build its local assets; they do not download Chromium.
>
> **Browser verification:** `rer verify` downloads the Chromium and headless shell pinned by the checkout's Playwright into your user cache when first needed.

Proof: docs/INSTALLER.md:14–15 already states the normal setup/launch boundary, and :184 onward separately documents verification and `pnpm exec playwright install chromium`. The frozen rer 0.2.117 cli/lifecycle.mjs:107 defers the test-browser download; :113–118 calls ensureChromium only for verify. scripts/installer/local.mjs:35–39 builds development assets and launches the native development target. Browser tests remain explicitly separate. The same incorrect “setup-build ... dependencies and Chromium” claim in docs/INDEPENDENT-RELEASE.md was corrected: scripts/independent/setup-build.mjs installs only the pinned pnpm and frozen dependencies. No Chromium size estimate remains in the current README.

## 3. Current rer pin

Before (OPERATIONS.md:23 and :263):

> The checkout pins **`@runeditrun/rer` 0.2.77** in `package.json` and `pnpm-lock.yaml`.
>
> ... rer 0.2.77's rule that a new Worker needs every declared non-optional secret ...

A third current stale occurrence was in docs/INDEPENDENT-RELEASE.md:316, “Today's pinned rer 0.2.77”.

After (OPERATIONS.md:30–33):

> The checkout pins **`@runeditrun/rer`** to the version in [`package.json`](package.json), resolved in `pnpm-lock.yaml`.

The later Operations occurrence now refers to “the pinned rer's rule” and explicitly limits the required-secret condition to a live deployment. Independent Release points to package.json as well.

Proof: package.json:135 pins @runeditrun/rer **0.2.117**. pnpm-lock.yaml:180–182 resolves the same exact version; its package records match. Searched the whole tracked Markdown documentation set for 0.2.77 before editing. Current stale references: 3 before, 0 after. Historical CHANGELOG entries for v0.4.12/v0.4.13 and import-kit API history remain intact because they describe prior versions, not the current pin. Existing truthful release-specific 0.2.117 statements remain intact. No version or pin changed.

## 4. Credential-free dry run versus live deployment

Before (OPERATIONS.md:217–226):

> Before a deployment dry run or real deployment, supply the mail provider ... verified sender address and sending token ...
>
> Supply a real mailbox privately in `OWNER_EMAIL` ... for both dry run and deployment.

Independent Release also incorrectly described today's dry-run as requiring Cloudflare credentials and making three provider GETs.

After (OPERATIONS.md:173–193):

> From the installed checkout, stop dev first (`rer dev --stop`), then run:
>
> `rer deploy --dry-run`
>
> This validates the declaration and builds locally. It needs no Cloudflare account or token, mail provider, verified sender, sending token or real `OWNER_EMAIL`.

The exact completion text is included in Operations:

> deploy: local dry run complete; no credentials were needed, no Cloudflare requests were made and nothing was changed remotely. Target secrets and remote readiness were not checked.

“What you need first” is now explicitly a live-deployment section. Live sending inputs are linked to the existing email state table; the existing explicit Off path remains available. docs/INSTALLER.md:214 onward and docs/INDEPENDENT-RELEASE.md:323 onward give the same credential-free path. The latter's false credentialed-GET description is replaced with the separate, still-unimplemented owner-consented preflight boundary.

Proof: the frozen rer's cli/deploy-command.mjs:99–107 catches production-only missing-input refusals during dry-run, defers them as real-deploy guidance and runs ownerDeploy under withLocalDeployPlan. Its :93 prints the exact completion sentence. scripts/installer/hosted-deploy.mjs:40 skips live-only native mail validation on dry-run; its owner-email refusal is deferred by that CLI wrapper. scripts/installer/offline-deploy.mjs explicitly returns dryRun=true, deployed=false and providerChecked=false after local validation/build. These layers were read together; the adapter's owner refusal alone does not describe the user command.

Actual command proof: ran `pnpm exec rer deploy --dry-run` in the checkout with an allowlisted environment containing only HOME, PATH, local proxy-control flags, metrics-off and the proof's NODE_OPTIONS guard. No Cloudflare credentials, mail values, OWNER_EMAIL, local setup or private answers were supplied. The guard replaced globalThis.fetch, counted requests, and refused every attempt; it applied to the command and inherited Node children. Result: **exit 0**, the exact completion sentence above, **0 fetch attempts**, and missing production inputs listed as needed for a real deploy. dry-run.log is the complete actual command output; provider-fetch-guard.mjs and the empty provider-fetch-requests.txt preserve the guard and count. The build changed no tracked source.

One bootstrap attempt first ran under the VM's Node 24 and failed before the dry-run when the network guard denied rer's acquisition of exact Node 22.20.0. Installed that exact public npm Node package as toolchain preparation, selected it on PATH and repeated the command successfully. The failed bootstrap output is retained separately; it is not a deployment failure or a successful command receipt.

The d44ec03a mail-off section and hosted owner sign-in instructions remain unchanged. The copy check compares the entire Operations mail-off section byte-for-byte with origin/main. CONTRACT.md and all clause statuses remain untouched; no acceptance, gate, live-provider qualification or DONE claim follows from this docs round.

## Checks and actual receipts

- `node src/site/base/contract-docs.mjs check`: exit 0; contract prose 0 errors, 0 warnings; generated documents current (contract-check.log).
- Repository `verifyDocs` from tests/helpers/public-docs-journey.mjs: exit 0; **39 pages**, **4 sections**, **0 problems**. It verifies manifest coverage, all Markdown links and anchors using the actual docs builder (docs-links.json).
- Focused external copy check: pass for all four documents, combined-command precedence, exact current pin/lock match, Chromium boundary, credential-free guidance and unchanged mail-off section (copy-check.json, copy-check.py). This is packet evidence, not a permanent product test.
- `node scripts/edition-authoring/cli.mjs verify-base --offline`: exit 0; recorded Base copies and acknowledged adaptations match their provenance (copy-origin-check.log).
- `node scripts/edition-authoring/cli.mjs lock`: exit 0; run after all tracked edits and fresh-main fetch (source-lock.log).
- `node scripts/edition-authoring/cli.mjs check`: exit 0 (source-check.log).
- `pnpm exec rer check --profile first-party`: exit 0 (rer-check.log).
- Actual credential-free `pnpm exec rer deploy --dry-run`: exit 0, no fetch attempts (dry-run.log).
- `git diff --check`: exit 0.
- Every candidate identity/trailer inspected with the required origin/main..HEAD log: one commit, fleet author and committer, no trailers (identity.txt).
- Product push: first attempt succeeded, guard exit 0 (product-push.log).

No full local test suite, browser suite, production command, mail send, DNS change, account action or app.happytohelp.com operation was run. The requested dry-run builds the real application locally; it does not qualify remote readiness. Node 22.20.0, pnpm 10.12.4 and rer 0.2.117 were used for final checks.

## Counts, clauses and remaining boundaries

Four contradiction groups: **4 before → 0 after**. Three stale current-pin mentions: **3 → 0**. Three Node-first entry sections: **3 → 0**. Documentation builder: 39 pages / 4 sections / 0 problems after the edit. Contract counts unchanged: **4 done, 71 partial, 16 missing, 91 total**. Published counts unchanged: 2/24/0/26; target and push-further unchanged: 2/47/16/65. **No clause status changes**, including NATIVE-001, FIRST-RUN-001, LOCAL-MAIL-001 and PUBLIC-005. No copy-only result is promoted to acceptance or live qualification.

## Publication and CI

Product head and terminal CI result are recorded in checks-receipt.json and ci-result.json. The complete selected packet is published only to evidence/hh-docs-truth-1 with the separate report-only entrypoint. Product and evidence custody remain independent. The fleet lander must perform its own publication scan and landing checks; this cloud task does not land or publish a release.

Final CI: **completed / success**, exact head **1e2aaf87653740749ac15cd7882018f1e7af4b52**.
Run: https://github.com/just-every/run-happytohelp/actions/runs/43693967238
Observed: 2026-11-15T08:50:09.440534+00:00. Seven repository REST calls total: one exact-head discovery and six polls, each at least 300 seconds apart. The bounded watcher exited successfully and is no longer running. Actual discovery/poll/result files and github-calls.jsonl are included in the packet.

Blockers: **none**. No PR was created, no default branch was pushed, and no deployment or landing was performed. All locally required checks passed; the exact-head Verify is green. The fleet's publication scan and landing remain its own work.

Signed return line (from date -u):

POST lanes/hh/INBOX.md: 2026-11-15T08:51:11Z signed Run Edit Run fleet — hh-docs-truth-1; four documentation contradictions 4→0; current stale rer-pin references 3→0; clause status changes none (4 done/71 partial/16 missing, 91 total unchanged); branch cloud/hh-docs-truth-1; SHA 1e2aaf87653740749ac15cd7882018f1e7af4b52; Verify 43693967238 completed/success on exact SHA; local contract, docs links (39 pages), copy/provenance, source-lock, rer check and credential-free dry-run passed; copy-only, no acceptance or DONE claim.

READY branch=cloud/hh-docs-truth-1 head=1e2aaf87653740749ac15cd7882018f1e7af4b52
