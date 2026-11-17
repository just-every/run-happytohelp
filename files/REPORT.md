# HappyToHelp stranger-13 setup and wording
Run Edit Run fleet, 17 November 2026.

Repository: just-every/run-happytohelp. Branch: cloud/hh-stranger13-copy-1.
Starting main: 94f64dfc35d938bd92b59bac9e938c11be10c27d (newer than the brief’s 20b254ff baseline).
Candidate head: 2343b5c3f7853ff06919e26ea121b78882e0342c. Both product commits were pushed through the cloud guard on their first attempts. Final exact-SHA Verify run: 44036500245; last observed in progress with no conclusion; the ten-call GitHub budget is exhausted, so this return is PUSHED, not READY. Initial run 44035512678 failed the source-lock check because the new guide component was still untracked when the lock was first generated. The lock was regenerated after tracking the component, checked on the committed tree and published as an ordinary follow-up commit. No published history was rewritten. No PR was created.

The implementation covers all eight reported items. No CONTRACT.md judgment, Status, Gap or Evidence was edited. No generated acceptance views, migration, release metadata, release-upgrades baseline, pins, scanner, size configuration, Base source or provider-preflight file was changed. No production account, customer data or live provider installation was used.

## Plan and scope

The complete pre-implementation plan is PLAN.md. It keeps the existing native screen types, adds provider instructions beside their fields, exposes actual configuration readiness, replaces default machine identifiers with meaningful names/references, extends only existing journeys for changed dynamic behavior, then runs touched checks, responsive browser proof, source locking, guarded publication and exact-SHA Verify. The fleet owns publication scanning and landing. No PR rule was found in the repository.

## Per-item before and after

| Item | Before (brief and starting-main source) | Change | Candidate screenshot names (1440 and 390) |
| --- | --- | --- | --- |
| 6 | management/away-reply.ts counted local suppressed mail as available; a new visitor with an email received an email promise. AwayNotice did the same. | Only remote mail earns an email promise. Local away notice tells the visitor mail is suppressed and to return to this chat. The visitor-email collection remains intact. The existing installed-widget journey now sends a local visitor message and verifies no provider mail and no local email promise. | browser/local-away-1440.png, browser/local-away-390.png |
| 7 | triage settings returned preferences without readiness, so a no-key install displayed Saved with no configuration notice. | The settings response checks the enabled default visitor assistant, model provider key and workspace AI mode. The page shows unavailable, the specific missing installation key and the existing AI setup instructions/link. Saved preferences remain preferences and do not claim a connected model. The existing triage route journey removes and restores the model key and observes readiness. | browser/triage-no-key-1440.png, browser/triage-no-key-390.png |
| 9 | Procedure Exact version and Version receipt, CSV Import ID, and incident ready/applied receipts showed raw UUIDs. | Procedures show key and Version N; imports show kind, source-row count and a short readable reference; incident receipts show the selected ticket subject, including the bulk door. Raw identifiers are retained only in closed Technical details disclosures. No new read broadens ticket access. | browser/procedure-version-1440.png, browser/procedure-version-390.png; browser/company-import-1440.png, browser/company-import-390.png; browser/incident-ready-1440.png, browser/incident-ready-390.png; browser/incident-applied-1440.png, browser/incident-applied-390.png |
| 10 | Connection health printed bearer.request and authority_or_quota_refused; ticket field role lists printed triage-system. | Accepted/refused API requests are described in plain language with their required resource access. Each refusal links to API token settings and explains checking scopes, expiry, revocation and request limits. Machine event/error codes are under Technical details; system field permissions say Intelligent triage (automatic). The existing connector browser journey performs one allowed conversation read and one denied contact read and follows the repair link. | browser/connection-health-api-settings-1440.png, browser/connection-health-api-settings-390.png; browser/connection-health-delivery-log-1440.png, browser/connection-health-delivery-log-390.png; browser/ticket-field-roles-1440.png, browser/ticket-field-roles-390.png |
| 11 | Penny connection requested an origin and votes:write key without acquisition steps. | Links the official installation and scoped API guides, explains publishing an installation, creating a named scoped/expiring key in Penny Settings, copying it once and retaining the same installation on rotation. Existing handoff permission and review remain required. | browser/penny-guide-1440.png, browser/penny-guide-390.png |
| 12 | Release connection said only to configure a trusted sender and secret separately. | Gives random secret generation, matching sender secret-store setup, payload fields, receiver URL, exact UTF-8 HMAC-SHA256 digest/header format and identical-body retry rules on the form. Links the served guide, now with a runnable Node sender example using the official crypto API. Native release intake still produces drafts requiring operator approval. | browser/release-guide-1440.png, browser/release-guide-390.png |
| 13 | GitHub, Linear, Jira, Slack and Teams requested targets/tokens/signing secrets without provider onboarding. | Each expanded form gives official provider links and steps for IDs, token permissions and API origin. GitHub and Jira register signed issue callbacks after saving. Linear explicitly replaces its temporary local secret with the provider-generated webhook detail secret after endpoint registration. Slack uses an installed bot and channel membership, with no inbound callback here. Teams uses a work/school delegated Graph token, the OAuth client’s own registered redirect URI, team/channel IDs, replacement on expiry and no inbound authority. | browser/engineering-github-1440.png, browser/engineering-github-390.png; browser/engineering-linear-1440.png, browser/engineering-linear-390.png; browser/engineering-jira-1440.png, browser/engineering-jira-390.png; browser/engineering-slack-1440.png, browser/engineering-slack-390.png; browser/engineering-teams-1440.png, browser/engineering-teams-390.png |
| 17 | The local customer form asked the visitor to verify suppressed email, keep the form open, and configure spam protection or sign in. | The form itself explains that local verification mail is suppressed, has no outbox and cannot complete verification/spam protection. It links to working chat. The preview cannot submit; its client script preserves that state and cannot reintroduce verification prompts on account refresh. Hosted forms keep their existing behavior. The existing local portal browser helper checks this preview and link. | browser/local-request-1440.png, browser/local-request-390.png |

Before evidence is the supplied stranger report plus source inspection of starting main, not invented historical screenshots. Candidate captures are the after evidence. Official documentation URLs and observed HTTP statuses are recorded in provider-links.json; all 16 fetched URLs resolved with HTTP 200. Penny’s README and API guide were also read through the repository API, without cloning or writing that repository.

## Validation and receipts

Local checks passed: final Node 22.20.0 typecheck, pinned rer build, rer check --profile first-party, source lock/check and diff check. The triage route journey passed in the initial run; that combined attempt was stopped after an omitted system Chromium path caused the first browser launch failure. The corrected browser-only selection passed all four registered journeys (widget availability, ticket/workflow plus connector operations, saved procedures, feedback/release), with zero failures, cancellations or skips. checks.json and touched-browser-results.txt retain exact command/result custody. Responsive browser proof and final CI observations are recorded separately below. All model/mail/provider interactions in journeys use existing synthetic network-edge fixtures. No real provider setup or hosted/live qualification is claimed.

The first browser attempt omitted the required system Chromium path; it was stopped and the completed browser runs explicitly use /usr/bin/chromium with --no-sandbox. Only this task’s recorded processes are stopped. Local setup needed a private, generated local password and the local widget origin; those answers are excluded from the packet.

## Counts and clause custody

Eight named stranger findings are addressed in implementation, with candidate proof and exact-head CI recorded separately below. Test registrations: zero added, zero removed; existing helpers were extended. No regression assertion was removed or weakened; only the touched journeys were selected locally. Contract progress counts and clause statuses remain unchanged. This copy/setup slice does not establish live provider qualification or promote any clause.

DEFAULT TRIAGE-001: Retain saved triage preferences and show actual unavailability until the configured provider is connected.
DEFAULT FORMS-001: In a local unauthenticated trial the request form remains a preview; chat is the working local support door.
GAP ESCALATION-001: Live provider account setup and hosted callback delivery remain separately unqualified; official setup guides and fixture flows are not live receipts.
GAP FEEDBACK-001: Live Penny/Vector and buyer release-bridge qualification remain pending; no credentials were invented or acquired.

## Responsive proof result

All 34 selected captures exist at 1440 and 390 and were inspected. The no-key triage page has a usable AI setup link; company imports and incident receipts use readable references with closed technical disclosures. API denial cases expose required resource access and a working repair link. Each engineering and feedback setup guide fits the native sidebar and phone layout with ordinary scrolling.

The local request preview remains disabled after its script loads, offers no impossible verification link and has no Turnstile challenge. Its chat link opens the actual widget. A new visitor with an email in configured closed hours receives a chat-only away acknowledgement; HTTP admission is 200, the contact message is durably readable and the owner inbox contains the native ticket. The visitor-email ask is retained.

The proof harness was corrected to use the ticket PATCH schema, reopen Ticket after responsive sidebar mode changes, configure genuinely closed hours through the schedule API and identify the admitted conversation instead of assuming that an inbox preview equals the visitor message (the away reply can be the latest preview). These were harness corrections, with no additional product change. browser/browser-receipt.json and browser-inspection.json contain the final results and screenshot hashes. All models, mail and integration edges remain synthetic; no live provider receipt is claimed.

Before/after counts: reported setup/copy defects 8 → 0 in this local scope; engineering forms with complete on-page setup guidance 0 → 5; new/deleted test registrations 0/0; clause-status changes 0. Existing live-qualification gaps remain.

## Claims for the lane

CLAIM WIDGET-001 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#installed widget availability, provider-edge answers and consent-aware proactive outcomes
CLAIM TRIAGE-001 PARTIAL points=3 tests=tests/journeys/ai.mjs#reviewed intent labels enable routing while unavailable triage preserves the operator queue and ordinary admission rules
CLAIM PROCEDURE-001 PARTIAL points=1 tests=tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release
CLAIM CUSTOMER-001 PARTIAL points=none tests=tests/helpers/customer-outcomes.mjs#customerOutcomes
CLAIM CONVERSATION-003 PARTIAL points=none tests=tests/helpers/inbox/tickets.mjs#ticketsJourney
CLAIM API-001 PARTIAL points=none tests=tests/helpers/api001-outcomes-browser.mjs#api001Browser
CLAIM QUEUE-002 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#a support lead configures ticket fields and a queue, previews and applies bulk changes, then previews, publishes and pauses its versioned workflow
CLAIM FEEDBACK-001 PARTIAL points=none tests=tests/helpers/feedback/browser.mjs#feedbackBrowserJourney
CLAIM ESCALATION-001 PARTIAL points=none tests=tests/helpers/escalations/journeys.mjs#engineeringJourney
CLAIM FORMS-001 PARTIAL points=none tests=tests/helpers/portal-local-browser.mjs#localPortalBrowser

## Final custody

Both product pushes succeeded without retry or force. The branch contains only the requested product/docs/test edits and generated source lock. The final source check passed on the committed tree. Product checkout and index are clean. Final exact-SHA Verify observation is recorded below; evidence transfer custody is returned in the terminal message. No product blocker remains from the local touched checks; live provider qualification and fleet publication scanning remain separate gates.

Final observation 2026-11-17T07:27:17Z: Verify run 44036500245 remained in_progress with conclusion null on 2343b5c3f7853ff06919e26ea121b78882e0342c. Ten GitHub calls were used, including two official Penny documentation reads, CI discovery/status calls and the one initial failed-build log read. The cloud adaptation explicitly permits PUSHED when this budget expires while Verify remains in flight. No green result or READY is claimed. The existing fleet must re-read the exact-SHA workflow before landing.

PUSHED branch=cloud/hh-stranger13-copy-1 head=2343b5c3f7853ff06919e26ea121b78882e0342c
