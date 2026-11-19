# HappyToHelp carried follow-ups

Builder report, Run Edit Run fleet, 19 November 2026.

## Plan

1. Recheck the numbered findings against the current main. Follow the explicit implementation list and retain the existing application and infrastructure boundaries.
2. Update the setup and email states, then the widget's installation, audit and visitor paths. Keep the local trial on the existing project-specific customer chat.
3. Handle the accepted-invitation recovery path and distinct reply admission reasons, restore ordinary search for bare hexadecimal text and update the owner-facing text and guides.
4. Extend the existing journeys at their public doors. Regenerate the contract views to check the source, restore them for the lander, regenerate the source lock, and verify the single product commit with browser and API checks.

## Per-item results

| Item | Change and evidence |
| --- | --- |
| A1 | `EmailSettings.jsx` shows the hand-off while sending or receiving needs work. The hosted email journey reads the sending and receiving statuses and checks hand-off visibility. See the email DOM receipt for both widths. |
| A2 | `setup-model.js` and `need-content.jsx` name Chat widget, Settings and Your website address. `AvailabilitySettings.jsx` puts Workflows under Advanced. The first-run and Business hours journeys exercise those pages. |
| A3 | `ProjectsPage.jsx` offers Create workspace and `WorkspacePages.jsx` names the unavailable workspace. The first-run and cross-workspace HubSpot journeys retain their route assertions. |
| A4 and A8 | `developer-handoff.css` styles the live provider hand-off link. The unused `provider-setup-notice.css` is removed. The emitted DeveloperHandoff stylesheet contains the underline rule on the provider hand-off's live link. |
| A5 | `ai-billing.js`, `setup-model.js` and `AiSpendCard.jsx` show server-supplied workspace reply and spend limits, the installation-wide reply limit and the UTC reset. The published API also exposes the installation-wide reply count to workspace members. A verified local correction is saved in FOLLOWUPS-REPAIR.patch. |
| Stranger-15 6 | `activation.ts` returns a local trial link after both setup skips. `SetupList.jsx` offers Try your widget. The widget journey opens real visitor chat and checks that a trial message reaches the workspace's inbox. See the widget DOM receipt for both widths. |
| A15x-1 | `AcceptInvitation.tsx` keeps the submit busy after scheduling navigation. The ordinary invitation browser path still reaches the inbox with the new session. |
| A9 | `widget-address-changes.ts` batches Security log events with primary and additional address writes. `widget-settings.ts` records allowed and removed addresses and `SecurityLog.jsx` names those events. The owner installation journey reads the audit door and verifies the actor, address and single record for each change. |
| A10 | `WidgetAddressNotice.jsx` describes a refused visit and asks owners to allow only sites they run. The owner widget journey cancelled a proposed address, then approved it and sent a real visitor message through the added website. |
| A11 | `activation/facts.ts` reports whether there are other allowed addresses. Both Setup surfaces reflect that list and use the current section name. |
| A12 | `ChatHeader.jsx` uses word initials or the brand image and removes the leading response-time bullet. The widget browser journey inspects the visitor header. |
| A13 | Main had mismatched step heading styles, duplicate address guidance and active hover styling on disabled buttons. The Code tab now shares its step-heading style, uses one address label and visibly dims disabled Copy actions. The widget journey still exercises disabled and enabled Copy. |
| A14 and Stranger-15 10 | `CustomerNameStep.jsx` refreshes the dashboard after save. The browser journey observes the new account name before navigation. |
| A14x-1 | `website-address.ts` rejects new wildcard hosts. The owner widget journey checks rejection on both write routes and removal of an older inert entry. |
| A15 | `accounts.ts` returns accepted with sign-in required if session creation fails after account creation. `AcceptInvitation.tsx` links to password sign-in with the address and inbox destination prefilled. The invitation journey uses an isolated session-write fault, verifies no session cookie and signs in through the recovery link. |
| B17 | `inbox-search.ts` adds native prefixes to ordinary bare-hex search with access in the outer queries. An explicit hash reference retains prefix-only lookup. The existing reference journey checks both inbox doors, matched text and group/project isolation. |
| B18 | `_conversation-composer.scss` attaches the existing 36dvh scroll limit to the Saved reply preview. The browser journey checks that the preview itself has a computed height bound. |
| B19 | `notification-teammate-delivery.ts` formats the visible subject with the existing short ticket reference. The customer-reply threading path keeps its native subject token. |
| B20 | `LinkedIdentities.jsx` uses the same real ticket status label as the primary contact's history. The linked-customer browser journey reads the actual conversation endpoint, and the inbox lifecycle journey verifies Solved and Closed as separate server states. |
| B22 | `admission.ts` distinguishes stale conversation state only when the write's other admission conditions still pass. The operator and widget clients respond to the distinct reasons. The collaboration journey covers a competing reply and a refused attachment with a stale draft. The published write also adds a statement for successful sends. The bulk Problem solve journey caught the resulting statement-budget regression. The verified local repair runs this diagnostic only after a refusal. |
| Stranger-15 2 | `docs/SETUP-WORKFLOW.md` uses the installed rer commands. The private-answer workflow in `docs/INSTALLER.md` already uses these commands on main, and README contributor commands retain pnpm. |
| Stranger-15 3 | `CONTRACT.md` now quotes the shipped PUBLIC-002 heading. The contract generator produced the matching ACCEPTANCE view locally. The generated views follow the landing rule. |
| Stranger-15 11 | `README.md` maps deploy-summary mail input names to the seed's setting names and links the operations guide. |
| Footer Contact | `SiteFooter.tsx` removes the unresolved Contact link. The guide navigation has no separate copy of that link. The public browser journey reads the footer at both widths. |

The assignment enumerates B17–20 and B22 as implementation items. B21's ticket-template link policy was outside that enumeration.

## Counts and landing

The contract holds 4 done, 71 partial and 16 missing clauses, 91 total, before and after. PUBLIC-002 is a wording change using the shipped page heading. Existing test registrations were extended, for a change of zero registrations. The local trial uses the existing project-specific customer chat so a test message shows up through the real inbox. It opens in a separate tab so the owner can return to Setup.

The fleet's Mac publication scan and generated contract-view update apply at landing. The product work is a single candidate commit. The brief records HTTP 401 for PR creation and directs this run to leave product custody on its cloud branch.


## Local verification

The candidate is `6a5968bee3d33e880cce2e39940e16589f5db967` on `cloud/hh-followups-1`, with one parent `e943b764e6f51ef33c218361f063250aaf16d223`. The cloud push guard created the named branch on its first attempt. A subsequent Git ref read advertised the exact candidate.

Typecheck, source-lock verification, the first-party check, the app build and the run-site build passed. All 39 documentation routes in the site manifest had built outputs. A contract regeneration and check passed, and its only view change was the specified heading in ACCEPTANCE.md.

The receipt lists exact commands, exit codes and measured heads. The exact-head API run covered six registrations for first-run setup, identity, business hours, widget origin, inbox collaboration and reference search. The hosted email, owner widget, invitation and public browser journeys passed on the exact candidate. The selected DOM receipts record the required views at 1440 and 390. Ticket search and owner-widget receipts retain the checked outcomes. The exact-head email journey exercised teammate notification delivery, reply threading and provider uncertainty. The exact-head browser checks also exercised saved reply preview and linked identities. The HubSpot denial journey also passed on the exact candidate.

## Verify and unpublished repair

Exact-SHA Verify run 44470806075 completed with failure. The build and seven other test shards passed. The identity-and-desk shard failed the Run shard checks step. The contract-docs archive confirmed the expected generated ACCEPTANCE view difference, and the aggregate job failed.

The failed-job archive command for identity-and-desk completed with exit 0 and returned zero bytes:

```sh
gh run view 44470806075 --repo just-every/run-happytohelp --job 135380205711 --log-failed
```

The local rerun of this shard's identity and inbox files reproduced one failure in the existing Problem recovery journey at `tests/helpers/inbox/problems.mjs:126`. The published implementation solved 22 of the expected 23 incidents. Its added statement on each successful reply reached the test's injected database statement threshold during bulk processing. The other 19 tests in those files passed. Three customer tests passed before the environment restart interrupted the serial shard rerun.

The isolated erasure retry reached its 12-minute bound after the local Worker logged a Durable Object registration warning.

The combined local repair protects installation-wide AI usage counts and keeps the extra admission diagnosis on refused replies. Typecheck, the source-lock check, the unchanged Problem journey, the collaboration journey and first-run setup passed with the repair. The patch applies cleanly to the advertised candidate and carries its corresponding source-lock changes. The branch remains at its single published commit, and publishing the repair requires approval for a second commit.

CI used ten calls at five-minute intervals. The published candidate is blocked on the non-generated Verify failure and the unpublished repair.
