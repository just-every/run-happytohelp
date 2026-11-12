# hh-importer-seam-fix-1 — candidate held for independent gate

Repository: just-every/run-happytohelp
Branch: cloud/hh-importer-seam-fix-1
Product head: 403c8317144571852bcbcaae34ba4e3ce8bcc06c
PR: none created; branch-only builder handover, independent gate required.

## Result and exact baseline

Verified gate-accepted R1 source head fd684b02ca59631a4799565bd4dbecbe4aeddff9 (cloud/hh-importer-r1-3). Main was 9a4f9408a2fd46159086df698dba9ebcf3f5d657 at clone, integration and final pre-commit fetch. The normal merge commit has R1 first and main second as its parents. The integrated baseline was that merge with the seven route permissions combined and main's source lock taken whole temporarily, before the seam repair; it was exercised in the merge worktree without creating or publishing an intentionally broken baseline commit.

The unchanged bounded legacy runner journey failed on the first operator start refusal: response.json() raised `SyntaxError: Unexpected token 'W', "Workspace "... is not valid JSON`. After the repair, the exact same journey passed, including operator 403 and anonymous 401, owner admission, 116 imported rows, 380 queue invocations, two recovered real Worker deaths, stop fencing, authority-revocation pause/admin takeover and zero-row replay. Both required objects (129 bytes total) were identical and verified. Installation work counts stayed equal and no provider request occurred. This is the demonstrated deterministic middleware/error-format integration failure, not a repair to timing or Zendesk pack realpath behavior.

## Product change

The only new seam implementation is src/modules/legacy-import/package-in/routes.ts:

- Bind the existing intake authorization/version/fingerprint middleware directly to PUT manifest, PUT files and GET status. It no longer runs on the runner's start/resume/stop/result handlers.
- Match the established app HTTPException convention: preserve an explicitly attached response, otherwise return `{error: error.message}` as JSON with the original status. Package refusal codes and storage/database temporary-failure handling are retained.

Mechanically retain all three R1 intake and four main runner `data.import` permission entries exactly in src/modules/access/route-permissions.ts. Regenerate sources.lock.json after all tracked edits. The shared worker contract is byte-identical to both parents (SHA-256 23c20b626d692e6c6f6ec31daed62699a83004a25fd5e01c167b3ccc35c9a993). All 21 test files changed by either parent are preserved whole from their owning parent. No journey assertion was edited, skipped, weakened or removed. No actor helper change was needed; there is no requested expansion to another file.

The other differences against main are the already accepted R1 intake changes. The existing R2 engine, schema, migrations, release declaration, tests and other main work were merged intact. No new engine, schema, migration, declaration/spec, release, contract/status, UI or homepage changes were authored for this seam. No screen changed in the seam; browser screenshots at 1440/390 are therefore not applicable. This does not replace R1's prior UI qualification.

## Local evidence

| Check | Before | After |
| --- | --- | --- |
| Unchanged bounded legacy runner registration | 0 pass / 1 fail (JSON parse) | 1 pass / 0 fail |
| Unchanged move-in admission journey | not rerun on failing baseline | 1 pass / 0 fail (357,940.8 ms) |
| Existing custom-role journey | not rerun on failing baseline | 1 pass / 0 fail |
| HTTP seam one-off public-door probe | reported plain-text refusal reproduced by runner | 18 assertions passed |
| Typecheck | not a baseline target | exit 0 |
| Source lock regeneration / check | merge conflict, main lock used temporarily | exit 0 / 0 |
| First-party profile | not a baseline target | exit 0, also after lock |
| Contract generator check | no source edit | exit 0, current views |
| Static test registration census | 108 | 108 (no registrations in loops) |
| Contract status counts | 4 done / 71 partial / 16 missing / 91 total | unchanged |

Commands and actual stdout are in check-receipt.json and the selected log files. Every long setup/build/journey command used cloud_run and its child subreaper in this dedicated VM. The supplied toolchain retained VM Node v24.19.0 and pnpm 10.12.4; the repository pins Node 22.20.0 and the exact-SHA branch workflow uses that pin. Baseline `npx -y @runeditrun/rer setup --owner-email fleet@runeditrun.com --non-interactive` completed, and baseline `npx -y @runeditrun/rer build` reported `build: complete (exit 0)`. No full local suite was run.

The 18 one-off HTTP assertions prove JSON and status on all four runner controls: operator 403, no session 401, foreign workspace 404; intake manifest makes the same refusals. Intake version 2 still refuses 422; the owner accepts an ordinary manifest with 201. A runner start carrying the intake-only version header follows its own approval check and returns 409 approval_mismatch, proving route ownership. These probes create zero runner runs, queue jobs or outbound calls.

The unchanged intake admission helper, also included in the passing admission registration, retains current owner/admin permissions, operator/foreign/no-session/CSRF refusal, manifest/file limits, digest/size/count validation, secret-policy refusal, immutable custody and repeat behavior, interrupted-upload resumption and custom-admin data.import refusal; business counts and queued jobs remain unchanged. The existing custom-role journey also exercises step-up and native/delegated permission boundaries. Native authentication, second factor and CSRF code are untouched.

## Publication and custody

Product push succeeded on the first guard attempt to cloud/hh-importer-seam-fix-1, with no force push and no default-branch update. All six origin/main..HEAD commits, including side parents, passed author, committer and trailer policy. Five accepted R1 commits retain owner identity James Peter <github@zemaj.com>; the new merge uses Run Edit Run fleet <fleet@runeditrun.com>. No co-author trailer is present. The repository commit hook remained active and preserved original hooks.

The installed Base publication entry point was attempted on the full-history exact candidate, with public base https://github.com/just-every/run-happytohelp#main and edition just-every/happytohelp. It returned INCOMPLETE / scan.gitleaks-unavailable. There is no COMPLETE scan claim; the supported fleet/Mac lander must run the COMPLETE publication scan before any public publication or landing. This cloud limitation is pending lander work, not a bypass or product acceptance.

CI results and watcher call timestamps are recorded in ci-receipt.json; report finalization adds the terminal exact-SHA result below. Evidence publication uses a separate report-only tree at refs/heads/evidence/hh-importer-seam-fix-1. It conveys reports only and never signals product READY, acceptance, gate PASS or landing. No PR, landing, deployment, production/provider contact, real-data intake or hold clearing occurred.

## Claims, defaults and gaps

No clause status changes. The seam supplies supporting synthetic evidence only; existing acceptance judgments remain unchanged.

CLAIM MIGRATION-001 PARTIAL points=none tests=tests/journeys/legacy.mjs#an owner runs a bounded legacy package through HTTP and queue, stops in-flight writes, resumes two real Worker deaths and replays zero rows
CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly
DEFAULT MIGRATION-001: preserve all existing judgments and native authority; do not expand the seam into worker, schema or fidelity repairs.
GAP MIGRATION-001: independent importer authority gate and adoption/custody A/B/C remain separately required; this supporting seam run does not qualify all acceptance points.
GAP MOVE-IN-002: no live incumbent/provider, real export, channel cutover or real-data intake qualification is claimed.

The PLAN.md file contains the complete execution plan. Scope and source receipts preserve the merge provenance, worker-contract identity, parent test preservation, stable counts and check commands. CANDIDATE custody remains held for the independent gate, regardless of branch CI success. Standalone READY is intentionally withheld under the brief and hh common's specific gate rule.

## Supplemental invocation limit

A redundant standalone invocation of `legacyPackageAdmission()` was started while the required enclosing admission registration was still running. The required registration completed successfully, including that unchanged helper. The standalone invocation produced no stdout for over 360 seconds and was cancelled; its recorded Node/esbuild/workerd PIDs alone were stopped. This supplemental invocation has no assertion result and is not counted as a pass. Its actual empty stdout and cancellation receipt are retained. No timing, test-harness or product repair was added for this out-of-scope stall. Exact-SHA Verify remains the full candidate wall.

Integrated baseline tree identity: `3e82bc7e1fc18ced9af913b592f870bda32333ac`. Reconstruct it from the candidate tree by restoring package-in/routes.ts from the exact R1 parent and sources.lock.json from the exact main parent; see baseline-receipt.json. This records the tested baseline without manufacturing a commit.

## Terminal CI and handover

Exact-SHA Verify **completed/success**: run **43233769000**, https://github.com/just-every/run-happytohelp/actions/runs/43233769000, head **403c8317144571852bcbcaae34ba4e3ce8bcc06c**. One watcher made six GitHub REST calls total, with at least 300 seconds between every discovery/status call. No retry, rerun or dispatch was requested, and there were no failing jobs to read. `ci-receipt.json` records actual timestamps and conclusion; `ci-watch.log` is the complete watcher output.

Product custody: PUSHED and exact-head branch Verify green; **CANDIDATE held for required independent gate**, never landing consent. No product blocker remains in the owned seam. The independent importer authority gate, adoption/custody A/B/C and the local lander COMPLETE publication scan remain required. The cloud publication scanner limitation and supplemental intake cancellation are disclosed above. The owned clone is removed only after evidence publication succeeds; the pushed product branch and separate evidence ref retain custody.
