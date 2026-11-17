2026-11-17 — Run Edit Run fleet

Navigation/readiness audit of adjacent Verify browser journeys:

- tests/helpers/ai/training-browser.mjs: initial read, explicit recovery, refresh, stale navigation and stale detail selection already hold actual responses and assert their loading/selection states. It uses rendering turns for negative assertions. No equivalent unsequenced procedures-list read was demonstrated; unchanged.
- tests/helpers/ai/advice-procedures-browser.mjs: opening settings expands the section, clicks Load procedures and waits for the data-dependent Procedure key field. Saves wait for their immutable-version notice; evaluation creation captures the POST response. No demonstrated race; unchanged.
- tests/helpers/ai/triage-browser.mjs: the heading after Triage is followed by the Enable triage field before settings actions. Ticket checks wait for actual prediction rows and correction receipt text. No demonstrated race; unchanged.
- tests/helpers/ai/reply-mode-browser.mjs: waits for the loaded selector and its enabled state, then checks the persisted choice after reload. No demonstrated race; unchanged.
- tests/helpers/inbox/tickets-browser.mjs: heading waits precede controls that Playwright locates, and actions wait for Saved, preview output, published/paused version rows. No demonstrated equivalent list overwrite; unchanged.
- tests/helpers/hubspot/browser.mjs: some navigation helpers wait for a customer heading or status button. Subsequent connected-state checks wait for the actual Fresh/Unmapped/Unavailable context. It already holds a genuine context response across customer navigation and proves the prior customer's values stay absent. The never-connected negative panel count after a heading is an audit candidate, but no failure was demonstrated; unchanged.

No other journey was rewritten. This is a targeted source audit, not a claim of a fresh load test or full-suite pass for these adjacent journeys.
