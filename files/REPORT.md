# HappyToHelp email setup guidance

Repository: just-every/run-happytohelp
Branch: cloud/main-happytohelp-email-setup-guide-1

## Plan

1. Read launcher and seed rules, source mail configuration, docs registry and existing tests.
2. Reproduce the missing provider instructions and local DNS guidance through the public local owner entry on current main; retain sanitized browser observations and screenshots outside the product tree.
3. Add prerequisite links to the three mailbox choices. Expand on-site provider setup documentation with Google and Microsoft app registration, exact callbacks, permissions, installation input names and IMAP/SMTP allowlisting.
4. Make local receiving instructions explain suppression and link hosted setup, without rendering DNS steps for the trial address.
5. Extend the existing first-owner browser test at 1440; capture changed screens at 1440 and 390. Run touched checks, docs link validation and typecheck. Preserve test cap and contract judgments.
6. Fetch current main before the candidate, rebase only unpublished work or merge after a published save, regenerate source lock last, inspect all commit identities and trailers, and use the product push guard.
7. Observe exact-SHA Verify via REST within the ten-call budget and 300-second polling interval. Publish the full non-secret packet through the separate evidence ref and return custody and POST lines.

## Scope

Stranger items 4 and 6 only. No provider execution, mail transport changes, contract status edits or DONE claims. Provider accounts and real delivery remain outside this run.

## Reproduction

Both findings reproduced on main acdcff44b1dae61a4c5559807c33430fd0891dbd through `rer dev`, the private local-owner entry, Setup and Settings → Email. The provider choices had no help links. Expanding How to receive email offered both Cloudflare Email Routing and a SendGrid MX record for localhost.test. See before.json and the four before screenshots.

## Product changes

- Each Gmail and Microsoft mailbox choice explains OAuth app registration and credential installation, with a link to its on-site provider section. IMAP and SMTP explains that the owner must allow both servers and TLS ports, with a direct setup link.
- The existing Support email page, already published in docs/site.json, now walks the owner through Google Cloud and Entra app registration, callbacks, requested scopes, consent, private deployment inputs and IMAP/SMTP allowlists. The integration receiving guide links to those prerequisites.
- Local How to receive email explains that a local trial cannot send or receive email, offers chat for local use and links hosted prerequisites. It renders no DNS or routing steps and suppresses the unrelated customer reply-address note locally.
- The existing first-owner browser journey invokes a focused local email setup regression at 1440. Existing assertions remain intact. No provider transports or contract judgments change.

## Counts and claims

- Stranger findings in scope: 2 before, 0 remaining after the requested guidance changes.
- Mailbox prerequisite links: 0 → 3; local DNS instructions naming the reserved trial domain: 2 → 0.
- Explicit test registrations: 108 → 108. The existing first-owner journey is extended; no registration is added. No test is removed, skipped or weakened. Historical leaf-count debt is not re-audited by this run.
- Published docs pages: 39 → 39; the existing Support email page is expanded.
- Contract full-target summary: 4 done / 71 partial / 16 missing / 91 total → unchanged. MAIL-001 remains partial. This guidance slice does not prove MAIL-001's complete provider-flow acceptance point.

CLAIM MAIL-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#a first owner and a signed-in owner reach Setup and install a working widget
GAP MAIL-001: Live provider accounts, consent execution, hosted delivery and complete provider reconnect/cutover qualification remain outside this run.

## Verification boundaries

The build, typecheck and buildSite docs validator passed; all 39 pages have zero internal link/anchor problems. Source lock regeneration/check and first-party checks are run after tracked changes. Browser proof covers local Email, Gmail, Microsoft and IMAP choices plus their linked guide sections once each at 1440 and 390. The emitted Worker proof uses native first-owner setup and actual application pages with local mail suppression; no provider account or delivery result is claimed.

An extra email-suite invocation during implementation failed in the existing local-dev harness cleanup with `Journey server PID has no owned control socket`. It is retained as a failed supplementary check, not counted as passing candidate evidence. The intermediate regression fixture also first lacked EMAIL_FROM and failed its suppression precondition; the fixture now supplies the local sender. Final touched-test results and exact-SHA CI custody are recorded in RECEIPT.json and CI.jsonl.

## Candidate custody

Product candidate: 9901e11ad3145638b8f7fbe5c0a53d76b1ec042f. One real commit, no skip-CI marker, fleet author and committer, no trailers. The named branch is the only product push target. No PR is required by this repository’s shipped landing rules. The full first-owner journey and its new local email guidance assertions passed together (1 test, no skips), as did the focused regression and all 14 final browser captures. Product files are byte-identical to the recorded candidate blobs in RECEIPT.json. Full publication scanning and landing belong to the fleet Mac. Exact-SHA Verify is pending.

## Browser evidence index

The settings captures contain synthetic local trial data only. Guide captures are the built on-site documentation reached from each provider choice. Browser scroll-position capture artifacts in fixed navigation do not change the recorded page content or the no-overflow checks.

| Changed screen or guide | 1440 | 390 |
| --- | --- | --- |
| Local receiving guidance | [Desktop](after-local-1440.png) | [Phone](after-local-390.png) |
| Gmail mailbox choice | [Desktop](after-gmail-1440.png) | [Phone](after-gmail-390.png) |
| Microsoft mailbox choice | [Desktop](after-microsoft-1440.png) | [Phone](after-microsoft-390.png) |
| IMAP and SMTP mailbox choice | [Desktop](after-imap-1440.png) | [Phone](after-imap-390.png) |
| Google owner setup guide | [Desktop](after-guide-gmail-1440.png) | [Phone](after-guide-gmail-390.png) |
| Microsoft owner setup guide | [Desktop](after-guide-microsoft-1440.png) | [Phone](after-guide-microsoft-390.png) |
| IMAP and SMTP owner setup guide | [Desktop](after-guide-imap-1440.png) | [Phone](after-guide-imap-390.png) |

Baseline: [local DNS instructions](before-local-1440.png), [Gmail](before-gmail-1440.png), [Microsoft](before-microsoft-1440.png), [IMAP and SMTP](before-imap-1440.png). Structured observations: [before.json](before.json) and [browser.json](browser.json). Final check receipt: [RECEIPT.json](RECEIPT.json). Full touched journey output: [first-owner-test.log](first-owner-test.log). Supplementary failed email harness output: [supplementary-email-test.log](supplementary-email-test.log).
