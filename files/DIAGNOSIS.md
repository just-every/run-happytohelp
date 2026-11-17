# Failure classification

Run Edit Run fleet, 2026-11-17 UTC.

Parent: 4fd4965485351d1a45dd10f8e1b3ba69ea78afc1. Original Verify: 44090438878.

## Setup/widget: category (a), deliberate D12 structure change

Original failed job 134091828161. The isolated reproduction failed at tests/helpers/first-run/outcomes.mjs:96 waiting 20 seconds for Server secret, exactly matching the brief. The global Advanced locator clicked the newly available Settings navigation disclosure while WidgetSettingsPage was still loading the widget. WidgetInstallationCode retains its own .widget-code__advanced disclosure, secret control, and verification examples.

The repair waits for and opens the widget-specific summary. It retains the heading wait, enabled Reveal server secret control, language tabs, HMAC verification code assertion, installed snippet, real customer message receipt, conversation ownership, missing-key routing, editable workspace identity, starter assistant/mailbox, and mobile workspace switching assertions.

## Procedures: category (a), deliberate D6 hand-off structure change

Original failed job 134091828525. The isolated reproduction failed deterministically at tests/helpers/ai/procedures-browser.mjs:138, expected 0, actual 1. The failure is the missing-provider receipt’s blanket pre-element prohibition. ProviderSetupNotice now renders the shared DeveloperHandoff, whose collapsed technical instructions intentionally use pre. This is neither a Settings routing failure nor the refund Version 1 timing flake.

The repair continues to prohibit raw evaluator pre blocks outside the developer hand-off, retains all four Not run/no sandbox read assertions and raw-error/uncertain-result exclusions, and exercises the shared hand-off’s collapsed state, mailto body, matching clipboard contents, and denied-clipboard fallback. Saved definitions, unsaved work, immutable source snapshots, new-version evaluation, allowed/denied/timeout/injection cases, provider errors, no-read outcomes, release refusal and denied-role checks remain intact.

Neither failure is category (b) or (c). Both directly follow the parent’s deliberate changes; no main comparison or flaky-job rerun is needed to establish those causes. Application code and decisions remain byte-for-byte identical to the parent.

## Original log retrieval

Each prescribed gh run view command was invoked once for the two failed jobs with --log-failed. Both returned exit 0 and zero output bytes. The single jobs metadata request confirms both failures; original-ci-jobs.json and ci-access.json record the calls. Diagnosis rests on the exact-parent local reproductions, retained as parent-identity.tap and parent-procedures.tap. No blocked log-download retry was attempted.
