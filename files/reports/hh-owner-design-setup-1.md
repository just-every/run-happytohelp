# HappyToHelp owner setup design

Run Edit Run fleet · 2026-11-17 · hh-owner-design-setup-1

Repository: just-every/run-happytohelp. Branch: cloud/hh-owner-design-setup-1. Based on main bb70a0424b6f1efef5b10cb14992f1b579f1fc50.

## Implemented decisions

| Decision | Before | After | Screenshots at 1440 and 390 |
| --- | --- | --- | --- |
| D6 | Setup, AI and conversation generation exposed installation-secret names and restart commands. | One shared developer hand-off explains the job and what it unlocks. Technical steps start collapsed; mailto and Copy carry the same complete instructions. Copy refusal opens selectable steps. There is no unsupported key-entry field. | before/after-setup-ai, before/after-ai, before/after-conversation-generate; after-ai-details |
| D7 | Daily reply/cost guards were presented without a direct billing explanation. | AI and the Setup AI/safety rows explain that the AI provider bills the owner’s key and HappyToHelp does not charge for those replies. Daily safety limit uses runtime values and explicitly applies to automatic replies based on recorded use. Incomplete usage and provider-account exclusions remain in Details. | before/after-ai, before/after-setup-ai |
| D8 | Local sending/receiving deployment prose and a disabled Gmail authorization button confronted the owner. | One local-mail banner on authenticated Setup and Email; domain-mail setup uses the shared hand-off. Unconfigured Gmail/Microsoft show provider-specific hand-offs and no Authorize mailbox button. Configured authorization and all existing mail settings retain their native routes. | before/after-email, before/after-gmail |
| D9 | Zendesk OAuth type/scopes/callback instructions and file-record syntax were open. | An account-manager hand-off contains the exact Public/read/hc:read/callback values. The owner supplies the returned connection identifier and existing required account name. File upload has a plain introduction; record syntax is in Details. | before/after-zendesk |
| D10 | Original HappyToHelp requested a package with no route to obtain it. | Export from your old HappyToHelp names the person running that installation, offers a hand-off linked to the actual exporter guide, and tells the owner to obtain and select the complete folder. No export-screen location was invented. | before/after-original-export |
| D12 | 26 destinations were spread across technical groups; hours lived under Project > Availability. | Business hours, Team, Chat widget, Email, Saved replies, AI and Help center lead. Workspace and Setup follow. Advanced is collapsed on everyday pages and opens for its current destination. Dedicated hours and help-center routes reuse native settings and authority. Cutover and Regulated deployment have the requested meanings under their titles. | before/after-workspace, before/after-business-hours, before/after-cutover, before/after-assurance, before/after-team, before/after-chat-widget, before/after-saved-replies; after-help-center, before/after-settings-menu |

Screenshot filenames are in screenshots/, with -1440.png or -390.png suffixes. Before Help center was part of the Workspace General screen, so before-workspace is its prior screen. Contact sheets are an index; originals are the evidence.

## Truthfulness and scope

- AI configuration: src/modules/management/activation/configuration.ts reads provider keys from server environment only; src/ui/native/pages/AssistantReadiness.jsx receives presence/readiness rather than the secret. No browser secret-saving endpoint exists in this flow. The hand-off is the supplied fallback; no migration or secret-storage promise was added.
- AI billing: HANDOVER.md excludes pricing/billing from this edition. CONTRACT AI-001 calls usage diagnostic accounting rather than a payment/debit system. generation-provider.ts dispatches with the installation’s provider key; no HappyToHelp charge is performed. Local configured-provider fixtures exercise the existing provider/accounting path; no live or paid provider was called. Actual provider-account prices, hosting costs and a universal maximum bill remain unclaimed.
- Safety limits: reply-ceiling.ts admits automatic replies against per-workspace and installation counters and a recorded-cost counter. It cannot establish an absolute provider spending cap. Reduced the supplied general “Stops AI replying” sentence to automatic replies based on recorded use. Numbers come from activation facts and ai-spend, not hardcoded UI values. Unknown cost remains unknown in Details.
- Mail: localMailOrigin/email transport and the local journey establish suppression. The banner is used only in authenticated native owner pages, not customer UI. No external mail, DNS, account, credentials or live installation was used. The Gmail and Microsoft hand-offs follow docs/email.md and the existing callbacks. The local routing guide still offers no DNS steps for the reserved trial address. Hosted provider consent and real delivery are not claimed by local fixture proof.
- Zendesk: existing connect code still receives subdomain/clientId and performs its normal scoped OAuth redirect. Public client, read/hc:read and the actual callback are in the shared hand-off. Kept the account name because the existing connector requires it; removed OAuth jargon from the owner’s identifier label. The browser journey checks both connect presses and real application responses with only the Zendesk network boundary replaced.
- Original export: the supplied brief does not contain verified old-service export-screen steps. This edition ships scripts/export-legacy.mjs and docs/LEGACY-EXPORT.md; the latter is GitHub-only in docs/site.json, so the hand-off links to the real repository guide rather than inventing an on-site route. No old-service account was opened. The owner-facing numbered list describes obtaining a folder from the person running that installation, not an unverified export button.
- Settings: new business-hours/help-center-settings paths pass the existing dashboard path policy and reuse ProjectSettings and existing management APIs. Hours saving uses the same availability and workspace settings writes. No timezone default, sign-in, password, Setup counter, widget-confirmation, visitor-email, migration, version, dependency pin or Base source was changed. Workspace wording was normalized on these touched settings surfaces; sibling-owned pages were left intact.
- Shared hand-off instructions are setup instructions and public configuration names only. No entered secret value is collected, echoed, copied or emailed.

## Validation and custody

Actual results, exact product head, CI and screenshots are recorded in RECEIPT.json and the selected check/browser receipts. Full local Verify and the full suite were not run. The first-run and initial owner-setup helpers passed before the final selector corrections and retention of the shared AI-settings navigation link. The complete Move in journey and final browser proof run on the corrected candidate. The final exact-SHA GitHub Verify supplies the full branch wall. The fleet publication scan and landing remain with the Mac lander.

Initial typecheck failed while the dev server was concurrently rewriting generated route types with a Start registration. The unchanged-main archive passed, and the candidate passed after stopping the recorded dev PID and regenerating routes; no authentication code was changed to suppress the error.

Counts: Settings destinations 26 → 28 (two direct native settings doors); everyday visible destination links 26 → 9, with 19 under Advanced. Test registration declarations 122 → 122; registrations added: 0; existing journeys were extended and selectors updated without removing or weakening assertions. Contract clause Status/Gap/Evidence and generated acceptance summary counts: unchanged.

DEFAULT D6: use the existing supported developer hand-off instead of promising browser secret storage.
DEFAULT D10: ask the original installation’s operator for the documented export; do not invent original-service UI steps.
GAP D10: no supplied verified original-service export-screen instructions; the implemented operator/exporter hand-off is the safe documented route.

Product custody and evidence publication are separate. This report is evidence only and does not self-gate, accept or land the candidate.

## Local setup note

The explicit setup command first refused missing private fields, then refused an answers path outside the checkout. No values were logged. The supported foreground rer dev flow generated the private native local-owner setup and reached RER_READY; that local entry supplied the before proof. It was stopped by its recorded PID before the clean-build checks. Browser journeys use synthetic accounts and their ordinary public bootstrap/session doors.

The first full Move in browser attempt passed both Zendesk connection presses, then stopped because its offline-packaging link assertion expected the newly collapsed developer guide to be open. The surviving assertion now opens that disclosure first; no import, undo, authority or data assertion was removed. A second attempt reached the original-service package flow and found its old heading selector. All three old-heading selectors now use the new export title. Both failed attempts are retained separately from the corrected complete run. The shared notice retains its AI settings link for existing simulation/triage/training uses, and the blocked-simulation journey now exercises the same copy/email hand-off instead of expecting an exposed raw secret name.

The 9b3eeab candidate’s browser proof also ran the surviving native Settings journey: owner and admin load/save General, Appearance and top-level Business hours; collaborator, operator and a narrowed custom admin are refused. The conversation’s Generate error hand-off is exercised through its real action route, including mailto/clipboard equality and copy refusal.

The final phone proof revealed that the restored AI-settings link became a sibling flex item in the conversation error frame and squeezed the hand-off. A normal follow-up commit wraps the notice and its link in a full-width container. Published commits were not rewritten. The final screenshot pass and exact-SHA CI refer to this follow-up.

## Terminal candidate

Final product head: 4fd4965485351d1a45dd10f8e1b3ba69ea78afc1. Product branch: cloud/hh-owner-design-setup-1. Final Verify run: 44090438878 (result in RECEIPT.json). Earlier Verify runs 44087264557 and 44088861962 were on preceding heads and are not used to claim readiness. The final phone/desktop proof contains 32 state captures plus the phone Settings menu; the complete screenshot hash inventory is SCREENSHOTS.json.

The additional before-only proof reused a synthetic fixture after a fresh password sign-in. Its first harness attempt read the project from the wrong response shape; the retry reads the public session’s project ID. This needed no product change. The screenshot receipts distinguish that harness failure from the successful before captures. All fixtures remain synthetic.

The final notice also preserves the existing labelled AI provider setup region used by procedure receipts. Its browser proof explicitly finds that accessible region and its AI-settings link, then exercises the shared copy/email actions.

Terminal local checks: rer build, typecheck, source check and first-party rer check passed on 4fd4965485351d1a45dd10f8e1b3ba69ea78afc1. The final browser proof also finds the retained accessible AI-provider setup region and its AI-settings link before checking copy/email and manual fallback.

## Scoped contract claims

These supporting claims cover the design round. They request no clause promotion or demotion; no full contract acceptance point is newly claimed by this UI round.

CLAIM UI-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#a first owner and a signed-in owner reach Setup and install a working widget; tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
CLAIM ACTIVATION-001 PARTIAL points=none tests=tests/journeys/first-run.mjs#a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest
CLAIM AI-001 PARTIAL points=none tests=tests/journeys/first-run.mjs#a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest
CLAIM MAIL-001 PARTIAL points=none tests=tests/journeys/identity-browser.mjs#a first owner and a signed-in owner reach Setup and install a working widget
CLAIM LOCAL-MAIL-001 PARTIAL points=none tests=tests/journeys/first-run.mjs#a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest
CLAIM MOVE-IN-001 PARTIAL points=none tests=tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import

DEFAULT AI-001: Use the supported developer hand-off; do not promise browser secret storage.
DEFAULT MOVE-IN-001: Use the documented operator/exporter hand-off; do not invent an original-service export screen.
