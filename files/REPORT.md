# HappyToHelp owner inbox continuation

Run Edit Run fleet, 2026-11-17 UTC. Tag: hh-owner-design-inbox-1-c1.

**Outcome:** the approved parent design decisions are preserved, readable Security log events are restored, and the existing journeys use the approved labels. All required local checks passed. Exact-head Verify **44114592953 completed successfully** on **4fd307fda11bcee6391689fc36b701e7a1c91aa7**. Product and report evidence use separate refs.

Repository: just-every/run-happytohelp. Product branch: cloud/hh-owner-design-inbox-1-c1. Parent: 4c86a426ccd1184b2be306de181a27ef85e767d3. Main at initial/fresh fetch: bb70a0424b6f1efef5b10cb14992f1b579f1fc50.

## Plan

See PLAN.md for the full executed plan. Start at the published parent; reproduce the four named failures serially; distinguish approved wording changes, actual regressions, and pre-existing failures through a same-VM main comparison. Preserve every design decision and sibling-owned flow. Run only typecheck, rer check, source checks and affected journeys. Regenerate the source lock last, inspect all candidate identities/trailers, push with the fleet guard, and require exact-head Verify. Publish all reports and receipts only through the evidence ref.

## Failure classification

- Customer identity audit: class (b), regression. D21 replaced the action-name fallback with a generic sentence. The existing customer journey still proves verified association preview/apply, reversible history, and unchanged customer authority, but no longer finds a readable identity-link event. Add explicit plain descriptions for customer.identity_linked and customer.identity_unlinked; keep raw codes in collapsed Details.
- Ticket journey: class (a), approved wording changes. D13 names the active survey action “Solve and ask for a rating”; D15 names the internal status “On hold”. Update the existing ticketStatusEdits helper to use those decided labels while retaining every public API readback, stale-write rejection, lifecycle/header and reopen-control assertion.
- Account-security journey: mixed (a)/(b). D21 deliberately labels a succeeded result “Completed”, so update that selector. The same change removed the readable description for session.signed_out; restore “Signed out”. Keep the original second-session revocation, original-session survival, sign-in link, factor, passkey and export assertions.
- Procedures journey: class (c), historical flake/unreproduced in this task. The entire unchanged registration passed on parent 4c86a426 (355322 ms) and on main bb70a042 (358110 ms) on this same VM. The reported “expected 0 actual 1” did not reproduce on either head. This establishes no deterministic regression in this round; it does not claim that the same failure was observed on main. Procedure code and assertions are unchanged. The candidate run and exact-SHA CI remain required; if that shard fails with this journey, rerun it once under the triage rule.

## Log retrieval

The three permitted completed-job archive reads used three GitHub calls. Two returned no output. The workflow-browser archive failed with `failed to get run log: zip: not a valid zip file`; HTTP status was not supplied. Exact commands and actual results are retained in ci-log-retrieval.json and the selected stderr file. No blocked download was retried. Local reproductions supply the diagnosis: four selected parent registrations ran, three failed at precisely the named selectors, and procedures passed. See reproduce-parent.log and procedures-main.log for the complete actual results.

## Scope and counts

No contract judgment or generated view is edited. The recorded contract summary remains 4 done, 71 partial, 16 missing, 91 total. The repair adds/removes/skips no test registration. Existing journey-file count is 121 registrations in 38 files, with no registration loops; rows are in counts-before.json. Final recount will accompany the candidate receipt. No release, version, tag, migration, dependency pin, Base refresh, live installation, mail/provider account or sibling sign-in/password/time-zone/widget-confirmation code is changed.

## Final local validation and product custody

Product head: `4fd307fda11bcee6391689fc36b701e7a1c91aa7`. Its only new commit is “Restore readable audit events and align owner inbox journeys”. Product push succeeded on the first guarded attempt, after checking all five candidate commits, including all side parents, for fleet author/committer identities and permitted trailers. The remote product ref was read back with Git and equals this head. The worktree is clean. No PR, main push, force push, deployment, release or landing was performed.

All required local checks passed with Node 22.20.0 and pnpm 10.12.4: source-lock generation, source check, typecheck, `rer check --profile first-party`, candidate build, the four selected browser registrations, the separate Security log public-door capture, and a final source check. No full local suite or local full Verify was run. The source lock was regenerated after the final tracked source/test edit and changes only the three affected entries.

The selected parent run had 1 pass and 3 failures; the candidate has **4 pass, 0 fail, 0 skipped**. The main procedure comparison passed 1/1. The candidate procedures registration passed unchanged again (356508 ms). The local-check receipt records each real command, its exit status, and the SHA-256 of every changed source/test file. Each hash was compared with the committed Git bytes and matched `4fd307fda11bcee6391689fc36b701e7a1c91aa7`.

The two existing tests updated in this repair are:

- `tests/journeys/workflows-browser.mjs` — “a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow”, via `tests/helpers/inbox/ticket-status-edits.mjs`. Only the decided On hold and Solve and ask for a rating locators changed; every lifecycle/readback/reload/stale-write assertion remains.
- `tests/journeys/identity-browser.mjs` — “an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session”, via `tests/helpers/identity/security-browser.mjs`. Only the decided Completed result locator changed; session, factor, export and return-path assertions remain.

The existing customer-link registration is unmodified and passed after the code repair. The procedures registration and page are unmodified. Journey registrations remain **121 → 121**; the contract summary remains **4 done / 71 partial / 16 missing / 91 total**. No clause is promoted or demoted; no CONTRACT.md, ACCEPTANCE.md or docs/CLAIMS.md content changed.

## Truthfulness and visual proof

The separate capture creates a real workspace through its native public door, creates independently signed synthetic widget identities, previews and applies the link and unlink, and signs out a separately issued session. It confirms audit action/outcome receipts, revocation of that session, survival of the other session, and `grants_customer_access: false`. No log entries are fabricated. Before, all three events read “Workspace activity recorded”; after, they read “Signed out”, “Customer identity linked” and “Customer identity unlinked”. Completed results and collapsed Details are retained. No sentence about delivery, sign-in, password, billing or customer-visible product behavior was added or changed by this repair.

Screenshots captured and inspected once per width for the changed Security log screen:

- `screenshots/security-log-before-1440.png`
- `screenshots/security-log-before-390.png`
- `screenshots/security-log-after-1440.png`
- `screenshots/security-log-after-390.png`

`security-log-before.json` and `security-log-after.json` retain the actual public-door outcomes and displayed descriptions. Assertions run at 1440; the phone screenshot is visual proof.

## Exact-head CI

Verify run **44114592953** was discovered through the required exact-head REST query on `4fd307fda11bcee6391689fc36b701e7a1c91aa7`. Initial state: queued. The initial delayed reader was interrupted by an environment restart before its next API request. The packet and clean pushed checkout survived. A resumed REST read at 15:34:11 UTC, more than five minutes after discovery, returned in_progress on the exact head. Five calls have been used: three prior failed-job archive reads, one discovery and one status read. Subsequent reads retain the five-minute minimum. The completed result is recorded below. No green claim is made from another SHA.

## Clause boundaries

AUDIT-001, CUSTOMER-001 and STATUS-001 receive repaired/retained browser evidence only. This round proves no complete new acceptance point for those larger partial clauses. Their existing status judgments and gaps remain unchanged. Every parent decision D4, D11, D13-D16, D18, D21 and D22 is retained.

Final evidence publication is report-only and separate from the product branch and its READY custody. The complete plan, report, real receipts, selected logs and inspected screenshots are explicitly selected for the task evidence ref. The Mac fleet still owns publication scanning, integration, landing and any main-only workflow.


CI job snapshot at 15:54:11 UTC (eighth GitHub call): contract-docs, build, size-check and six of eight push shards succeeded. In particular support-workflow-browser (job 134150339908) and identity-and-repair-browser (job 134150339957) succeeded, including the unchanged procedures registration. support-and-recovery (134150339442) and import-and-reports (134150339634) were still running. No failure was reported in that snapshot. See ci-jobs.json.

## Completed exact-head Verify and final handoff

At 2026-11-17T16:04:11Z, the required REST run endpoint returned `status: completed`, `conclusion: success`, and `head_sha: 4fd307fda11bcee6391689fc36b701e7a1c91aa7` for Verify **44114592953**:
https://github.com/just-every/run-happytohelp/actions/runs/44114592953

This is a full workflow success, without using the generated-view exception and without rerunning any shard. Nine log/CI GitHub calls were used, with no status/metadata reads less than 300 seconds apart. The two previously pending shards and the workflow's final proof/Verify jobs are covered by that successful overall result. No completed candidate failure needed a log read or retry. The prior failed run was 44094867861; its archive-transfer limitation is recorded above and does not replace the successful new run.

No blocker remains. No contract status, gap or evidence cell changed. Product branch: `cloud/hh-owner-design-inbox-1-c1`. Exact product head: `4fd307fda11bcee6391689fc36b701e7a1c91aa7`. No PR was created; the fleet owns landing. The product tree contains only the one-line label map repair, three existing test locator substitutions and regenerated source-lock hashes in this continuation commit.

The existing verification scripts and all journey registrations are retained. The report, plan, receipts and screenshots remain outside the product tree and are selected explicitly for `refs/heads/evidence/hh-owner-design-inbox-1-c1`. Evidence publication is not product acceptance or landing. The supplied report-only transport preserves the product branch/head/index. The fleet performs its independent publication scan and landing gates.

CLAIM AUDIT-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#an owner explicitly redeems a scanner-safe sign-in link, enrolls factors, signs in with a passkey, steps up for an audit export and signs out only the current session
CLAIM CUSTOMER-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#an operator replies from the phone inbox, opens a company customer and reviews and reverses a labelled identity link without changing customer authority
CLAIM STATUS-001 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow

Signed Run Edit Run fleet, 2026-11-17T16:04:11Z.
