# Ticket edits and lifecycle header repair

Repository: just-every/run-happytohelp
Branch: cloud/main-happytohelp-ticket-status-1
Baseline: acdcff44b1dae61a4c5559807c33430fd0891dbd (v0.4.24)
Candidate: ea30383aae21e1518b7c1cfea78d3a7f28fed82c
Product push: succeeded on the first attempt; no default branch push and no PR required by this repository’s instructions.

## Plan

The full plan is in PLAN.md. Reproduce both findings through native login and the built operator inbox; return the confirmed ticket from tag writes and adopt its version in the summary; show the actual lifecycle category and its appropriate header action; extend the surviving browser journey without adding registrations; preserve genuine concurrency refusal; run touched checks and source-lock checks, push the candidate, obtain exact-SHA Verify and publish evidence separately.

## Reproduction on main

Native login and the real operator ticket summary reproduced both reported findings on current main. Priority High saved, adding saturday-walk saved, and the next Status change returned “Ticket changed. Reload before applying changes.” No other operator was involved. After reloading, solving and reloading again, the summary's selected status was solved while the header read Closed. Pending and On-hold each read Open in the header. before.json and before-stale-1440.png / before-solved-1440.png record the observed results.

## Changes

- POST and DELETE tag routes now include the authoritative ticket already returned by their guarded mutation, preserving their existing tag/removal response fields.
- The tag control passes that ticket into the summary record's apply operation. Both the summary and conversation adopt the confirmed version and tags before the next user edit. Summary writes continue to send expected_version; no unconditional refresh or automatic write retry bypasses the stale guard.
- The operator header labels New, Open, Pending, On-hold, Solved and final Closed from status_category. Active statuses offer Solve, Solved offers Reopen, and Closed remains final without either action. Legacy records without a category retain a fallback. No lifecycle model, close timing, visitor view or other ticket fields changed.
- The existing ticket browser journey now runs priority changes, tag addition, status changes without reload, Solved persistence after reload, all active category labels/actions, tag removal followed by status, and a held stale write while another tab's public save lands. It checks that the competing save survives unchanged. Existing Closed-final and refusal assertions are retained.

## Counts and claims

Before/after: 108/108 test registrations in tracked tests (AST count, no loop-generated registrations), no test added or removed. The existing lead ticket journey was extended. Contract summary counts remain Done 4 / Partial 71 / Missing 16 / Total 91 before and after. STATUS-001 remains PARTIAL. No CONTRACT.md Status, Gap or Evidence cell was edited, and neither generated view was committed.

CLAIM STATUS-001 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow
GAP STATUS-001: This repair qualifies the named operator summary and header behavior; it makes no new claim of complete lifecycle acceptance across every channel.

## Verification and publication

Actual command results, candidate SHA, exact-SHA CI runs and screenshots are recorded in RECEIPT.json and browser-proof.json. Setup and baseline/candidate builds used cloud_run. One initial browser run failed because a new assertion used a button's title instead of its accessible text; the locator was corrected, and the rerun result is recorded separately. No product assertion was weakened. Source lock was regenerated with the documented command, including the newly staged helper, and checked. Main was fetched and the unpublished branch rebased without conflicts; main had not moved from the baseline.

Product commits contain only code, the extended journey/helper and generated source lock. All reports, receipts and screenshots are published only through the evidence ref. The Mac fleet owns the full publication scan, merge/landing and generated acceptance views. No deployment or default-branch push is part of this run.

Local result: touched route journey passed (1 registered test, 0 failures); the extended ticketsBrowser passed at 1440; typecheck, candidate build, source-lock check and first-party check all passed. Exact-SHA Verify run 43426535076 is being watched through REST with a minimum 300-second cadence.

Candidate browser proof passed on ea30383aae21e1518b7c1cfea78d3a7f28fed82c. Final 1440 and 390 screenshots show the saved summary and Solved header; phone captures wait for the existing panel animation to settle.

Visual review: the 390 Summary shows Solved, High and saturday-walk within the viewport; the separate header capture shows Solved and Reopen. Opening the phone panel through its normal control supplies the Summary capture after resizing closes the desktop panel.

## Browser captures

| Screen | Main reproduction | Candidate |
| --- | --- | --- |
| Ticket/header at 1440 | [Stale edit](before-stale-1440.png), [Solved shown as Closed](before-solved-1440.png) | [Saved Solved summary and header](after-solved-1440.png) |
| Ticket summary at 390 | Not captured | [Solved, High and added tag](after-summary-390.png) |
| Conversation header at 390 | Not captured | [Solved and Reopen](after-header-390.png) |
