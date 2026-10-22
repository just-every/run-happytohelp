# Original UI restoration and known differences

## Approved public homepage

The public / page is the owner-approved homepage. It is an authored product surface, not a claim of parity with the original Laravel application. The 2026-10-02 clarity pass preserves the 2026-10-01 approval while making the solved-support story immediate; on 2026-10-20 the owner moved help before they ask into the lead.

The hero leads with “Knows what your customer needs before they do.” beside one drawing of both moments on a pale aqua blob: 1, the widget offering a hand on a checkout page; 2, Maya unable to turn on the Spanish version of her store, a connected Codex or Claude that has fixed it, and the reply to Maya with Send inside it as the remaining action. Its subhead is “Some customers who get stuck never write in. They just leave.”, and the captions “Before they ask” and “When they ask” sit under the drawing. The five sections appear in order: hero; “Not just better. Free.”; “The rest of your support desk”; “Try it beside what you have”; and “Ready when you are.”

The page uses warm paper and monochrome chrome, with colour inside labelled HTML/SVG drawings and in aqua accents (number discs, link underlines, a hero flourish that draws itself in, two dividers and a closing line, and the sparks of the header and footer lockup), and self-hosted Outfit. Below the hero each drawing floats on a pale aqua blob, a window frame stays only for the code editor, the checkout and the import, the desk cards are frameless ink cards, and each moment plays once as it scrolls into view; reduced motion shows every final drawing at once. It has no price, hosting, provider or Run Edit Run copy and makes no claims for unsupported imports or automations. The detailed approved wording and behavior are in [CONTRACT.md](../CONTRACT.md). Copy/design approval is separate from exact-revision browser acceptance, fresh captures and accessibility acceptance.

The documentation at `/docs` is an authored surface in the same homepage language (its header, footer, paper, ink and Outfit), rendered from the repository's Markdown listed in `docs/site.json`. It is not a parity claim: the original application had no such pages.

On 15 September 2026 the native dashboard was compared screen by screen with a
running instance of the original Laravel application, using separate disposable
local databases, and the original HappyToHelp presentation was restored. This
page records what was restored and which original features are still missing.

## Restored surfaces

| Surface | Changes |
| --- | --- |
| Workspace and inbox | Original workspace switcher, icons, active states, unread count, account menu and mobile header, with the colour reduced to paper, ink and aqua. The native sidebar holds only the daily work: Inbox with its views, Knowledge, Contacts and Reports (with Insights); everything that configures the workspace, Setup, AI and Local computers included, is under Settings, whose pages turn the sidebar into the Settings menu. |
| Project | General, Appearance, Availability and GitHub tabs; original columns, timezone selector, brand controls, persisted color/mode and real schedule settings. |
| Account and access | Profile tabs and avatar layout; tokenless setup retained for loopback development only. The public identity pages no longer follow the original centered frame: see [Public identity pages](#public-identity-pages). |
| Projects and owner controls | Project table and header action; owner settings and project controls retained. Earlier billing/payment layout observations are historical comparison evidence only. |
| AI and management | Dedicated assistant/default-responder controls, saved reply and plugin forms, agent list and pending invitations (with Copy link, Resend and Revoke for owners and admins, see below), contact details. |
| Knowledge | Dataset forms and source tabs, article editor/import selection, category tree, original help-center empty state, real editing/deletion and evaluation access. |
| Insights and administration | Original list/empty-state presentation, dedicated admin navigation, resource-specific columns and labelled record details. |
| Widget | Existing original React controls retained and checked across Code, Theme, Settings and Texts. Theme, Texts and Settings open on the widget's effective defaults (saved overrides laid over `src/modules/widget/js/context/defaults.js`), default copy doubles as placeholder text, and Save writes only edited fields. Widget > Code shows the project's server secret (`H2H_SECRET`, generated at project creation and backfilled by migration `0106`) to owners and admins with working Reveal and Copy; other roles see a note. `pnpm run test:widget-settings-browser` checks this. |
| Local computers and delegation | Not a restoration of a legacy screen: native surfaces use the workspace design system. The Connect computer dialog is styled on Local computers as well as in the inbox; authorizing a computer reports its outcome and clears the code; Connected applications (`/delegation/settings`) and the connection consent screen (`/delegation/authorize`) render in the workspace shell with friendly pages for missing, invalid, unavailable and signed-out requests. See `docs/NAVIGATION.md`. |
| Not-found pages | Added after the 15 September comparison (1 October 2026). The original Laravel application was not re-run for this row, so it is not a parity claim. Unknown application paths show a branded 404 in the homepage visual language (title, message, links to the homepage and workspace); Help Center 404s (unknown project, missing article, unpublished draft) show inside the Help Center header with HTTP 404. Both return HTTP 404. |

## Workspace scoping and shell corrections (1 October 2026)

An independent UI sweep of the review build found workspace-scoping and shell
defects; each is fixed and covered by `tests/journeys/inbox-browser.mjs`.

| Surface | Behaviour now |
| --- | --- |
| Opening a project (deep link, Projects list, switcher) | The URL's project becomes the session's active project before its pages load, so Help Center, Categories, AI Training, Training runs, Insights and conversation attachments no longer show "Project access denied" or broken images under a switcher that names that project. |
| Unknown or non-member project URL | An in-shell "Project not found" state with a link to Projects. It never offers "Sign in" to a signed-in user; the route error boundary offers "Sign in" only for an expired session. |
| Global Inbox Settings | Lists "Settings for <project>" for each of the account's projects instead of unlabelled links that acted on the session's project. |
| `/local-agent/authorize` | Scoped to the session's active project: the project's Settings menu with Local computers current, and the form names the project it acts on. |
| Admin | The account menu offers Admin only to platform administrators; `/admin` pages show an access-limited state with no tables, forms or admin API calls for everyone else. |
| Account menu | Rows use the body text colour (AA contrast) in light and dark workspaces. |
| Sidebar | The active item is scrolled fully into view in the sidebar's own scroll area (900 px and shorter viewports); `/projects/<id>/settings` marks Project current in the Settings menu like `/edit`. |
| Projects list | The setup owner's role reads Owner; the Name header no longer shows a sort chevron it does not honour; row-action targets are at least 32 px square. |
| `/users/<id>` | Only `profile` and the signed-in user's own id open the profile; any other id is not found. |
| Live sockets | The project sockets start after the mount settles and a socket closed on purpose no longer logs "Live connection unavailable"; genuine failures still warn and reconnect. |

Pages own their controls through `PageHeaderActions` and `PageHeaderTabs`; the
common frame places these beside or below the title. Dashboard styles, icons and
palette are editable first-party source; they replaced the earlier theme-based
styles with visual parity, and the one visible change is that the attachment row
now shows its paperclip icon. A screenshot conversion is comparison evidence,
not a replacement for dynamic workspace names, user data or original vector assets.

## Public identity pages

`/login`, `/register`, `/forgot-password`, `/reset-password`, `/verify-email`, `/accept-invitation` and the
"already set up" state of `/setup` are public pages, so they use the homepage visual language
(`src/ui/identity`, with Outfit from `src/ui/homepage`): warm paper, ink text, black pill actions, the HappyToHelp
lockup (the speech-bubble mark and the drawn wordmark, as in the homepage header) linking home, and links to one another. They replace the original centered Laravel-era frame and no longer load the
dashboard stylesheet or its purple. The dashboard itself keeps its own design system.

- Sign in, sign-up and recovery read `GET /api/identity/auth-options` (install not set up, sign-up possible, recovery
  email possible). `/login` points to `/setup` while no owner exists and offers "Create an account" only when sign-up
  can work; `/register` shows a closed notice instead of a form that always fails. Sign-up also stays closed (page and
  `POST /register`) until the first owner exists, so it cannot claim the installation ahead of setup.
- Links from email are checked on load with `POST /api/identity/link-status` (reads, consumes nothing). A missing,
  unknown, expired or used invitation, verification or reset link says so with a way forward and no form.
  Verifying an email and accepting an invitation stay explicit actions, so mail scanners that open links cannot consume them.
- The invitation page shows the workspace, invited email and role. A new person chooses a name and password; someone who
  already has an account is sent to sign in and returned to the link (`returnTo`) to accept as that account; a different
  signed-in account is told the invitation is for another address.
- Every new-password field (sign-up, reset, invitation) states the server rule of 12 to 1024 characters, enforces it in
  the browser and sets `autocomplete="new-password"`.
- With no email provider, `/forgot-password` still fails closed (503, no reset token, no mail) and tells the visitor that
  the workspace owner must reset the password; owners with two-factor on can issue a one-hour reset link with `POST /api/identity/password-reset` (their own recent factor, audited)
  (there is no dashboard control for it yet).

## Pending invitations

On Agents, a pending invitation row offers **Copy link**, **Resend** and **Revoke** to owners, and to admins for
invitations that grant the agent role (as when inviting); operators see the row without controls. An invitation is the
set of unused links for one email in one workspace. Links are stored only as hashes, so Copy link issues another link
rather than revealing an old one, and earlier links keep working until they expire or the invitation is revoked.
Resend emails a fresh link (disabled, and refused by the server, when no email provider is configured). Revoke deletes every
unused link. The routes under `/api/management/projects/:projectId/invitations/:invitationId` re-check the caller's
membership and role on every request. The invite form says up front when email delivery is not configured.

## Management and library behaviour

These rules were added after the 30 September review and are checked by
`pnpm run test:management-library-browser` (browser, emitted Worker) and
`tests/journeys/inbox.mjs` (part of `pnpm run test:modules`).

| Area | Behaviour |
| --- | --- |
| Deleting | Saved replies, contacts, AI assistants, plugins, agents/members, articles, categories and website datasets all open the shared `ConfirmDialog` (`src/ui/native/pages/ConfirmDialog.jsx`), a native modal dialog: the page behind it is inert, Tab and Shift+Tab wrap between its first and last controls, Cancel and Escape change nothing and return focus to **Delete**, and any server refusal is shown inside the dialog. No native browser prompt is used. Contact erasure uses the same dialog with an exact typed `ERASE` confirmation. |
| Members | A project's last owner cannot be removed (the dialog explains this and offers only Close; the server refuses it with a 409). Removing yourself shows an explicit warning and, once confirmed, signs you out of the project. |
| Phone tables | Below 768px the list tables of Saved Replies, Agents, Contacts, Plugins, Websites (datasets), Articles and a website's indexed pages stack each row as a card with a caption per value (`stack-table.css`); nothing is clipped or hidden behind a sideways scroll. Row actions that sit behind a ⋮ menu on wide screens (plugins, articles, categories) are shown as visible controls on the card (`RowMenu.jsx`). |
| Evaluation runs | One name (“Evaluation runs”) in the tab and the page title. The form validates before sending: models, a JSON list of cases with unique ids, optional variants, a maximum cost greater than 0 and a token limit from 1 to 32,000, each reported next to its field (`training-run-form.js`, mirroring the server). It has an empty state and explains the limits. |
| Create forms | Datasets require a valid http(s) starting URL, a crawl depth from 0 to 100 and a page limit from 1 to 10,000 (form, `POST`/`PUT` dataset routes and the crawler start, `crawl-limits.ts`). A new contact needs a name, an email or an external ID (form and `POST` contact route; existing visitors without a name can still be edited). Plugin URLs must be https (http only for localhost) in the form as well as on the server. |

## Inbox and conversation behaviour

Corrections from the 1 October 2026 independent UI sweep, checked by
`pnpm run test:inbox-conversation-browser`, `tests/journeys/inbox.mjs` and
`tests/journeys/delegation-browser.mjs` (saved reply insertion).

| Surface | Behaviour |
| --- | --- |
| Contact local time | The conversation header and **Ticket → Customer** show the contact's clock only when a known timezone is recorded. Without one the header omits the time and **Ticket → Customer** shows **Local time: Unknown**; the viewer's own clock is never presented as the contact's and nothing is logged by Moment Timezone. |
| Conversation header | With the right panel open the name, verification badge and status share one line inside the 72px bar. A long name, email or project name is ellipsised and carries its full text as a tooltip. The conversation panel toggle is an icon button named **Show conversation panel** or **Hide conversation panel**; while the panel is closed it shows a small dot when the ticket summary has an alert (an SLA alert or a customer update to review). |
| Inbox search | Matches a contact's name or email address, literally (`%`, `_` and `\` are ordinary characters), up to 200 characters. Longer input is answered with a 400 and the message "That search is too long…", shown in the list without a Retry button. The placeholder and accessible name say "name or email"; an empty result reads "No results for “query” in all open. Search looks at customer names and email addresses." Message text is **not** searched; there is no full-text index. |
| Assignment menu | Escape closes it however it was opened (mouse, Enter, or from a menu item) and focus returns to the toggle. |
| Saved replies | The draft stays visible while the picker is open. Choosing a reply inserts it as its own paragraph beside the caret's line (before it when the caret is at the line's start, after it otherwise), so typed text is never split or overwritten; an empty composer receives exactly the reply. |
| Row Close / Reopen | A real button beside the row link (not nested in it) in its own column of the row. It is in the tab order, visible on keyboard focus and always visible on touch screens; on hover-capable pointers it is revealed on row hover or focus. |
| Closed conversations | The header shows **Reopen** in place of **Close**, and the reply card's **+ (Actions)** menu no longer offers **Send & close**. |

## Verification and limits

The page sweep covered 35 routes and 11 tab states at desktop and mobile sizes
(92 captures). It found a mobile profile file-input overflow; a focused closeout
checks the fix and the public account pages. Original screenshots and failed
probes are retained alongside native captures. Fixture data differs between the
two runtimes; populated states and remote-provider results are not implied by an
empty-page screenshot.

The native browser suite verifies durable replies, notes, saved replies, project
settings, brand upload, plugin edits, invitations, AI defaults/switches, categories
and mobile navigation. Two additional real-Worker checks verify editing an
existing article's categories and clearing an existing category's parent. The
review also corrected an unset human-response preference being saved as disabled.
Setup and widget browser suites, module tests and emitted Worker checks remain
part of acceptance. See `HANDOVER.md` for commands.

This is a substantial consistency pass, not full legacy feature equality. Each
remaining gap has an explicit product/API disposition; this accessibility closeout
does not invent unsupported data or controls to make the screens appear complete.

| Remaining legacy gap | Reason and user impact | Supported alternative |
| --- | --- | --- |
| Global Contacts aggregation | Contact reads are project-scoped; there is no combined account-wide list. | Switch workspaces to review each workspace's Contacts. |
| Global Inbox Appearance settings | Color and display mode are saved per project. There is no persisted global inbox theme override, so one change cannot style every project. | Use each project's Appearance controls. |
| Standalone computer-consent metadata | The project settings contract has no matching standalone consent field, so that legacy metadata cannot be edited. Contact-specific customer-context consent is a different contract. | None for the standalone metadata. |
| AI type catalogue | The wider legacy catalogue is not exposed by the native API; those pre-defined types cannot be selected. | Define assistants by name, role, model and prompt; choose defaults for signed-in/other visitors and allow human responders. |
| Invitation-time notification preferences | Invitation records hold project, email, role and expiry, without notification preferences. The preference cannot be chosen when inviting. | After acceptance, edit the member's notification preference. |
| Some contact history | Contact profiles show available facts and transcripts include messages, notes and selected attributed events; there is no complete legacy contact-wide timeline. | Open available conversations for their supported history; no equivalent for missing historical event types. |
| Per-import credential entry | Imports use installation-configured credentials; the import form cannot retain credentials per job. | Configure the chosen source's credentials for the installation, then select the source and required subdomain in the import form. |
| Administrative aggregates/actions | Admin lists read raw records (up to 200), without several legacy aggregates/actions. Missing aggregate values display as em dashes and unsupported actions are absent. | Lead processing, sending a reviewed draft and deletion are supported. None for other missing aggregates/actions. |
| Original onboarding and demo flows | The original onboarding journey is not reproduced. Native owner setup and the existing demo inbox provide a different entry path. | In an empty workspace choose **Try a demo inbox** to create **Demo inbox · Northstar Outfitters**, with fictional conversations, an editable assistant and three published FAQs. Creation makes no AI, email or provider calls. **Generate replies** is a separate configured-provider action and never sends a customer reply. |
| Configured provider journeys | Local accessibility checks make no live provider calls, so delivery, OAuth acceptance and hosted behavior are unqualified. | Qualify the native integrations separately with configured accounts; local boundary fixtures are no substitute for provider acceptance. |

The accessibility audit and its exact route/state limits are recorded in
[ACCESSIBILITY-AUDIT-2026-09-30.md](ACCESSIBILITY-AUDIT-2026-09-30.md). The retained
checker verdict is **FAIL / confirmed owner HOLD** because independently reproduced
false accepts and timing/background reliability remain unresolved. Its bounded states
do not establish complete WCAG conformance or close the feature/API gaps above; see
[HANDOVER.md](../HANDOVER.md) for the current disposition.

The comparison screenshots are not part of this repository. The browser suites
named above (`pnpm run test:ui-browser` and related `test:*-browser` scripts)
are the maintained checks.
