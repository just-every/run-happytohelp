# HappyToHelp ticket edits and lifecycle header replay

Repository: just-every/run-happytohelp
Branch: cloud/main-happytohelp-ticket-status-1-c1
Candidate: c1dcf0aefd7fc998468862f117e508bb998651de
Base: 822c4b74abd35869f68555227b4760da4b59d114
Source: ea30383aae21e1518b7c1cfea78d3a7f28fed82c against acdcff44b1dae61a4c5559807c33430fd0891dbd

## Result

The named branch has exactly one new commit and no merge commit. All seven product/test files are byte-identical to the finished source commit; only the generated source lock incorporates current main. The change applied without conflicts. No adaptation was required. Main's newer mailbox behavior and tests remain intact. The earlier cloud/main-happytohelp-ticket-status-1 branch was only fetched.

Tag additions and removals return the confirmed ticket, and the Summary adopts its version for the next edit. A genuinely intervening write still causes refusal, without automatic retry or overwriting the other save. The operator header shows New, Open, Pending, On-hold, Solved and Closed as their actual lifecycle categories; active tickets offer Solve, Solved offers Reopen, and final Closed offers neither.

CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md are byte-identical to origin/main. No clause Status, Gap or Evidence was edited and no DONE claim is made. No provider, deployment, release, visitor-view or closure-timing change was made.

## Plan and execution

The complete plan is in PLAN.md. Full history was cloned, fleet identity and cleanup hooks installed, and the named branch started from current main. The source patch was applied without committing so checks and source-lock regeneration could finish before the first product commit. Before that commit, origin/main was fetched and the unpublished branch rebased; main was unchanged. The source lock was regenerated last using the documented tool and checked. Exactly one real commit was created and immediately pushed with cloud-push.py. No published history was rewritten, no default branch was pushed, and no PR is required by this repository's supplied landing rules. The fleet lander owns the full publication scan and landing.

## Validation

- Private local setup passed with Node 22.20.0 and pnpm 10.12.4; 195 migrations applied, application built, native owner created. Raw answers and setup output are excluded from evidence. Initial missing-answer and contained-path refusals were corrected; see setup-receipt.json.
- `pnpm run typecheck`: passed.
- `node scripts/edition-authoring/cli.mjs lock`: passed; `check` returned `ok: true`.
- `pnpm exec rer check --profile first-party`: passed.
- `node src/site/base/contract-docs.mjs check`: passed, zero errors/warnings and current generated documents.
- Original `ticketsBrowser()` public-door journey: passed, including `ticketStatusEdits()`. The same operator sets priority, adds a tag, changes status, removes the tag and changes status again without reload. It verifies Solved before/after reload and the other lifecycle labels/actions. It holds one tab's versioned PATCH, performs an intervening public API save as another tab, then verifies the refused PATCH preserves the intervening ticket exactly. Existing final-Closed and refused-solve assertions remain and pass.
- Additional direct `ticketsJourney()` attempt and bounded native startup diagnostic did not reach startup in this cloud environment. They were stopped by their recorded PIDs, not reported as passing. The required concurrent-write browser assertion passed independently. See native-attempt.json. Exact-SHA CI remains the full wall.
- Changed-screen screenshots: ticket Summary and conversation header at 1440 and 390. The first screenshot script tried to click Hide after resizing; the app correctly closes the compact sheet on resize, so that proof script was corrected to reopen it through its public toggle. This required no product change.
- `git diff --check`, candidate identity/trailer inspection, single-commit ancestry, clean checkout, byte comparison against source, and unchanged contract/view hashes: passed.

No full local `rer verify` or full local suite was run. No tests were deleted, skipped or weakened. The original journey was extended, with zero test registrations added or removed. A transparent direct-registration inventory is included; it is not represented as a full semantic test-budget census.

## Before and after

- Stranger findings addressed by the carried fix: 2 → 0 in the passing original public-door journey.
- Product diff: 8 files, 87 insertions, 15 deletions.
- Direct top-level test/contract registration sites: 108 → 108; registrations added/removed: 0/0.
- Recorded clause counts: DONE 4 → 4; PARTIAL 71 → 71; MISSING 16 → 16 (91 total).
- STATUS-001 recorded status: partial → partial. Other clauses unchanged.

CLAIM STATUS-001 PARTIAL points=none tests=tests/helpers/inbox/ticket-status-edits.mjs#ticketStatusEdits; tests/helpers/inbox/tickets-browser.mjs#ticketsBrowser
GAP STATUS-001: This narrow replay proves operator editing and header behavior; it makes no new claim covering every door and outcome of a complete numbered acceptance point.

## Publication and custody

Product push succeeded on the first guard attempt. Full author/committer/trailer inspection covered every commit in origin/main..HEAD; the sole candidate uses Run Edit Run fleet <fleet@runeditrun.com> for both identities and has no trailers or skip markers. Evidence remains separate from product custody and will be published only to evidence/main-happytohelp-ticket-status-1-c1. The final receipt and exact-SHA CI files carry the terminal CI outcome. The packet contains public synthetic fixture screenshots, reports and actual command receipts; no local setup answers, state, credentials, environment dumps or held gate material is selected.

## Exact-SHA CI

Verify run 43454222292 is in progress on exact SHA c1dcf0aefd7fc998468862f117e508bb998651de: https://github.com/just-every/run-happytohelp/actions/runs/43454222292. The first immediate discovery returned no run; the second discovery after 301 seconds found this run. One watcher enforces at least 300 seconds between reads and records its GitHub calls. Terminal results will be appended below and in RECEIPT.json before evidence publication.
