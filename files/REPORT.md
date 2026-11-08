# hh-ai-mode-followups-2-gate-1

The four K18 follow-ups may land with one minor consolidation follow-up. No blocking A, B or BAR finding was demonstrated. Full row scoring is in VERDICT.md; the plan is in PLAN.md; every integration caveat is in LANDING-NOTES.md and trial-resolution.md.

## Provenance and scope

- Repository: just-every/run-happytohelp, treated as public for evidence publication.
- Reviewed product branch: cloud/hh-ai-mode-followups-2.
- Reviewed full head: 9b238cf006b53e22ca124e013a027dbb4b7a47e7.
- Candidate implementation commit: ccb7197677aeeeb7fe37b9dbab06c936b56e8008, based on e8703857.
- Candidate merge parent/main: d1d77817; integration baseline: df2868c5d292ec7c5567cd4c1c1151ab28ae65b8.
- Exact-SHA Verify: 42475134770, completed/success, https://github.com/just-every/run-happytohelp/actions/runs/42475134770. Both actual run metadata responses are saved. The explicitly requested gh run view was executed once; a REST metadata read bound the result to its full head SHA. Two gh invocations total; no polling, log archive read, dispatch or rerun was needed.
- This gate has no product commit or push and opens no PR. The launcher's local cloud/hh-ai-mode-followups-2-gate-1 branch stays unpublished. No READY/PUSHED custody is claimed by an evidence push.
- Trial integration is an uncommitted local tree only, not a new product SHA. Its tree and parent hashes are recorded in review-receipt.json and trial-tree.txt. The lander must create and check its own actual merge; this gate does not certify future exact-SHA CI.

## Frozen plan and incumbent bar

The initial plan fixed F1–F5 before runtime probes. The gate read source and both comparison diffs, ran its own concurrent public-door cases, built and tested the changed settings control, checked proactive visitor behavior and hold-audit behavior, independently regenerated/checks locks/views, and compared affected behavior to main. No feature audit or extra product bar was added.

CONTRACT.md Product target names Zendesk, Intercom with Fin, Help Scout and Freshdesk, with Decagon/Sierra/Pylon as the agent baseline. For this behavior the ordinary buyer bar is persistent independent settings, a trustworthy failed-save control, AI drafts held for humans, mode changes honored at visitor delivery, and traceable withheld mail. No competitor capability beyond the brief is a blocking requirement here.

## Results

The complete F1–F5 verdict lines are in VERDICT.md. Key actual outcomes:

PROBE F1 1: Concurrent PUTs to /api/management/projects/:projectId/{ai,settings,availability,widget-settings}, with real D1 reads forced to overlap in the test driver -> both changed fields persist, unchanged defaults and mode clocks are preserved, responses remain compatible; 8/8 head, 8/8 trial, 5/8 main. Unforced concurrent requests also pass 8/8 on all three. The three main losses affect unrelated general/widget/availability values; the candidate repairs them.
PROBE F2 1: Built /projects/:projectId/ais -> save draft -> change session to unrelated workspace owner -> choose off -> PUT 403; select displays draft again, error visible with aria-invalid and aria-describedby; stored mode read from GET /ai remains draft. Candidate, main and trial pass at assertion width 1440; each has 1440/390 screenshots.
PROBE F3 1: Public GET /api/widget/settings and visitor contextConsent/collector/insights/useInsight/transcript doors -> auto: enabled=true, 3 synthetic provider calls, 1 offer, 1 AI message; draft/off: enabled=false, 0 provider calls, 0 offers, 0 AI messages. Passes on head/trial. Head's duplicate predicate is the sole C follow-up; trial retains main's shared proactiveHelpOn.
PROBE F4 1: Native assignment -> configured synthetic model -> revoked synthetic mail authority -> real held notification -> PUT /ai draft -> scheduled outbox -> GET /audit -> one reasoned system event, no credentials/recipient/content, still one event on replay. Gate's fresh isolated runs pass on head and trial. Main's new event action/outcome/reason semantics are retained in the trial.
PROBE F5: No product edits by gate; candidate-owned 12-file diff and all new commit identities inspected; no migration-ledger invocation applies to those files. See review-receipt.json for actual checks and inventory.

The gate independently ran the touched public-door helper functions replyModes, proactiveReplyModes and replyModeMailHolds. On the resolved trial, replyModes includes all of K18b's extra concurrent-save assertions. The full touched registration `tests/journeys/ai.mjs#a visitor gets a source-linked answer from published knowledge, durable replay and a human handoff under current authority` passes: 1 test, 0 failures, 0 skipped. Unchanged registrations were excluded by an explicit test-name selection; no test source or workflow was skipped or weakened. The changed built control was tested directly rather than rerunning unrelated browser journeys.

## Mechanical results and source custody

MECHANICAL lock=node scripts/edition-authoring/cli.mjs lock; node scripts/edition-authoring/cli.mjs check exit=0; views=node src/site/base/contract-docs.mjs write; node src/site/base/contract-docs.mjs check exit=0; ledger=none exit=0 (not applicable: no candidate-owned migration).

The original exact head's source check passes before writing anything. Exact-head view and lock regeneration leave the complete tracked tree unchanged, with lock sha256 b5cee1f423baad7c50406ebf2b97cc8c6ca422715ac93b6da0d6d66b8fcff8a8. A separate prescribed main-view restore changed only ACCEPTANCE.md's hash in a scratch lock; afterward the candidate was restored and independently checked again. The trial source lock was generated after resolving its source/test conflicts and checks successfully. No generated view was committed. No clause Status/Gap/Evidence cell was edited; the trial takes main's entire CONTRACT.md.

`pnpm run typecheck` exits 0 on head and trial. `rer check --profile first-party` exits 0 on both. All three application builds complete successfully. Node 24.19.0 / pnpm 10.12.4 is the actual cloud shim selection; pinned workflow CI is separately verified. Chromium uses /usr/bin/chromium and --no-sandbox. Browser contexts and local fixtures are synthetic and cleaned up by their runtimes.

## Findings and integration

FOLLOW-UP C: F3's newly introduced public-settings predicate duplicates the monitoring decision. There is no demonstrated runtime mode leak. Keep main's proactiveHelpOn in the merge; the tested trial does this and passes. One minor follow-up, not an A/B/BAR blocker.

NOTE G: The trial merge conflicts in sources.lock.json, rer-mail-hold.ts, policy.ts, projects.ts, reply-mode-change.ts, widget-settings.ts and AiReplyMode.jsx. Its test helper auto-merge also duplicates a const, and the older audit helper expects an event name that main intentionally replaced. trial-resolution.md records the full resolution rationale; trial-integration.patch records the resulting non-view source integration. Preserve main's newer local-computer and human-path behavior and its assertions. The lander must not blindly choose one parent's whole settings implementation.

NOTE F: Supplemental invalid readback/provider/hold-precondition attempts and initial trial failures are disclosed in SUPPLEMENTAL.md and supplemental-receipt.json. They are not counted as passing evidence. Fixed row F4 is proven by successful fresh isolated public-door executions and by the passing touched registration; no failed held-send precondition is represented as an audit failure or pass.

Before/after counts: 4 done / 71 partial / 16 missing (91 clause rows) unchanged; 94 top-level journey registrations unchanged. No new test registration is introduced by this candidate. The raw 36-file diff against e8703857 includes inherited ticket/erasure main work; the candidate-owned diff is 12 files. No broad DONE promotion or changed contract status is claimed.

CLAIM AI-001 PARTIAL points=none tests=tests/helpers/ai/configured-execution.mjs#replyModes; tests/helpers/ai/reply-mode-followups.mjs#proactiveReplyModes; tests/helpers/ai/reply-mode-followups.mjs#replyModeMailHolds; tests/helpers/ai/reply-mode-browser.mjs#replyModeBrowserJourney
DONE-RIDERS: no DONE assertion; local synthetic evidence qualifies only the four named follow-ups, not all AI-001 policy/provider/representative-quality obligations.
PRE-READY: gate makes no product READY claim; exact candidate Verify is successful, original source lock is current, generated views write/check, touched checks and typecheck pass. Mac publication scan and exact integrated-SHA workflow remain the lander's custody.

## Evidence and handoff

VERDICT.md, FOLLOW-UPS.md, LANDING-NOTES.md, PLAN.md, actual receipts, selected logs and browser screenshots are selected explicitly for evidence-only publication. No credentials, environment dump, real sessions, symlink or private held-out driver is selected. Evidence transport does not signal product READY, acceptance or landing.

Blockers: none. No A/B/BAR finding. No required gate check remains NOT RUN. No new PR was created. No live provider qualification, deployment or all-clause promotion is claimed.

POST lanes/hh/INBOX.md: hh-ai-mode-followups-2-gate-1 GATE PASS WITH FOLLOW-UPS 1; reviewed cloud/hh-ai-mode-followups-2 head=9b238cf006b53e22ca124e013a027dbb4b7a47e7 Verify=42475134770 success; clauses unchanged (AI-001 partial); F1/F2/F4/F5 met, F3 behavior met with minor consolidation; tested local df2868c5 merge; preserve main's shared predicate/new UI/audit semantics and resolve duplicate test const; no product push or PR.

GATE PASS WITH FOLLOW-UPS 1
