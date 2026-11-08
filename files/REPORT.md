# hh-ai-mode-followups-1

Repository: just-every/run-happytohelp
Product branch: cloud/hh-ai-mode-followups-1
Starting main: e8703857 (K18); refreshed before editing. No newer changes to the three settings writers were present.

## Plan

1. Inspect main, repository landing instructions and K18's existing AI-mode journey; retain newer source and tests.
2. Replace the three read/modify/write settings paths with a shared conditional snapshot write. Guard companion audit, cancellation and project-row changes in the same transaction; on conflict reread and retry from current values. Preserve response shapes, JSON booleans/nulls and the mode-change clock. No migration.
3. Restore the stored dashboard AI mode on save failure, retaining the error line, and prevent overlapping saves.
4. Gate the public widget proactive-help flag using the existing AI-generation mode helper.
5. End managed-mail holds with guarded, transactional send-rejected audit events, the system actor and a non-secret reason. Replays write no duplicate event.
6. Extend the existing K18 route journey and existing browser registration without adding test registrations. Assert real concurrent public PUTs; real authorization failure in the emitted dashboard; public draft/off proactive silence against auto delivery; a real AI-generated notification held at the mail-provider edge and ended through the normal mode/scheduler path, with audit readback.
7. Run touched checks and typecheck, build, capture the changed browser screen at 1440 and 390, regenerate/check source lock last and run first-party check. Refresh main and rebase unpublished work before publication. Audit all candidate identities and trailers, push only the named cloud branch, watch exact-SHA Verify via REST, publish this explicit report packet separately.

## Scope and claims

The four follow-ups repair existing K18 behavior. No acceptance point, clause Status/Gap/Evidence, generated acceptance view, homepage, migration, unrelated AI selection logic, or excluded customer-data work is changed. CLAIM points=none. Clause statuses and acceptance counts remain unchanged. Independent gates and landing are lane actions.

## Validation

Final receipts and product provenance are recorded in RECEIPT.json and the explicitly selected logs. Browser assertions use 1440; screenshots show the failure screen once at 1440 and 390. No full local suite or pin tests.

Setup initially required private answers and then required the answers path to be inside the checkout. A generated local owner password was placed only in ignored local setup state; the contained-path setup succeeded. Early ad hoc route probes inherited --input-type=module into Miniflare's synchronous worker and hung; correcting the runner to ordinary node -e resolved it. These were local execution issues, not product changes.

## Results

- All three settings writers now use a shared compare-and-swap transaction with at most five fresh-snapshot attempts. Failed attempts do not cancel work, change project fields or write audit events. Sustained contention returns a clean 409 rather than overwriting a winner.
- The AI-mode control restores its stored prop after a failed save, keeps the error line and disables the control while saving.
- Public widget settings offer proactive help only when the existing mode helper allows customer replies (auto), with both existing opt-ins still required.
- Ending a managed-mail hold writes managed_mail.send_rejected, outcome failed, actor system, source system, delivery target and reason. The audit and terminal write share a guarded transaction; replay does not duplicate the event.
- No migration, acceptance, clause status, Gap, Evidence, homepage or generated-view changes.
- Concurrent public PUTs pass for general settings, widget settings, availability and AI defaults, plus two general fields. JSON object, null and boolean values survive. The test requires exactly eight mode audit events for the four off/auto pairs, preserving exact once-only audit assertions.
- Public draft/off widget settings disable proactive help; visitor activity creates no proactive model request, offer or AI message. Auto still produces a real attributable offer and admits the chosen AI/visitor message pair.
- A configured provider fixture generates a real AI message whose managed-mail notification is held by a real 401 credential-refusal edge. Switching to draft and running the scheduler ends the hold; the public audit read door exposes one system event with its reason and no key, recipient address or message content. Repeating the scheduler exposes the same one event. The test settles intake before assistant assignment so an unrelated concurrent intake-context update does not supersede its generation.
- The emitted browser saves draft, reloads it, then switches to another real signed-in account and attempts off on the loaded workspace. The actual API refuses 403; the select shows draft and its existing error line. The original owner's API read confirms draft remains stored. Screenshots were visually inspected at 1440 and 390.
- Extended AI route registration passes (1 selected test, 0 failures, 102.45 seconds). The final exact-audit concurrency helper also passes after strengthening its count assertion. The touched browser helper and its encompassing existing governed-advice browser registration pass (1 selected test, 0 failures, 194.45 seconds).
- Typecheck, rer build, source lock/check, first-party check and contract-document check pass. No full local suite or pin tests were run.
- Acceptance/clause source counts before and after: done 4, partial 71, missing 16, total 91. Direct journey registrations before and after: 94 -> 94 (net new 0).

No missing ruling or account. No new DONE or acceptance claim. The fleet's publication scan and guarded landing remain independent lane actions.

## Product publication

Product head: ccb7197677aeeeb7fe37b9dbab06c936b56e8008

Refreshed main immediately before publication and ran the requested unpublished rebase: already current at e8703857. The sole product commit passed the complete identity and trailer check, then the named cloud branch push succeeded on attempt 1. No PR was required or created. No main/default branch was pushed or advanced. Exact-SHA Verify completed with failure; the final receipt records the exact run, failed job and diagnosis.

## Exact-SHA Verify failure

Run 42467504208 completed with failure on product SHA ccb7197677aeeeb7fe37b9dbab06c936b56e8008. Plan and build passed. Seven full-suite shards passed: identity-and-desk; public-and-import-browser; assistant-and-knowledge; identity-and-repair-browser; support-workflow-browser; import-and-reports; connections-and-computers. Thus the extended AI and workflow browser journeys also passed remotely.

The sole failing assertion shard was `Verify / support-and-recovery`, job 128690790101, step Run shard checks. Its first inbox-browser registration timed out for 20 seconds waiting for the New ticket dialog's Request form control. The stack points to `tests/helpers/inbox/new-ticket-configuration.mjs:80`. The other inbox browser tests and restore test in that shard passed. The aggregate verify job failed as a consequence, and full-push-proof was skipped. This is not the permitted generated-contract-view exception.

Failure retrieval was exactly one `gh run view 42467504208 --repo just-every/run-happytohelp --job 128690790101 --log-failed` call. It exited 0 with empty stdout. Its downloaded archive already existed in the local gh cache; reading the failed Run shard checks member locally recovered the actual log without another GitHub request or a direct job-log blob redirect. `CI-FAILED-SHARD.log` retains the complete relevant test output, omitting the runner's environment preamble.

The New ticket test, its brand-ordering helper, `CreateEmailTicket.jsx`, `NewTicketConfiguration.jsx` and `useNewTicketChoices.js` are unchanged by this candidate. The isolated failing helper uses GET/POST setup commands and makes no PUT calls to the three modified settings writers. A detached, fresh emitted build of origin/main e8703857 passed the targeted New ticket helper. The CI timeout did not reproduce on main; this is not proof of a deterministic baseline bug. The same unchanged helper also passed against the candidate. The CI timeout did not reproduce locally on either source. No source edits, CI dispatch, rerun, no-op commit or unrelated fix were made.

The four-item brief explicitly excludes other work. A red required exact-SHA check prevents READY; product custody remains pushed and the evidence packet reports that limitation. Independent lane gates and publication scan remain separate.

## Final disposition

BLOCKED on the required exact-SHA Verify result, not on product push or evidence custody. The unchanged New ticket helper passed both targeted diagnostic reproductions (fresh emitted origin/main build and candidate). There is no proven deterministic baseline bug and no scoped source fix identified for the CI-only timeout. The brief forbids a workflow rerun, dispatch or no-op commit and restricts this task to the four AI-mode follow-ups, so no such action or unrelated source/test edit was made. The lane needs to resolve the required New ticket CI failure before READY/landing.

The four requested fixes are implemented, pushed and pass their local public-door/browser checks and their full remote assistant-and-knowledge/support-workflow-browser shards. The source lock includes every new helper and passes its check. Counts remain 4 done / 71 partial / 16 missing / 91 total, with 94 direct journey registrations before and after. No clause Status/Gap/Evidence or acceptance changes; no migration; PR none. CLAIM points=none.

Actual reports, receipts, non-secret logs and the two changed-screen screenshots are selected explicitly for evidence-only publication. The archive itself, local installation state, environment dumps, credentials and unrelated browser screenshots are not selected. Product HEAD remains ccb7197677aeeeb7fe37b9dbab06c936b56e8008 on cloud/hh-ai-mode-followups-1. Seven GitHub calls were used; no CI rerun or dispatch occurred. All browsers and test servers were closed.
