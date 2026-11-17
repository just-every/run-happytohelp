# HappyToHelp hh-preflight-2
Run Edit Run fleet · 2026-11-17

Repository: just-every/run-happytohelp
Branch: cloud/hh-preflight-2
Base: 94f64dfc35d938bd92b59bac9e938c11be10c27d (fresh origin/main confirmed before commit)
Product head: a64ebd6dc51bcc8c349a6a0ebcc71f26985501a2
PR: none; this builder returns a branch candidate to the fleet.

## Plan and execution

Followed PLAN.md: inspect the existing command and public-door tests; make the six follow-ups as one small candidate; preserve the read-only provider boundary; run touched checks and the existing installer docs journey; regenerate sources.lock.json last; inspect all candidate identities/trailers and publish only cloud/hh-preflight-2 through the push guard; obtain exact-head Verify; return the report packet separately on evidence/hh-preflight-2. No self-gate, landing, submission, Base refresh or paid API was used.

## Before and after

| Item | Before (independent-gate finding) | After on the product head |
| --- | --- | --- |
| 1. Claimed lifecycle | A healthy claimed Worker without its retired setup token ended exit 9 | The summary derives owner-claim tokenField names from rer-setup.json. Absent claim tokens say “absent, spent after owner claim” and are lifecycle-optional; the claimed and token-present cases both finish exit 0. Each other required secret was individually omitted in fixtures and still exits 9. Absence alone does not prove claim occurred. |
| 2. Whitespace credential | A whitespace-only token caused redaction of spaces in the refusal | Redaction runs only when token.trim() is non-empty. Both single-space and three-space input exit 4 with readable refusal text and zero requests. A before/after probe also confirms the single-space regression fails on the starting main and passes on the candidate. |
| 3. Identifier refusal | Malformed identifiers and credential-bearing identifiers both exited 2 | Malformed account/Worker names remain exit 2. A token equal to or embedded in either target is refused with exit 10 before requests, retaining the refusal message. |
| 4. Published stale prose | Updates/recovery said implementation and qualification remained pending | Both stale passages in INDEPENDENT-RELEASE.md now point to INSTALLER.md#read-only-provider-preflight and explicitly retain live qualification as UNMET-EXTERNAL. A README/docs search also found and corrected the same stale implementation claim in docs/verify.md. A final search of all docs Markdown files and root README files found zero remaining stale implementation statements (stale-docs-search.json). Unrelated historical prose and contract judgments were retained. |
| 5. pnpm invocation | The guide suggested plain pnpm, which echoes argv and lifecycle errors | The guide and command usage suggest pnpm -s run preflight:provider. The guide explains the plain-pnpm echo hazard. A synthetic plain-pnpm probe confirmed exit 10 and clean command stderr, while pnpm’s own argv echo still occurs. |
| 6. Allowed response shapes | secret_key rows and omitted settings.bindings triggered exit 8 | Named rows are summarized regardless of secret type; unnamed rows contribute no name. Omitted bindings means no bindings, so declared bindings are reported missing (exit 9), rather than a response-shape failure. Combined fixtures include secret_key required/extra names, no bindings, and hidden values that must never print. |

The command retains exactly three ordered GETs on a healthy readable Worker, explicit target consent, the scoped token only from the environment and only in Authorization, no retry/redirect, no mail, no mutation and no files written. Earlier refusal/failure paths stop before or during the reads. The existing header, URL, no-body, no-value, no-token-file and no-leak assertions remain active.

## Exit-code table

| Exit | Meaning |
| --- | --- |
| 0 | Help, or three completed reads with no required difference |
| 2 | Invalid arguments or unreadable declaration/setup manifest |
| 3 | Missing explicit read-only consent |
| 4 | Missing or whitespace-only environment token |
| 5 | HTTP 401/403 authorization refusal; token validity and account/permission scope are not distinguished |
| 6 | HTTP 404: account Workers subdomain or Worker missing |
| 7 | Network failure or timeout |
| 8 | Other HTTP/protocol/shape or unexpected failure |
| 9 | Missing/mismatched required declared settings or secret names |
| 10 | Target identifier contains the environment token |

## Local validation and custody

- pnpm run typecheck: exit 0.
- pnpm exec rer check --profile first-party: exit 0.
- node --test tests/journeys/provider-preflight.mjs: 4 passed, 0 failed; existing registrations extended, before 4 / after 4.
- Installer docs journey: node --test --test-name-pattern='a new owner finds the source and installation guide' tests/journeys/public-browser.mjs: 1 passed, 0 failed. It checks published doc bodies, headings, links and navigation through the emitted app. Chromium used /usr/bin/chromium with --no-sandbox and the real HOME; the journey produced its existing 1440/390 proof. No UI layout was changed.
- cloud_run npx -y @runeditrun/rer build: exit 0, used to run the emitted application for the docs journey.
- Local-only setup completed with synthetic loopback answers. Initial attempts refused missing answers (exit 3) and an answers path outside the checkout (exit 4); using an ignored checkout-local private answer file succeeded. No real provider account/token or mail was used, and no private answers are in this packet.
- node scripts/edition-authoring/cli.mjs lock, then check: exit 0; check reports ok=true. sources.lock.json was the final tracked edit; selected Base sources are unchanged.
- git diff --check: exit 0. Product worktree clean after both commits. The second commit strengthens the whitespace regression; it changes only the preflight test and regenerated source lock. Runtime/typecheck/docs inputs are identical to the first tested head; preflight tests and source checks were rerun on the final tree. Fleet author and committer checked across all candidate commits; no trailers. Product push guard succeeded on attempt 1 for each of the two commits; published history was not rewritten.
- The cloud cannot run the fleet’s publication scan. The existing Mac landing gate must run it before landing; no scan completion is claimed here.

## Counts, claim and remaining qualification

Preflight registrations: 4 -> 4. Installer docs registrations run: 1 -> 1. CONTRACT.md Status/Gap/Evidence changes: none; NATIVE-001 remains PARTIAL. No acceptance point was added, and no existing assertion was removed, skipped or weakened. Dry-run, release/version/tag metadata, migrations and pins were unchanged. No proof/ directory was created.

CLAIM NATIVE-001 PARTIAL points=3 tests=tests/journeys/provider-preflight.mjs#an explicitly consented provider preflight reads exactly three GETs and reports declared settings and secret names without values or writes; tests/journeys/provider-preflight.mjs#provider preflight refuses absent consent and absent credentials distinctly before any network request; tests/journeys/provider-preflight.mjs#provider authorization and missing Worker responses identify the failed read honestly without retry or error-body leakage; tests/journeys/provider-preflight.mjs#provider transport, redirect and unreadable responses fail closed without following, retrying or exposing diagnostics
DEFAULT NATIVE-001: Missing owner-claim tokens are lifecycle-optional by setup-manifest field, without inferring that owner claim actually occurred.
GAP NATIVE-001: Live scoped-token Cloudflare qualification and remote provisioning remain UNMET-EXTERNAL; fake network-edge results do not establish live qualification.

## CI and evidence return

Prior head/run (superseded, not a final qualification): 05f18d8cacbf01b5a8995b70fc8fd7c9eaa2d3b6 / 44034575681. The first watcher was stopped before starting the final-head watcher.

Exact-head Verify run: 44035553847
Run URL: https://github.com/just-every/run-happytohelp/actions/runs/44035553847
Result: **completed / success**, exact head a64ebd6dc51bcc8c349a6a0ebcc71f26985501a2. Total GitHub API calls: 9 / 10. No failed-job rerun was needed. The final poll observed success about 30 minutes after discovery; this run exceeded the stated ten-minute CI target.

No product main/default-branch push, PR mutation, landing or external provider read was performed. Evidence publication is separate report-only custody and does not signal acceptance or landing. Full plan, actual command logs and CI receipt are selected explicitly for evidence/hh-preflight-2.

Blockers: none for this scoped candidate. Live qualification remains UNMET-EXTERNAL.
Final remote main: 94f64dfc35d938bd92b59bac9e938c11be10c27d. Main did not move during the round.

READY branch=cloud/hh-preflight-2 head=a64ebd6dc51bcc8c349a6a0ebcc71f26985501a2
