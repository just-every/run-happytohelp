# HappyToHelp harness run 1 defect candidate

Run Edit Run fleet, 2026-11-15 UTC. Tag hh-run1-faults-1. Repository just-every/run-happytohelp. Builder; sole coupled-change writer; no helpers or trial contact.

The candidate preserves staff-only Zendesk definitions and typed values through upload and pull, keeps customer-form permission refusals, and documents the supported native owner sign-in door without mail. Clean upstream typecheck passes, so dashboard authentication is unchanged. No clause status is promoted.

## Plan and scope

The full execution plan is PLAN.md. Read the launcher, AGENTS.md, HANDOVER.md, relevant CONTRACT.md requirements and the inline briefs/RULES.md; clone shallow into a dedicated scratch; install frozen dependencies and fleet hooks; reproduce the import defect through existing public-door journeys; separate staff fields from form permissions; reproduce typecheck on clean main; verify the pinned sign-in implementation and correct operations instructions; run touched checks; regenerate source lock last; refresh main, inspect commit identities and push the named cloud branch; observe its natural exact-SHA Verify; return this packet through the evidence-only ref. Independent migration/data review and guarded landing remain fleet work.

Product scope: the Zendesk field reader and pull packer, existing import journey fixtures/assertions, OPERATIONS.md, and required sources.lock.json. No schema, dependency pin, version, release/tag, family source, provider, worker, deployment, harness implementation or UI redesign change. No CONTRACT.md, ACCEPTANCE.md or docs/CLAIMS.md edit. No real import, company data, live grant, outbound provider configuration or production operation. app.happytohelp.com was not accessed or changed.

## Fault 1: internal Zendesk fields

Baseline source is upstream v0.4.28, 41fb40246d2e69f928be397c48d952d147c39160. The existing reader applied visible_in_portal/editable_in_portal checks to both staff definitions and ticket values, incorrectly refusing internal fields. The pull packer independently called the same function with portal checks and omitted the definitions from ticket batches. The proposal needed that additional call-site repair: changing only the reader imported the definition but the new populated-value assertion still failed on pull.

The candidate adds an explicit portal context defaulting to true. Staff definition, ticket value and pull packing calls pass false; form translation retains the strict default. agent_can_edit:false, inactive and unsupported field refusals remain. A portal-visible read-only field is preserved for staff with field_portal_read_only_not_carried; a form referencing it or an internal field still refuses. Imports do not publish forms or grant customer access.

Before: the extended pull regression failed with two refused definitions and a field-only batch with nothing to import. The extended upload journey against the unchanged implementation rejected 305/306/307 and omitted values 305/306/307; see zendesk-upload-before-summary.json and the complete log. Its reviewed corpus had seven rejections.

After: assertions require the pull's field 72 and both populated values, including Closed-ticket history, to survive under staff authority; timestamps, repeat, later-pull undo and reimport retain them exactly once. The upload corpus requires six definitions and six typed ticket values instead of four, with five remaining rejections: the protected agent field, internal/read-only forms, original conditional form and unsupported trigger. Customers receive 403 at the staff ticket door, foreign workspace access receives 404, and customer messages contain no internal values. Public forms remain absent/disabled. Existing immutable original custody, no-send, source time, closed status, full business-state repeat/repack/undo assertions remain.

The confidentiality fixture initially left its newly created customer session behind, which correctly triggered the existing NATIVE_EDIT_CONFLICT undo guard. Deleting that fixture session correctly advanced the authority epoch, so the strict business-state equality assertion also caught the fixture mutation. The customer admission probe now runs after exact repeat/repack/undo has been proved, on a deliberately reimported synthetic corpus. The same bytes return the immutable undone receipt, so the new review uses whitespace-distinct export bytes, as the existing journey already does for repack/review behavior. No session/epoch reset, assertion exclusion or product guard change is used. Intermediate failures and complete receipts are retained, including the first reader-only pull attempt and the old repeated-refusal count assertion corrected from two to one.

## Fault 2: dashboard typing

`pnpm typecheck` passed on clean, unmodified upstream product source with Node 24.19.0 and again with the pinned Node 22.20.0, TypeScript 5.9.3, pnpm 10.12.4 and frozen dependencies. The same command is run after the candidate. The reported TS2322 was not reproduced; no dashboard, authentication or compiler-setting change was invented. Current src/routes/_dashboard.tsx returns an editorPreload boolean, refuses invalid paths, redirects an absent SSR session to /login and redirects incomplete two-factor authentication to /two-factor. Busy-session behavior and project/owner authorization remain unchanged. The before/after logs and receipts record the actual results.

## Fault 3: owner entry without mail

OPERATIONS.md now directs a mail-off owner from the deploying checkout to `node scripts/hosted-signin.mjs --environment production --email <ownerEmail> --env-file ~/happytohelp-deploy.env`, with the original existing owner email and that deployment's own credentials in an owned 0600 file. --project, --open and --json behavior, one use, 15-minute expiry and link secrecy are documented. No sender repair is required for this path. Treat stdout/JSON and the link fragment as credentials; never record them.

SIGNIN-REVIEW.md records the pinned runtime implementation. rer 0.2.117's help advertises generic mail-off owner sign-in, but its writer searches for oa_owner_signins/oa_operators. HappyToHelp uses native magic_signins/users; rer's unsupported-native branch refuses with exit 4 after deployment/credential checks. The mailOffSignIn declaration permits mail-off deployment but does not dispatch rer signin to the native script. That unified command gap remains runtime-owned. The supported native script checks the deployment receipt/live Worker identity and current existing owner/admin, then writes only a hashed native grant. Existing mailOffJourney proves synthetic one-use native consumption and no sending. No live grant or sign-in token was issued or captured by this task.

## Validation and custody

Actual command receipts and complete logs are in this packet. Only affected import journeys, the existing mail-off identity registration, typecheck, source lock/check and rer first-party check are used locally; no full suite or local Verify. Existing test registrations remain 5 pull + 3 admission + 10 identity, before and after. Browser proof is not required for these reader, typing and operations-documentation changes; no UI file is changed.

Clause statuses are unchanged: 4 done, 71 partial, 16 missing before and after. No claim of a whole clause becoming DONE is made. MOVE-IN-002, MOVE-IN-004, ZENDESK-IMPORT-001, NATIVE-001 and IDENTITY-002 retain their existing judgments. Narrow field preservation and native mail-off proof do not establish all-vendor migration, hosted qualification or the independent migration/data gate.

The requested publication shell entry point is unavailable in this cloud. Its read-only repository API lookup returned HTTP 404 on all five bounded attempts with bundle refresh; see PUBLICATION.md and publication-door-lookup.log. No substitute or hand-rolled scan was used, and no COMPLETE/PASS publication result is claimed. The cloud adaptation assigns the required publication scan to the fleet before landing. The independent migration/data gate is also still required. Evidence publication is report transport only and conveys no acceptance or landing signal.

Final product SHA, natural Verify run/result, final touched-check receipts and evidence custody are appended below when observed.

## Published product

Branch: cloud/hh-run1-faults-1. Head: d44ec03a88f985ce688d2ad475e8e97039fc5fd6. Pushed successfully on the first guard attempt. No PR was required or created. Main was refreshed and the unpublished candidate rebased (no-op); main remains 41fb40246d2e69f928be397c48d952d147c39160. All candidate author/committer identities are Run Edit Run fleet <fleet@runeditrun.com>, with no trailers. No history was force-pushed or rewritten after publication. See product.patch and diff-stat.txt for the actual nine-file diff.

Local checks: the final upload registration passes 1/1 (280.84 seconds), the final pull registration passes 1/1 (25.03 seconds), the other four pull cases passed in the preceding complete five-case run, and mail-off identity passes 1/1. The preceding complete pull run was 4/5 because its first case still expected the old two-definition refusal count; the corrected first case was rerun with preservation/undo assertions. Typecheck and first-party rer check pass; source lock/check and the post-rebase source check pass. All intermediate failures remain in the packet; none is presented as a passing run.

## Narrow claims and retained gaps

CLAIM MOVE-IN-002 PARTIAL points=none tests=tests/journeys/move-in-zendesk-pull.mjs#an owner connects Zendesk with PKCE, pulls the whole account, approves once, finds tickets by id, catches up new replies and tickets, and pulls again after an undo

CLAIM MOVE-IN-004 PARTIAL points=none tests=tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly

CLAIM ZENDESK-IMPORT-001 PARTIAL points=none tests=tests/journeys/move-in-admission.mjs#review an export, import its history and private notes, repeat and repackage without effects, then undo exactly

CLAIM NATIVE-001 PARTIAL points=none tests=tests/journeys/identity.mjs#an installation with outbound email off refuses every sign-in mail in words, contacts no provider, and admits an owner through a deploy-credential grant once

CLAIM IDENTITY-002 PARTIAL points=none tests=tests/journeys/identity.mjs#an installation with outbound email off refuses every sign-in mail in words, contacts no provider, and admits an owner through a deploy-credential grant once

DEFAULT MOVE-IN-004: Preserve native staff fields and typed values without publishing a customer form; retain portal and agent edit refusals.

GAP MOVE-IN-004: Full cross-vendor configuration acceptance and the independent migration/data gate remain pending.

GAP MOVE-IN-002: This synthetic defect candidate does not establish live imports, full vendor qualification or channel cutover.

GAP ZENDESK-IMPORT-001: No whole-clause promotion or new capacity/hosted qualification is claimed.

GAP NATIVE-001: Remote provisioning and the separate read-only provider preflight remain outside this repair.

GAP IDENTITY-002: Pinned rer native-account sign-in dispatch remains runtime-owned; the supported native script is documented and no live hosted grant was issued.

## Exact-SHA Verify and final return

Natural push Verify [43674128179](https://github.com/just-every/run-happytohelp/actions/runs/43674128179) was last observed in_progress (no conclusion) on d44ec03a88f985ce688d2ad475e8e97039fc5fd6. The ten-call explicit GitHub budget is exhausted; no further workflow poll or job-log read was made. There was no dispatch or rerun. Terminal custody is PUSHED; a running workflow is not claimed green and READY is withheld until the exact-SHA bar is met. One watcher used 5 REST calls with at least 300 seconds between observations; total explicit repository/workflow calls including the five publication-shell lookups: 10. CI.json and CI-calls.json retain actual observed receipts. No main/default branch push, PR landing, Run site or release was performed. Independent migration/data review and a COMPLETE fleet publication scan remain required before landing.

The evidence-only ref is refs/heads/evidence/hh-run1-faults-1. Its manifest binds this entire explicitly selected non-secret packet to the product head and hashes each file. Publication is report transport, not acceptance or landing.

Final signed relay lines:

POST lanes/hh/INBOX.md: 2026-11-15T04:16:25Z hh / Run Edit Run fleet — hh-run1-faults-1: cloud/hh-run1-faults-1 head=d44ec03a88f985ce688d2ad475e8e97039fc5fd6; Verify run 43674128179=in_progress (no conclusion) on exact SHA; custody=PUSHED; staff-only Zendesk fields/values preserved in upload and pull, portal/agent restrictions retained, native mail-off sign-in documented; TS2322 not reproduced with Node 22.20.0; clause status changes none (4 done/71 partial/16 missing). Independent migration/data gate and fleet publication scan required before landing.

POST lanes/strategy/INBOX.md: 2026-11-15T04:16:25Z hh / Run Edit Run fleet — hh-run1-faults-1 candidate head=d44ec03a88f985ce688d2ad475e8e97039fc5fd6, branch cloud/hh-run1-faults-1, Verify 43674128179=in_progress (no conclusion); custody=PUSHED; synthetic upload values 4→6 and refusals 7→5, private values stay off customer doors; typecheck passes unchanged main and candidate. Mail-off native command documented; rer 0.2.117 native-account dispatch remains runtime-owned. No clause promotions, trial contact, live import/grant or landing; independent data gate and fleet publication scan remain.

Run Edit Run fleet, 2026-11-15T04:16:25Z.
