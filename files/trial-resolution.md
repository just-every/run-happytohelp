# Local trial integration (unpublished)

Parents: 9b238cf006b53e22ca124e013a027dbb4b7a47e7 and df2868c5d292ec7c5567cd4c1c1151ab28ae65b8. `git merge --no-commit --no-ff` conflicts in seven files (see trial-merge-status.txt and trial-conflicts.diff). This is a review experiment, not a product commit or final landing candidate.

Resolve CONTRACT.md first with origin/main whole; use main's generated views whole. Resolve policy.ts, projects.ts and reply-mode-change.ts with the candidate's complete snapshot CAS/retry implementation, preserving mode clock, cancel and audit statements guarded in the same atomic batch. That CAS is the replacement for main's snapshot writer and its separate replyModeWrite path: keeping both replyModeWrite and the old-snapshot guard would invalidate the guard midway through the transaction. Retain main's settings-write.ts for any other callers; no caller still uses it after the three reviewed settings routes adopt CAS.

Resolve widget-settings.ts with candidate's CAS write/guard and main's shared proactiveHelpOn predicate. Keep main's entire rer-mail-hold.ts (new event parameter and its updated caller preserve actor/reason) and AiReplyMode.jsx (newer pending/error control). All other main changes and assertions are preserved, including K18b local-computer draft/hold admission, visitor-human path, and the expanded AI-mode tests. Regenerate views and lock without committing views.

The actual resolution patch against the candidate is captured as trial-integration.patch. The lander must perform and verify its own final integration. No gate result on this scratch tree establishes exact-SHA CI for a future merge.

The textual auto-merge of tests/helpers/ai/configured-execution.mjs also creates a duplicate `const base` in replyModes. Remove only the later redeclaration; use the existing same-value base constant. Preserve every assertion from both parents. First attempted scratch touched run failed to parse for this reason; the corrected trial run is reported separately.

Main intentionally changes the withheld-email audit action/outcome/detail to `email.ai_withheld`, `refused`, `{reason:'ai_reply_mode'}`. The candidate helper originally filters only the old `managed_mail.send_rejected` action and fails with zero events on the trial tree. Update only that action filter and its expected outcome/reason to main's semantics. Retain the same one-event, actor/source, no-secret/recipient/content and idempotent replay assertions. Do not emit a duplicate event to satisfy an obsolete action name.
