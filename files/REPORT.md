# HappyToHelp stranger-11 undo report

Run Edit Run fleet, 2026-11-16T16:18:42Z.

Repository: just-every/run-happytohelp
Branch: cloud/hh-stranger11-undo-1
Candidate head: 43bce0be0601d47bda9a37ea5271ea4241686951
Fresh main base: 2044dfa31d6b5e43dea1224bca08e0b509e48396
PR: none; this repository's branch Verify supplies the candidate entry point. The fleet owns landing.
Verify run: 43903926381; in_progress/None; https://github.com/just-every/run-happytohelp/actions/runs/43903926381
GitHub observations used: 3.

## Plan and implementation

The complete original plan is PLAN.md. Its executed steps were fleet setup and safeguards; fresh scoped clone; deterministic reproduction; query diagnosis and native undo/progress repair; exact-state and recovery regression coverage; native browser inspection; touched checks, source lock and guarded branch publication; exact-SHA CI observation; and separate evidence publication. No live installation, deployment or main update is part of this run.

The first undo step was spending its time in the native cross-reference guard. SQLite reordered ordinary joins so it walked all workspace conversations and repeatedly checked sibling ownership before checking whether a participant or matching message author existed. Keep the referencing table first with SQLite CROSS JOIN in the same four predicates (participants, message authors, tags, typed fields). The ownership, current-role, session, native-edit, erasure, successor and atomic publication fences remain active. Existing import-kit reversal still performs at most one bounded native batch per queue message. No Base source or migration changed.

A native undo-progress helper now counts actual committed provenance effects. The undo admission resets the forward-import cursor and creates an undo-specific report. Batch checkpoints, skipped unstarted children and reloaded reports use the same ledger. Removed versus restored counts distinguish a newly created target from a target with a prior image. Remaining effects are reported as retained on completion, or remaining during undo. The initial all-child reference check has an explicit checkpoint marker so initializing a visible undo report cannot skip that preflight. Reload after a stopped Worker reads committed provenance even when the enclosing run checkpoint was interrupted.

The existing native Move in section now shows undo-specific progress and Resume undo. Its original review is collapsed and labeled historical during/after undo; its old current-import/future-publication sentence is replaced with historical plan language. No new page type or design system was introduced.

## Item 7: responsive large import undo

Before: a generated 794723-byte wrapped Zendesk JSONL entered the mounted upload/review/apply routes. It contained 1000 distinct customers, 1000 complete mixed-status tickets, one public comment and one private staff note each, two tag strings, one macro and one public article. The 2003 physical source rows plus two derived tags produced 2005 review records and 2004 native changes (the staff author creates no login/native target). The first undo queue delivery did not finish before its recorded Worker was stopped; PID 3128 was observed at 98.7% CPU and 680832 KiB RSS. BASELINE.json records that actual observation. No before screenshot was retained. QUERY-PROFILE.json records the original and revised SQL plans on the synthetic native snapshot; the revised whole-run query completed in about 204 ms.

After: the committed scale journey uses the same documented shape and exact byte size, alongside an existing native contact/conversation. It reviews and applies, repeats the identical file without writes, undoes the whole import, kills only its identified child Worker mid-undo, resumes and checks every subsequent checkpoint. During undo it concurrently reads Inbox and also exercises Contacts, native contact detail, Triage and health. It asserts one batch (at most 20 changes) per delivery, a stable denominator, monotonic checkpoints, no widget notification and no outbound provider/model/mail request.

Observed exact-head scale result: 201 undo deliveries, maximum 314.8 ms per delivery, maximum 54.8 ms for a concurrent Inbox read, maximum 241 statements in any measured request. These are synthetic local Worker observations in the dedicated cloud VM, not hosted-provider qualification. The interrupted delivery is recovered from its durable journal; the timed maxima cover completed deliveries. No post-fix live-heap bound is claimed.

The independent existing equality helper compares all 474 business tables, retaining source links, native messages, private notes, tags, search content and prior native records. Only its existing explicit platform-counter, audit and import-journal exclusions apply; erasure or identity tables were not excluded for this task. Physical FTS shadows retain the helper's independent content-integrity validation. Exact hashes:

- Before import: 4a6e14044cb5a3b74394cdc937c12ff04c6a859276421c4fab2e952a874f06a7
- After undo: 4a6e14044cb5a3b74394cdc937c12ff04c6a859276421c4fab2e952a874f06a7
- Before repeat: fb853a97d2f7f9e859760e7a8dcd0c02233d36b05662d30eb925b19dedd36977
- After repeat: fb853a97d2f7f9e859760e7a8dcd0c02233d36b05662d30eb925b19dedd36977

A separate partial-apply case deliberately fails the database after a committed child, drops that fixture trigger, then uses the public Undo door. It reverses only the 9 actual native changes, skips unstarted reviewed children, keeps the denominator stable and restores exact business equality.

## Item 8: honest progress and completion

Before: the forward cursor remained 2005 at the undo request, while the first undo publication switched to the 2004-effect denominator. The original review component rendered its import and future article-publication sentence even for Undone. The baseline source and the maint report establish that wording; no synthetic before screenshot is claimed.

After: progress starts at 0 of 2004 imported changes. Completion reports 2004 removed, 0 prior records restored and 0 retained. These count native record bundles, not every nested SQL row: each conversation bundle includes its comments, private notes and associated source/state rows. The original source review remains available without claiming its records are currently imported or its article will be published.

The existing browser journey asserts the changed flow once at 1440 pixels. Its four changed-screen proof images were also visually inspected at 390 pixels:

- browser/move-in/undo-progress-1440.png
- browser/move-in/undo-progress-390.png
- browser/move-in/undo-complete-1440.png
- browser/move-in/undo-complete-390.png

The visual fixture has six tickets/18 native changes. The separate scale receipt proves 1000 customers/tickets; it is not represented as a 1000-ticket browser screenshot. The browser checks include the expanded original review and reject current-import/publication claims after undo. The existing accessibility/overflow checks and empty page-error collection also passed. VISUAL-REVIEW.json records the inspection; browser/move-in/checks.json records the browser observations and revision.

## Validation and boundaries

{
  "author": "Run Edit Run fleet",
  "date": "2026-11-16",
  "localChecks": [
    {
      "command": "node /tmp/hh-touched-checks.mjs",
      "result": "passed",
      "journeys": [
        {
          "journey": "reviewImportJourney",
          "result": "passed",
          "durationMs": 111866
        },
        {
          "journey": "custodyJourney",
          "result": "passed",
          "durationMs": 19432
        },
        {
          "journey": "importErasureJourney",
          "result": "passed",
          "durationMs": 3353
        }
      ],
      "duplicateApplyUndoFences": "passed"
    },
    {
      "command": "pnpm run typecheck",
      "result": "passed"
    },
    {
      "command": "npx -y @runeditrun/rer build",
      "result": "passed"
    },
    {
      "command": "node scripts/edition-authoring/cli.mjs lock",
      "result": "passed"
    },
    {
      "command": "node scripts/edition-authoring/cli.mjs check",
      "result": "passed"
    },
    {
      "command": "pnpm exec rer check --profile first-party",
      "result": "passed"
    }
  ],
  "browserInitial": {
    "command": "H2H_CHROMIUM_PATH=/usr/bin/chromium node --test --test-concurrency=1 tests/journeys/move-in-browser.mjs",
    "result": "passed",
    "durationMs": 241859.373826
  },
  "fullLocalSuite": "not run per brief",
  "publicationScan": "Mac lander responsibility; unavailable in this cloud",
  "candidateHead": "43bce0be0601d47bda9a37ea5271ea4241686951",
  "scaleExact": {
    "command": "H2H_CANDIDATE_SHA=<HEAD> node --test --test-concurrency=1 tests/journeys/move-in-large-undo.mjs",
    "result": "passed",
    "durationMs": 68831.91332,
    "receipt": "large-undo-business-equality.json",
    "partialReceipt": "partial-undo-business-equality.json"
  },
  "pushes": [
    {
      "head": "348a001ab3f293eb9a17d19818ccdf5b820d5832",
      "result": "pushed",
      "skipCI": true
    },
    {
      "head": "43bce0be0601d47bda9a37ea5271ea4241686951",
      "result": "pushed",
      "skipCI": false
    }
  ],
  "browserExact": {
    "command": "H2H_CANDIDATE_SHA=<HEAD> H2H_CHROMIUM_PATH=/usr/bin/chromium node --test --test-concurrency=1 tests/journeys/move-in-browser.mjs",
    "result": "passed",
    "head": "43bce0be0601d47bda9a37ea5271ea4241686951",
    "checks": 77,
    "pageErrors": 0,
    "durationMs": 243549.964189
  }
}

Static top-level journey registration calls: 110 before, 111 after (one new scale/recovery flow; existing browser registration extended). This is explicitly the journey-entrypoint count, not a new claim about every repository script under the broader counting policy. No test was deleted, skipped or weakened.

Source lock was regenerated last with the seed's documented lock command, then its check and rer check --profile first-party were required to pass. Typecheck and affected review/custody/erasure/duplicate-delivery journeys were run; no full local suite was run. The first real product save was pushed as 348a001 with [skip ci]; the final candidate has no skip marker. All candidate authors/committers are Run Edit Run fleet <fleet@runeditrun.com>, with no coauthor trailer. No CONTRACT Status/Gap/Evidence, generated view, release/version metadata, release-upgrade baseline, size-check configuration, scanner configuration, migration or visitor-email behavior changed.

Clause status changes: none. MOVE-IN-001 remains the existing done judgment; ZENDESK-IMPORT-001 remains the existing missing judgment. This round supplies additional supporting evidence for the named Zendesk repeat/undo subflow, not a self-gate or a promotion of unrelated offline-import obligations. Full clause-wide qualifications outside the brief are not claimed.

CLAIM MOVE-IN-001 PARTIAL points=none tests=tests/journeys/move-in-large-undo.mjs#a 1,000-customer Zendesk import repeats exactly, undoes responsively across restart and reverses only committed partial work; tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
CLAIM ZENDESK-IMPORT-001 PARTIAL points=none tests=tests/journeys/move-in-large-undo.mjs#a 1,000-customer Zendesk import repeats exactly, undoes responsively across restart and reverses only committed partial work
DEFAULT MOVE-IN-001: Retain strict native-edit/reference conflicts; do not introduce a partial destructive undo policy or change its authority.
GAP ZENDESK-IMPORT-001: The contract's existing broader offline-import qualifications are not promoted by this targeted undo round.

Both brief items are fixed and qualified by the targeted tests. The lander's publication scan and independent required gate remain fleet responsibilities. Product READY/PUSHED custody and the evidence ref are separate signals.
