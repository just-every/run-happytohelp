# hh-preflight-1: read-only provider preflight

Run Edit Run fleet · 2026-11-17

## Candidate custody

- Repository: just-every/run-happytohelp
- Branch: cloud/hh-preflight-1
- Base: 20b254ff85a01e9874b61d301ec192eeae0d73b8 (fresh origin/main; refreshed before each product publication, unchanged).
- Final product head: 94f64dfc35d938bd92b59bac9e938c11be10c27d
- Initial preserved product head: b35c5fe5899ab1a750b722bb5888307df4cddc4e.
- Intermediate preserved lock-correction head: f2c32a7b475fbfc745b30cbac77ad86ccd5e39d4.
- Product commits: Add explicitly consented read-only provider preflight; Lock tracked provider preflight sources; Refuse provider credentials in preflight target identifiers
- All three product commits were pushed through the required cloud-push guard, each on its first attempt, without a force push. Fresh main was unchanged before the appended correction; no published history was rewritten. No main/default branch or PR was changed.
- All candidate author/committer identities are Run Edit Run fleet <fleet@runeditrun.com>. No co-author trailers or skip-CI markers.
- Initial Verify run: 44015870666, https://github.com/just-every/run-happytohelp/actions/runs/44015870666: completed/failure in the build source-lock check; no test shards ran.
- Intermediate Verify run: 44016693507, https://github.com/just-every/run-happytohelp/actions/runs/44016693507, on f2c32a7b475fbfc745b30cbac77ad86ccd5e39d4. Last observed in progress after 23 minutes, before the final push superseded that candidate. No terminal result is claimed for this run.
- Final Verify run: 44019973966, https://github.com/just-every/run-happytohelp/actions/runs/44019973966, completed/success on exact head 94f64dfc35d938bd92b59bac9e938c11be10c27d, observed 2026-11-17T05:26:24Z.
- The fleet Mac retains the independent publication scan and landing gates. This cloud run does not self-gate, submit or land.

## Plan and rer investigation

The complete initial plan is in PLAN.md. Executed plan: inspect the contract and guides plus installed rer; confirm documented provider endpoints; implement the missing separate command and network-edge tests; update the runnable documentation; run touched checks; regenerate the lock last; publish one product candidate; wait for its exact-head Verify; return this report and actual receipts through the separate evidence ref.

Installed @runeditrun/rer remained 0.2.121. `pnpm exec rer deploy --help` exposes dry-run, actual deployment and secret-change doors, without a separately started read-only provider preflight. Its CLI parser is `node_modules/@runeditrun/rer/cli/contract.mjs`. Its `modules/deploy-kit/README.md` at line 175 explicitly states that it has no read-only preflight for proving edit permission. Internal deploy-kit helpers do read the subdomain/settings/secrets as parts of deployment and reconciliation, but these are not the independently consented three-GET CLI required here. No newer package, pin, Base refresh, release metadata or dry-run behavior was adopted. The help output actually inspected is attached as rer-deploy-help.txt.

## Design and requests

Public door: `pnpm run preflight:provider --account-id ACCOUNT_ID --worker WORKER --consent-read-only`.

The CLI is scripts/installer/provider-preflight.mjs; the allowlisted comparison report is scripts/installer/provider-preflight-summary.mjs. The account and Worker must be supplied explicitly. The flag authorizes reads of those targets; without it the command prints both targets and refuses before the network. A credential alone is not consent. The only token source is the CLOUDFLARE_API_TOKEN process variable; no credential file, env-file, saved rer state or account discovery is opened. deploy.json is read only as the edition declaration. The token is used only in the Authorization header, never in a URL, body, file or returned report. Target identifiers containing the token are refused before any request, including an accidentally pasted token in --worker. Raw provider errors, diagnostic messages, headers and redirect locations are never printed; output additionally redacts the exact token if a response name reflects it.

For an existing readable Worker the complete request sequence is exactly:

1. GET https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/subdomain
2. GET https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}/settings
3. GET https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/scripts/{script_name}/secrets

Every request has no body, manual redirects and a 15-second deadline. There is no retry, mail, Worker request, token verification, mutation or other provider request. A failure stops the sequence immediately, so refused reads can make fewer than three requests.

The report shows the subdomain, compatibility date/flag comparisons, declared resource binding names/types, public setting binding presence, required/optional secret NAME presence or absence, and other secret NAMES. It never shows values, annotations or resource contents. Missing optional names are informational. Required differences give exit 9, including a spent H2H_SETUP_TOKEN that deploy.json declares but the installation's owner claim has removed; this report explains that lifecycle distinction and never repairs it. Names do not prove value validity, resource health, schedules, queue consumers, edit permission or provisioning readiness. Every exit ends with `No mail was sent and nothing was changed.`

Distinct exits: 2 arguments/declaration; 3 consent; 4 token absent; 5 HTTP 401/403 with Workers Scripts: Read/account-scope guidance and no invented diagnosis of token validity; 6 HTTP 404 account-subdomain or Worker absence; 7 network/timeout; 8 HTTP/redirect/protocol failure; 9 declared differences; 0 successful complete inspection with no required difference.

## Cloudflare documentation actually read

Cloudflare's official API documents confirm the endpoint paths and permission set. The guide links these same references:

- [Get a Workers Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/): /accounts/{account_id}/workers/subdomain; accepts Workers Scripts Read.
- [Get Worker Script and Version Settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/): /accounts/{account_id}/workers/scripts/{script_name}/settings, including bindings. This is deliberately different from the /script-settings endpoint.
- [List secrets bound to a Worker script](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/): /accounts/{account_id}/workers/scripts/{script_name}/secrets; names only.

All three accept the one minimum account permission set documented here: Account / Workers Scripts / Read, restricted to the named account. No Edit, D1, R2, Queues, zone, user or membership scope is requested by this command. Direct documentation HTTP fetches from the VM returned 403, so the official pages were read through the available web tool instead; no provider account endpoint was called.

## Tests and local results

Four new node:test registrations execute the actual CLI in subprocesses, replacing only fetch at the network edge. Fixtures use a synthetic token and all-zero fake account. The fake records every request, with a boolean assertion of correct bearer authorization and token confinement, without saving the token itself. Tests verify no body, fixed API origin and paths, only GET, manual redirects, exact request count, no token or setting/secret values in stdout/stderr, no token in any created file, and no command-created files.

The exact tests in tests/journeys/provider-preflight.mjs are:

1. an explicitly consented provider preflight reads exactly three GETs and reports declared settings and secret names without values or writes
2. provider preflight refuses absent consent and absent credentials distinctly before any network request
3. provider authorization and missing Worker responses identify the failed read honestly without retry or error-body leakage
4. provider transport, redirect and unreadable responses fail closed without following, retrying or exposing diagnostics

These exercise successful and differing declarations, missing consent/token/targets, an accidentally supplied credential as the target, 401, 403 at settings and secret reads, account/Worker 404, network failure, redirect, malformed JSON, unsuccessful API envelope and malformed result shape. New tests are included in the existing connections-and-computers Verify shard and test:routes, with a standalone test:provider-preflight command. No full local suite was run.

Passed local checks:

- pnpm run test:provider-preflight: 4/4, no skipped tests.
- pnpm run typecheck: exit 0.
- npx -y @runeditrun/rer setup --owner-email fleet@runeditrun.com --non-interactive, with disposable contained private answers: exit 0. The temporary answer file was removed. Earlier setup attempts correctly refused missing required local setup fields and an answers path outside the checkout; neither involved a provider account.
- npx -y @runeditrun/rer build: exit 0.
- Documentation source reader: 39 pages, four sections, no missing sources or broken links/anchors.
- Existing installer/public documentation browser journey selected by name: 1/1, exit 0; actual emitted Worker and Chromium /usr/bin/chromium with --no-sandbox. It checks every current documentation body at 1440, plus its retained phone/responsive checks and screenshots. The existing journey prints pre-existing public motion/font and operations prose/size findings without failing; no UI CSS or product behavior was changed for those findings.
- node scripts/edition-authoring/cli.mjs lock, run last after tracked edits; its check and pnpm exec rer check --profile first-party: exit 0.
- git diff --check: exit 0; worktree clean after commit.

The initial synthetic fixture reused its fake token as its Worker name. Its confinement assertion exposed the target-as-credential case. The final CLI explicitly refuses a target containing the credential, and the refusal test now asserts exit 2 and zero requests for that input. Ordinary successful fixtures use distinct synthetic identifiers and tokens. All four tests pass on the final CLI sources. An optional extra installer screenshot attempt after the existing browser journey ended found its already-cleaned temporary runtime (ENOENT); no additional screenshot from that attempt is claimed. The existing journey's browser proof passed. Its complete operations-page proof is selected as browser/operations-1440.png and browser/operations-390.png; both show this candidate’s current rendered documentation.

See checks-receipt.json and the actual preflight-tests.log, installer-docs-journey.log, source-lock.log, rer-check.log and docs-reader.log. Scope and count receipts are separate files; no local private settings, owner entry links, credentials, environment dumps or customer data are selected for evidence.

## Initial CI failure and correction

Run 44015870666 failed only in the build’s `node scripts/edition-authoring/cli.mjs check`; the final verify job failed consequentially and the shards were skipped. The actual failed job log was read once with `gh run view 44015870666 --repo just-every/run-happytohelp --job 133813663998 --log-failed`. The archive read succeeded. ci-build-failure.log retains its diagnostic, with the workflow environment context omitted.

The lock command enumerates Git-tracked files. I ran the first generation before staging the new files, so it omitted the two preflight scripts and the new test. The pre-commit local check passed against that untracked-file set, but a post-commit local check reproduced CI’s failure. After fetching main (unchanged), I regenerated the lock with all three files tracked, ran its check plus rer check, committed the 12-line lock correction and ran the source check again on the exact new committed head: all exit 0. The second push preserved the initial published commit. No application, tests, documentation, pins, clause judgments or generated contract views changed in the correction. The final lock diff only records those three file hashes.

The lock-only correction preserved the functional sources. A subsequent token-confinement review identified the accidental-credential-as-target case described above. The final commit adds that refusal and extends the existing refusal registration, without adding another test registration. It regenerates the source lock last and passes all four preflight tests, typecheck, rer check and the post-commit source check. Final logs are preflight-tests-final.log, typecheck-final.log, source-lock-complete.log, rer-check-complete.log and exact-head-source-check-final.log. The application and documentation bytes remain identical to the locally built/browser-tested sources, so that browser proof still covers the final documentation. Final CI must pass on the final SHA; no green result from an earlier SHA is substituted.

## Documentation changes

- docs/INSTALLER.md now gives the runnable command, target review/consent step, private Bash token entry, one minimum read permission, all three documented paths, summary interpretation, lifecycle caveat, stop-on-failure behavior, exits and the explicit UNMET-EXTERNAL boundary.
- README.md replaces the not-implemented claim with the command and installer link, separates inspection from offline dry-run and real deployment, and makes no live readiness claim.
- OPERATIONS.md adds the independent read-only inspection, scope/consent/token requirements and result limits, and removes both stale implementation-gap sentences.
- AGENTS.md corrects the matching stale implementation sentence while retaining the dry-run boundary.
- Newly written preflight guidance is signed Run Edit Run fleet, 17 November 2026. Unrelated legacy prose is retained.

## Counts, clause claim and external boundary

- Implemented separate provider-preflight commands: 0 -> 1.
- Added preflight test registrations: 0 -> 4; direct node:test registrations under tests: 118 -> 122 (AST count; no new registration loops). test-counts.json records the counting method.
- Contract status rows: done 4 -> 4; partial 71 -> 71; missing 16 -> 16. NATIVE-001 remains partial; no Status, Gap or Evidence cell or acceptance point changed. CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md are untouched.
- Live Cloudflare qualifications: 0 -> 0. No real token or account, provider installation, DNS, mail, AWS, company data or app.happytohelp.com was used.

DEFAULT NATIVE-001: use the brief's explicit-consent-flag option, with account and Worker required on every invocation and the scoped token accepted only from CLOUDFLARE_API_TOKEN.
GAP NATIVE-001: UNMET-EXTERNAL. Live qualification requires the owner's scoped Cloudflare token and explicit consent in a separate run and has not been performed. Remote provisioning remains outside this round.

CLAIM NATIVE-001 PARTIAL points=3 tests=tests/journeys/provider-preflight.mjs#an explicitly consented provider preflight reads exactly three GETs and reports declared settings and secret names without values or writes; tests/journeys/provider-preflight.mjs#provider preflight refuses absent consent and absent credentials distinctly before any network request

## Final verification and handoff

Final exact-SHA Verify 44019973966 is completed/success on 94f64dfc35d938bd92b59bac9e938c11be10c27d. The ten budgeted CI/diagnostic GitHub calls and their actual times are in ci-calls.json; ci-status-10.json is the final REST receipt. No run was dispatched or rerun. The only failed run inspected was the initial source-lock failure, corrected by an appended commit; no history was rewritten.

All required local touched checks pass. There is no remaining candidate blocker. Live Cloudflare qualification remains UNMET-EXTERNAL as required by the brief, and NATIVE-001 remains PARTIAL. The independent gate, full publication scan and landing remain the fleet Mac’s responsibility; this builder has not submitted or landed the candidate. Evidence publication is report custody, separate from product acceptance.

POST lanes/hh/INBOX.md: 2026-11-17T05:26:24Z Run Edit Run fleet: hh-preflight-1 implements the separately consented three-GET provider preflight; NATIVE-001 stays PARTIAL, claim point 3; no clause Status/Gap/Evidence changes; preflight tests 0->4 pass; head=94f64dfc35d938bd92b59bac9e938c11be10c27d; Verify 44019973966 completed/success on that SHA; initial 44015870666 lock failure fixed, intermediate 44016693507 superseded; live qualification UNMET-EXTERNAL.
