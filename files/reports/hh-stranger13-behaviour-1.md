# HappyToHelp stranger-13 behaviour candidate
Run Edit Run fleet · 2026-11-17

Repository: just-every/run-happytohelp
Branch: cloud/hh-stranger13-behaviour-1
Baseline emitted application: 94f64dfc35d938bd92b59bac9e938c11be10c27d
Initial pushed save: 69dc2a714a99515527cc30516f75dbffeec00779 [skip ci]
Final head: 2724edff5c7de79ae061a3a07592e1f23c3459ff
Verify: completed/success on the exact final head, run 44034769376 (https://github.com/just-every/run-happytohelp/actions/runs/44034769376); seven REST calls including discovery.

## Result and scope

Four defects were reproduced on the fresh-main emitted application using synthetic native owner/operator accounts and a widget-created Maya request. Three fixes are implemented; item 2 remains unresolved because the required existing customer-friendly reference could not be found. No live installation, provider account, company data or deployment was accessed. No contract status, gap or evidence cells, generated views, release metadata, migration, dependency pin, Base refresh or provider-preflight file was changed. Publication scanning and independent gating remain with the fleet; this VM cannot run the Mac publication scan.

Before/after: 4/4 reported defects reproduced; 0/4 fixed on baseline, 3/4 fixed in this candidate, 1/4 unresolved. Three existing affected journey registrations were extended through their helpers; registrations added 0, deleted 0. Contract registry counts remain 4 done / 71 partial / 16 missing (91 total); no clause status changes are made by the builder. Target statuses remain QUEUE-002 partial, QUEUE-003 done, MACRO-001 partial, STATUS-001 partial.

## Plan

The full pre-implementation plan is PLAN.md. In order: reproduce each public-door failure on main; trace shared placeholder resolvers and the real lifecycle/revision data; fix only the named flows; extend existing changed-flow journeys; run affected journeys, typecheck, rer check and source lock/check; capture and inspect the affected screens at 1440 and 390; push the named branch through the guard; read exact-SHA Verify within the ten-call REST budget; publish this report packet separately. The fleet owns independent acceptance and landing.

## Item 2: customer-friendly support reference — unresolved

Created a shared saved reply in Settings containing the documented {{ticket.id}} placeholder, then inserted it into Maya's widget-ticket composer. Pure text saved replies insert directly; action macros have an additional preview panel. The draft showed the entire internal UUID. The text was edited before sending the synthetic reply.

Before: before-receipt.json item 2; browser/before-macro-1440.png and browser/before-macro-390.png. The first probe expected an action-macro preview for a plain saved reply and stopped before collecting evidence; the corrected probe inspected the inserted draft and completed all four reproductions.

No fix is claimed. PLACEHOLDER-AUDIT.md identifies every native customer-visible ticket-placeholder context: saved replies/action macros and problem recovery share loadMacroContext; request acknowledgments, solved notices and workflow customer notifications share notificationTemplateContext. Both currently set ticket.id to the internal primary key. Imported macro mappings inherit the same contexts. WhatsApp approved numeric parameters do not expand ticket placeholders.

The native schema has no independent ticket number, the inbox Ticket reference filter targets id, and no formatter or another customer-friendly reference was found on the current widget, portal, inbox or contact screens. Imported vendor source references cannot identify a new widget request. Clarification asking which screen shows the intended existing reference is pending. The brief requires reuse and prohibits a migration, so no new identifier was invented. The original UUID expansion remains present in this partial candidate.

GAP MACRO-001: item 2 needs identification of the existing customer-friendly reference, or an explicit decision authorizing a new reference scheme; all shared expansion contexts are mapped in PLACEHOLDER-AUDIT.md.
DEFAULT MACRO-001: retain the existing resolver until that reference is identified; do not substitute a subject or a newly invented/truncated UUID.

## Item 3: Solved remains Solved in contact history

Before: solve Maya's ticket through the inbox, follow her header link to Contacts. The ticket API and inbox said solved; contact history immediately said Closed. See before-receipt.json item 3 and browser/before-history-{1440,390}.png.

Cause: contactConversations selected resolved_at but omitted the lifecycle state; ContactDetails derived Closed from any non-null resolution timestamp. Solving legitimately sets that timestamp, so changing a label alone would still misrepresent the later real close.

Change: carry status_id and status_category from the guarded history query and render the lifecycle category. The actual close automation remains authoritative. The existing status lifecycle journey now reads contact history before and after its configured close boundary, asserting Solved first and Closed only after the automation. The ticket browser journey also follows the real contact header link and asserts Solved for that request.

After proof and receipt: after-receipt.json item 3; browser/after-history-{1440,390}.png. The source changes preserve existing contact/ticket scope, pagination and history order.

## Item 4: successive inline ticket edits

Before: hold one status write while immediately changing Priority in the same Ticket panel. One own edit was admitted and the other got Ticket changed. Reload before applying changes. In this deterministic reproduction Priority won (200), and the held Status write lost (409); it is the same own-edit stale-version defect, with no other writer. See before-receipt.json item 4 and browser/before-inline-{1440,390}.png.

Change: the Ticket record owns a per-ticket promise queue. Status, Priority, Ticket fields and tag mutations wait for their own preceding acknowledgment and use the resulting confirmed ticket version. Tags adopt their confirmed record through that same queue. A failed or unknown write rejects the work already queued behind it; no refused/unknown command is replayed. Navigation refuses queued operations for a different ticket.

After: the changed browser journey holds a committed Status acknowledgment, chooses Priority High and adds a tag before releasing it, then asserts two successful PATCH responses, Pending, High, the new tag and no error. It subsequently holds a versioned write while a second writer saves a different priority through the public API, and asserts the stale write is refused and the second writer's entire ticket is preserved. Server admission/version predicates were not relaxed. See after-receipt.json item 4 and browser/after-inline-{1440,390}.png.

## Item 15: competing replies retain the draft and explain recovery

Before: two separately signed-in operators typed on Maya's request. Both outgoing commands carried the same observed revision; concurrent POSTs returned 200 and 409. The losing Alex draft remained but only Request failed (409) / Not sent: Request failed (409) explained it. See before-receipt.json item 15 and browser/before-conflict-{1440,390}.png.

Change: translate only the explicit conversation_changed_or_admission_denied result into conversation-changed guidance. The losing composer retains its text and attachments, reads the latest conversation, and shows one message: The conversation changed. Your draft is still here. Review the latest reply, then send again. There is no automatic send or retry. Other admission refusals keep their own handling.

After: the existing two-operator browser journey holds both requests at the network edge after both observed the same revision. It asserts one 200 and one 409, the explanation and review guidance, the unchanged losing draft, the winning reply in the losing transcript, exactly one newly published reply, and a successful explicit Send only after the latest reply is available. The customer transcript then contains exactly the two intentional replies. See touched-receipt.json collaborationBrowser and browser/collaboration/conflict-{1440,390}.png. Assertions run at 1440; 390 captures the same recovery screen only.

## Validation and custody

Local setup succeeded with generated owner-only local answers and no remote provider configuration. Initial setup attempts correctly refused missing required answers and an answer file outside the checkout; the contained private answer file succeeded. No private answers or setup/runtime environment dumps are included in this packet.

Typecheck, rer check --profile first-party, and rer build succeeded. Affected statusLifecycleJourney, ticketsBrowser and collaborationBrowser execute sequentially with one browser, using /usr/bin/chromium --no-sandbox. The route journey includes real configured close, reopen/follow-up and permission assertions; the ticket journey includes stale-writer preservation; the collaboration journey includes refusal and explicit recovery. The full local suite and rer verify are not run. Exact branch Verify supplies the full CI wall. See touched-receipt.json and validation-receipt.json for completed results and source identity.

Baseline proof used the clean-main emitted build completed before any product edits. The checkout was committed while the second probe's fixture migrations ran; before-receipt.json records that separate checkout metadata and explicitly names the actual emitted baseline. The original first probe failure did not collect a before result and is not counted as proof. The first collaboration phone capture also caught the side-panel transition; a repeat of the same asserted journey waits only for responsive state and transition completion before recording the final screenshot pair. See collaboration-proof-receipt.json. Before phone screenshots were captured immediately after resizing; the macro and inline captures show the existing panel transition/cropping, while history and conflict are readable. The after proof waits for responsive layout and explicitly opens the relevant panel.

Every product commit uses the fleet identity and active forwarding cleanup hooks. All unpublished candidate authors, committers, full messages and trailers are inspected before each guarded push, including any side parents. Only the named product branch is pushed. Complete report/receipt/screenshot evidence is published on evidence/hh-stranger13-behaviour-1, separately from product readiness. No PR or landing is performed by this builder.

Final CI and publication details are recorded in ci-receipt.json and terminal-receipt.json. The unresolved support-reference decision prevents a complete four-item READY claim, even if exact-head Verify is green. Finished product work and the packet remain preserved for the lane.

## Builder claims

CLAIM MACRO-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#an owner previews a shared macro handoff to a UI-invited agent, edits and sends without taking over, then explicitly takes over
CLAIM STATUS-001 PARTIAL points=3 tests=tests/helpers/inbox/status-lifecycle.mjs#statusLifecycleJourney
CLAIM QUEUE-002 PARTIAL points=none tests=tests/helpers/inbox/tickets-browser.mjs#ticketsBrowser
CLAIM QUEUE-003 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#two signed-in operators see viewing, typing and unsent draft warnings before replying and after reload

The point-none claims name the targeted regression journeys without promoting the whole broader acceptance point. The unresolved reference remains explicitly unproved.

## Final disposition

Exact-SHA Verify is green. Product branch custody is PUSHED at 2724edff5c7de79ae061a3a07592e1f23c3459ff. Overall task disposition is BLOCKED by unresolved item 2: identify the existing customer-friendly support reference required by the brief. The UUID placeholder expansion is unchanged and no four-item completion or product READY claim is made. The three implemented fixes are preserved for the lane and independent gate. No PR was created.
