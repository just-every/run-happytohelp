# HappyToHelp stranger-13 behaviour carry

- Tag and product branch: `hh-stranger13-behaviour-1-c4`, `cloud/hh-stranger13-behaviour-1-c4`.
- Repository: `just-every/run-happytohelp`.
- Published head: `68d354d3af7b8de3ff846a07bc004983633d762d`.
- Only parent and remote main observed at publication: `bec54d7793e87fb337c2fae45b68a07ae751f8fd`.
- Source: `b3660b6ee2772d005185bc0343f14cb9d7fd0d51` over `55e2f106c506e4f671d2e474c737124e760e2233`.
- Product push succeeded on the first guard attempt. No pull request was created.

## Plan and carry

The full plan is in [PLAN.md](PLAN.md). I configured the launcher and fleet identity, used a blobless depth-200 clone, and replayed the gated source with a no-commit cherry-pick onto current main. The branch contains one commit with one parent, confirmed by the [linear history](linear-history.txt). Every candidate identity and its full message passed the fleet audit. The published commit has no trailers. The first commit invocation stopped at a local hook quoting error. I repaired the hook, tested trailer removal and hook forwarding, and then created the single commit. The [remote ref receipt](remote-refs.txt) confirms custody of its full SHA.

The carry preserves four gated behaviours. The ticket placeholder renders an eight-character support reference, and Inbox search resolves scoped references. Contact history distinguishes Solved from Closed through the configured 97-hour close. Consecutive row-level Status, Priority and tag changes use the confirmed version, while an intervening writer still triggers a stale-write refusal. One competing reply is admitted and the other operator sees the conflict, retains the draft and can resend after reviewing the latest reply. The C1 bare-eight-hex search follow-up stays outside this carry.

## Patch comparison

The source and published patches each cover 30 files with 284 insertions and 65 deletions. The [per-file comparison](patch-comparison.json) records full-index binary diff SHA-256 digests. Twenty-three patches match byte for byte. The two auto-merged files preserve every added and deleted line. Raw patch headers or surrounding context differ as described below. Twenty-five paths carry the same patch outside the four UI or test conflicts and regenerated lock.

| Path | Reason for raw difference |
| --- | --- |
| `src/ui/dashboard/components/ConversationHeader.jsx` | Text conflict. Preserved main's local-mail notice and rating action while carrying the short reference in the page title. |
| `src/ui/dashboard/components/ticket-panel/TicketSummary.jsx` | Text conflict. Preserved main's status labels and carried the Ticket # heading and queued tag mutations. |
| `src/ui/native/pages/macros/MacrosPage.jsx` | Text conflict. Kept the current Saved replies form, name insertion, and More options. Carried the reference and link instructions into Placeholders. |
| `tests/helpers/inbox/ticket-reference-browser.mjs` | Semantic conflict with main's renamed preview. The existing assertions now find the exact Saved reply preview region. |
| `tests/helpers/inbox/ticket-status-edits.mjs` | Auto-merge. Main's status and rating labels change patch context and object IDs. The added and deleted lines match. |
| `tests/journeys/inbox-browser.mjs` | Auto-merge. Main's owner-installation fixture changes patch context and object IDs. The added and deleted lines match. |
| `sources.lock.json` | Text conflict. Generated from the resolved tree using the documented source lock command as the last tracked edit. |

## Clauses

CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md match main byte for byte. There are no Status, Gap or Evidence edits. The generator and both contract checks passed. Counts before and after are the same:

| Tier | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Core | 4 | 71 | 11 | 86 |
| Agent surface | 0 | 0 | 5 | 5 |
| Later | 0 | 0 | 0 | 0 |
| Full target | 4 | 71 | 16 | 91 |

The field-proof register remains 0 passed, 0 failed and 21 not run. QUEUE-003 retains its done judgment. DESK-001, QUEUE-002, MACRO-001, STATUS-001 and NOTIFY-001 retain their partial judgments. The carry adds no migration, dependency, Base refresh, pin change or product proof directory. The fleet retains ownership of the independent gate and landing.

## Local verification on the published SHA

The source lock check, typecheck and first-party rer check passed under Node 22.20.0 with pnpm 10.12.4. The application build passed under the VM's Node 24.19.0. The committed tree matches the locally built and checked tree. [Command receipts](RECEIPT.json)

| Existing journey or proof | Result |
| --- | --- |
| `macroHandoffBrowser` | Pass. A real operator previews, edits and sends a saved reply and retains the explicit handoff until choosing to take over. |
| `statusLifecycleJourney` | Pass. Contact history stays Solved through the pre-close check and becomes Closed at the configured close. |
| `ticketsBrowser` | Pass. Repeated row-level Status, Priority and tag saves work. The test preserves a genuinely intervening writer's record and rejects the stale edit. |
| `collaborationBrowser` | Pass. One competing send wins, one receives 409, and the losing operator retains the draft, sees the new reply and explicitly sends after review. |
| Ticket-reference route and browser | Both pass. Scoped search reads only permitted references and the saved reply preview produces the short reference and working full link. The ticket heading and page title match. |
| Competing-reply route and inline-edit/contact-history browser proof | Both pass. |
| Trigger, workflow and manual notification journeys | Three passes. The tests verify short reference rendering in subject and body, scoped recipients and preserved provider outcomes. |

The eight touched tests and three supplemental notice tests passed on the advertised SHA. The assertions ran on 1440-pixel Chromium where applicable. Screens captured at 1440 and 390 show the [reference preview](browser/ticket-reference-after/390-preview.png), [ticket reference](browser/ticket-reference-after/390-ticket.png), [Solved history](browser/status-history-after/390-solved-history.png), [row edits](browser/status-history-after/390-ticket-edits.png) and [competing-reply recovery](browser/collaboration/conflict-390.png). The browser capture masks synthetic email addresses. I repeated the status proof capture after finding an email field value in the first screenshots. The repeated assertion passed. [Exact journey output](exact-journeys.txt) [Notice output](exact-notices.txt) [Recapture output](proof-recapture.txt)

In the earlier broader Node 24 checks, the workflow aggregate failed after the ticket browser helper completed. Its notice reconciliation test observed 24 delivery attempts where it expected 21. The broader route run recorded 12 passes, including the request-form journey, and one failure. The local mail dev fixture stopped before completing the email journey with “Journey server PID has no owned control socket.” The focused Node 22 notice checks, including the workflow notice reconciliation assertion, passed on the exact published SHA. The [broader workflow log](local-broader-workflow.txt) and [broader route log](local-broader-routes.txt) retain those initial observations.

## Exact-head Verify

Verify run [44285462387](https://github.com/just-every/run-happytohelp/actions/runs/44285462387) returned completed/success for `68d354d3af7b8de3ff846a07bc004983633d762d` at 2026-11-18T10:54:59Z. This was attempt 1. Discovery and the five status reads used six GitHub calls. The exact-head result is in [VERIFY.json](VERIFY.json), and [RECEIPT.json](RECEIPT.json) records the responses and timestamps. The product is ready for the fleet's independent gate and landing.

## Source report claims

The following lines are copied verbatim from the c2-c1 source report. They describe that earlier candidate.

CLAIM carry: exact b3660b6ee2772d005185bc0343f14cb9d7fd0d51 published unchanged under cloud/hh-stranger13-behaviour-1-c2-c1; one commit, one parent.

CLAIM patch-equivalence: 29/29 non-lock patches byte exact against the original c2 candidate; sources.lock.json is the sole permitted exception.

CLAIM validation: local lock check, typecheck and rer check passed; exact-head same-repository Verify 44156311769 completed/success.

CLAIM clauses: no Status/Gap/Evidence changes; full-target counts remain 4 done, 71 partial, 16 missing.

CLAIM limits: no new gate, publication scan, landing or live-provider proof; C1 follow-up was not added.
