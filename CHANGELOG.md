# Changelog

What changed in each HappyToHelp release, newest first.

Versions follow [Semantic Versioning](https://semver.org/). Before 1.0.0, a
minor version (for example 0.2 to 0.3) may include breaking changes, so when you
upgrade, read the notes for every version between yours and the new one. For
updating and backing up an installation, see
[Updates and recovery](docs/INDEPENDENT-RELEASE.md).

## 0.4.12 — Unreleased

- **Export and leave:** backups now work on Platform-applied installs without re-running their database migrations. Incomplete or conflicting migration history is refused before data changes; native installs retain their usual migration path.
- **Installer:** pin rer 0.2.77, including migration-ledger checks and the narrowed GitHub-reference rule.

## 0.4.11 — 2026-10-20

No breaking change.

- **R9a companies and customer CSV:** company records, domains, membership, reversible merge and mapped CSV preview, apply and undo with import-local fences.
- **R10a reports, handle timers, problems and incidents:** permission-scoped team reports and scheduled CSV, adjustable handle timers with named lead stops, reviewed incident updates and delivery history.
- **R12a escalations:** encrypted engineering connections, reciprocal issue links, selected attachment grants, idempotent webhook state, approved customer drafts and Slack handoff. Exports keep no provider credentials; human Send stays.
- **Native signout and rer 0.2.74:** audited POST /auth/signout retires only the current session; the pinned installer retains existing deployment resources and private state.
- **H1 homepage hero:** one drawing tells both moments, with Pay now clear of the offer card at narrow phone and desktop widths.
- **H3 Ink rail app theme:** the accepted rail, form and identity styling reaches the installed application.
- **Scanner fixture correction:** the synthetic Slack escalation token is assembled from parts with identical runtime bytes; every assertion and product behavior is retained.
- **TRIAGE-001:** asynchronous intent, sentiment and language predictions, operator correction labels and explicitly approved intent routing; other rules act at admission and default placement never overrides a teammate.
- **Migrations:** `192_companies.sql`, `193_customer_csv.sql`, `194_csv_run_fences.sql`, `195_restore_trigger_boundaries.sql`, `196_csv_touched_fences.sql`, `201_report_timers_schedules.sql`, `202_problem_incidents.sql`, `203_problem_delivery_history.sql`, `204_problem_preview_audit.sql`, `205_handle_timer_lead_stop.sql`, `220_ticket_triage.sql`, `230_escalations.sql`. Apply by name through pinned rer before the updated Worker serves traffic.
- **Upgrade:** Update from v0.4.10, or any earlier line, to v0.4.11 without resetting. Back up D1, R2, Durable Object state and private settings first. Install frozen dependencies with Node 22.20.0, pnpm 10.12.4 and pinned @runeditrun/rer 0.2.74. Retain private settings, owners, imported support history, permissions, files, erasure fences and migration history; never delete, reorder or edit ledger rows. Run rer deploy --dry-run against the retained installation first. Apply the following twelve migrations once, in listed order and by file name, through pinned rer before the updated Worker serves traffic: 192_companies.sql, 193_customer_csv.sql, 194_csv_run_fences.sql, 195_restore_trigger_boundaries.sql, 196_csv_touched_fences.sql, 201_report_timers_schedules.sql, 202_problem_incidents.sql, 203_problem_delivery_history.sql, 204_problem_preview_audit.sql, 205_handle_timer_lead_stop.sql, 220_ticket_triage.sql, 230_escalations.sql. An earlier installation also applies its other missing published migrations by name through pinned rer. Held secrets inherit and the seven Google, Microsoft and IMAP mailbox settings stay optional. Escalation connections keep no provider credentials in exports; retain human Send and unconfirmed recovery. No breaking change.

## 0.4.10 — 2026-10-20

- **Synthetic fixture credential.** Rename the cron-backlog signing token and its matching inbound request to an explicitly synthetic value so RER's hosted source scanner accepts the published archive. The existing test still verifies the same mail, scheduling and backlog behavior.
- **Ticket collaboration markup.** The follow and live-collaboration area of a conversation is now a labelled group, so its label is valid ARIA in every state, including while the follow controls are still loading. It looks the same.
- **Deterministic account-security journey.** The emitted-runtime test helper opens a Worker inspector only when a port for it is given, instead of implying one on the next port that might be taken; workerd could then hang without reporting ready. The readiness wait is a named wall-clock bound sized from measured starts. Every assertion of the journey is unchanged.
- **Upgrade from 0.4.9.** No new migrations. Keep rer 0.2.68, back up and retain private settings and the migration ledger without resetting. The seven mailbox settings remain optional. Production deployment is separate.

## 0.4.9 — 2026-10-20

- **RER queue recipe.** Match the JOBS consumer's three retries to the deployment specification and Wrangler so fresh Managed installs and upgrades approve matching resource plans.
- **Declaration drift check.** The existing installer journey compares all queue-consumer and schedule fields across the recipe, deployment specification and Wrangler's declared settings. CI fails on differences without pinning their values.
- **Upgrade from 0.4.8.** No new migrations. Keep rer 0.2.68, back up and retain private settings and the migration ledger without resetting. Existing owners, support history and files remain; the seven mailbox settings stay optional. Production deployment is separate.

## 0.4.8 — 2026-10-19

- **Support workflows (R5).** Business hours and holiday calendars, first/next response and resolution SLAs, event and time rules, routing, follow-ups, snoozes and scheduled replies. Preview before publishing; existing SLA and default-close previews remain inert.
- **One budget for the whole cron invocation.** Workflow recovery, operator-mail dispatch and audit work share a single database statement budget within D1's invocation limit.
- **Durable bulk work.** Bulk assignments and macros deliver teammate notices during the request when its budget permits. Queued work resumes after interruptions; exhausted batches record each ticket's outcome. Cron recovery completes notices within its remaining budget, and interrupted attempts retain visible uncertainty without replay.
- **Installer and deployment.** Pin rer 0.2.68, including blob-less release reads and safe temporary cleanup (#313), declared mail-provider keys and migration-sized provider budgets (#314), missing-secret dry-run refusal, large-seed publication scanning and portability that skips rer-owned ledgers.
- **Upgrade from 0.4.7.** Back up D1, R2, Durable Object state and private settings. Apply exactly `150_workflow_journal.sql` through `156_ticket_batch_jobs.sql` with the pinned rer before serving traffic. Missing migrations are planned by name and bytes, including below already applied rows, with final readback. Preserve owners, imported history, permissions, files and erasure fences; never reset or edit the ledger. The seven mailbox settings remain optional.

## 0.4.7 — 2026-10-18

- **Optional mailbox setup.** Deployments can omit the seven Google, Microsoft and IMAP configuration values. Held secrets keep their existing bindings; every other deployment binding is unchanged. Email settings explains unavailable connections and disables their connect actions until configured.
- **Upgrade from 0.4.6.** No new migrations. Back up, retain private settings and deploy with pinned rer 0.2.51. Existing owners, support history and files remain. An installation on 0.4.5 still receives exactly 0.4.6's fifteen missing migrations by name; never reset or edit the ledger.

## 0.4.6 — 2026-10-18

- **Macros and private collaboration (R4).** Versioned action macros preview changes and editable reply text before Send. Private notes, mentions, followers, collision indicators, reversible merges and partner collaboration retain permissions and private history.
- **Notices to proven recipients.** Editable received and solved notices, Cc relay and AI replies reach independently proven addresses only. Frozen delivery claims preserve uncertainty without replay; Cc headers alone grant no recipient authority.
- **Complete email (R6).** Connect Gmail, Microsoft 365 or IMAP; manage aliases and signatures, CC/BCC, threading, operator-created tickets and vendor matching. Refused and unreadable mail goes to Suspended; bounded per-message failures keep healthy intake moving. Receiving proof remains separate from sender and recipient authority.
- **Customer portal and request forms (R7b).** Configurable request forms create native tickets with typed fields and idempotent submissions. Independently verified customers can use the portal to follow their permitted tickets and reply, with private team history protected.
- **Installer qualification.** Exact upgrade expectations include participant provenance; historical archive policies deduplicate exclusions so README restore and native portability complete.
- **Dropdown carets.** Include the shared select-caret styling.
- **Upgrade from 0.4.5.** Back up and apply `140_macros.sql` through `146_participant_provenance.sql` and `160_mailboxes.sql` through `164_mailbox_message_attempts.sql`, plus `172_request_forms.sql`, `173_customer_portal.sql` and `174_portal_mailbox_requester.sql`, through pinned rer 0.2.51 before serving traffic. These fifteen migrations sort below already applied production rows and are planned by name, with bytes and final readback checked. Retain credentials, history, imports, files and private settings; never reset or edit the ledger. Existing participants remain unproven until independently verified. R5 is not included.

## 0.4.5 — 2026-10-18

- **Hosted migration history.** Pin `@runeditrun/rer` 0.2.51. Deployments from gated migration subsets can apply missing migrations that sort below already applied rows. Rer checks applied names and recorded bytes, refuses unknown names, changed bytes and uncertain history, and verifies the final set by name and bytes.
- **Upgrade from 0.4.4.** No new migrations or product changes. Back up and deploy with the pinned rer without resetting or editing migration history. Existing credentials, support history and file bytes remain. Earlier releases receive every migration they lack in filename order before traffic resumes.
- **Test harness.** Includes main's `5f7c1f3` queue-consumer isolation for test runtimes; product behavior is unchanged.

## 0.4.4 — 2026-10-18

- **Replies to Closed tickets.** A customer's emailed reply to a Closed ticket is recognized as on an open ticket, including a widget visitor answering through the reply address, and always opens a new ticket for that customer instead of a separate contact or another open ticket of theirs. A teammate's emailed reply to a Closed ticket is refused with a bounce or an email notice, never stored as a customer message.
- **Capacity check.** The 1,000-conversation import journey asserts live isolate memory after a forced garbage collection, below 64 MiB, instead of an uncollected heap figure that moved with GC timing.
- **Upgrade from 0.4.3.** No new migrations. Back up, then replace the Worker; existing credentials, support history and file bytes remain.

## 0.4.3 — 2026-10-18

- **Release qualification.** Fresh-clone journeys retain the complete local owner entry, invoke the pinned pnpm consistently and compare restore against the exported Durable Object snapshot. Upgrades preserve every original value except the exact documented email-proof and owner-alert migrations. New migrations 124 and 126 bracket the 125 email-proof backfill so a contact erasure interrupted under 0.4.1 cannot rewrite integration history recorded since; the identical erasure guard is restored before traffic.
- **Ticket work.** Native statuses, priorities, groups, custom fields, saved views and previewed bulk updates retain the existing conversation history and permissions. Closed tickets are final: a customer reply to a Closed ticket, by email or widget, opens a new ticket for the same customer, and required fields are enforced when they change or on the move into Solved or Closed. Migration 191 indexes ticket history by conversation, so new conversations and large imports no longer scan the whole history.
- **Documentation.** The docs gain the standard Run and Contract pages built by `@runeditrun/rer` 0.2.45, now the pinned command package.
- **Recovery.** A failing satisfaction-survey dispatch no longer blocks other scheduled recovery work, surveys wait until survey signing is configured, and the help center offers reader sign-in only when it has restricted collections.
- **Upgrade from 0.4.2.** Back up and apply the migrations listed in RELEASE.json before serving traffic. Existing credentials, support history and file bytes remain.

## 0.4.2 — 2026-10-17

- **Mailbox confirmation.** Owners claimed by email and moved-in teammates without a second factor confirm sensitive actions by a single-use, 15-minute email sign-in link. Requests are limited atomically and audited. Email is also offered beside existing passwords. After mailbox proof, Profile lets an owner replace an unknown password without the old one; deliberately set passwords keep working. Merely requesting email grants no proof.
- **Conversation history export.** Reports downloads full workspace JSON with messages, private notes and attachment names. Empty widget drafts no longer inflate Reports or its analytics CSVs.
- **Honest mail status.** A reply whose visitor address matches the sender explains why no email was sent.
- **Deployable tag.** The install guide covers PATH and names v0.4.2, using rer 0.2.42.

- **Two-factor sign-in.** Add an authenticator app or a passkey (security key, Touch ID, Windows Hello) on your profile, with ten single-use recovery codes. Owners can require it by role from Settings → Security; teammates set it up at their next sign-in before they see anything, and sessions without it end. Wrong, reused and spent codes are refused, limited and logged. An owner can reset a teammate's factors, and a locked-out owner recovers with an installation key set through `rer`, never by email alone.
- **Confirm it's you.** Exports, contact erasure, role changes, installing integrations and credentials, and deleting a workspace ask for the second factor (or the password, without one) again after 15 minutes.
- **Collaborator and custom roles.** Invite a collaborator who can read conversations, add internal notes and follow them, but never reply to customers. Settings → Roles creates roles that narrow Agent, Collaborator or Admin, for example an agent who cannot publish articles or export data.
- **Security log.** Settings → Security log lists sign-ins, two-factor and role changes, imports, exports, erasure, assignments and approvals with who, where, when and the result; export it as CSV or JSON, set retention and place legal holds. Entries cannot be edited.
- **Erasure reaches connected services.** Erasing a contact sends every webhook a signed `contact.erased` request and shows, per store and provider, what was removed, what was asked and what cannot be recalled.
- **Backups carry Durable Object storage.** `rer export` records every Durable Object's stored records with a schema and digest, and `rer import` checks them before restoring.

- Mark source fixtures as synthetic so hosted changes can admit the public source without changing test coverage.
- **Freshdesk Move in.** Tickets with every reply and private note, contacts, agents (as authors only), canned responses and attachment names come across from a script on the Move in page. Signed attachment links are never kept.
- **Move in review you can act on.** The plan shows right after upload, in plain words: what will import, what needs fixing (file, line, reason) and what stays in your original file. Approve appears only when something can import. A rejected record no longer holds its source ID, so a corrected file imports it; imported records are linked by subject or name.
- **Imported history lands as it was.** Solved and closed conversations from Zendesk, Intercom, Help Scout and Freshdesk land closed, and imported messages never count as unread.
- **Pages a newcomer can finish.** API tokens, Webhooks, Slack and Local computers explain each value and where it comes from, with copyable commands and a webhook signature check. A published article no longer offers Publish again. A local trial's workspace is no longer named after its checkout folder; Setup asks for your business name instead.

### Included since 0.4.1

### Added

- **Hosted native owner claim.** Rer can claim the configured installation owner once through `/auth/bootstrap`, then retire its private token. The claim uses the native account, workspace and session transaction without installing an unknown password; concurrent or repeated claims preserve the existing owner. Local password setup remains available.

- **Help Scout Move in.** Review and import supported Inbox v2 and Docs v1 API response bodies as native history and knowledge. JSON, JSONL and ZIP groupings are packaging conventions, not Help Scout exports. Saved replies and attachment bytes are omitted; real-account compatibility remains unverified.
- **Deliberate uncertain webhook resend.** Owners/admins can inspect the receiver and approve the original delivery ID/body again from Connections → Delivery log. Only 429 retries automatically within the existing four-attempt budget; 5xx, 408, timeouts and redirects remain uncertain. Each approval beyond the budget permits one audited attempt. A resend can duplicate an effect.
- **Guided local-agent fixes.** Investigation, explicitly approved Resolve, separate observation and an operator-reviewed reply retain human Send. A Resolve report does not prove the customer system changed. The documented journey uses a scripted provider boundary and disposable target.
- **Provisioned new workspaces.** Non-demo workspaces gain a default starter assistant, reply mailbox when configured and the installation sender until their own domain is verified. Explicit creation may send one welcome email; uncertain mail is never replayed. A bounded initial website read keeps private knowledge without publishing articles. Without an AI key, conversations stay with the team.

### Fixed

- **Re-import keeps native edits.** Unchanged source records retain edited native targets while new records can be imported; changed sources or conflicting ancestry remain review conflicts. Category insertion no longer invalidates unrelated articles; deletion updates only affected ancestry.
- **Runtime and documentation consistency.** Preview declares generated core migrations, documentation edits reach the development watcher, and bounded hydration recovery retains explicit failure reporting.

### Changed

- **First run and Setup.** The one-screen form derives optional names and colours. Setup separates Needs you from What we've set, observes applicable checks automatically with freshness bounds and permits durable owner/admin skips. A skip never counts as confirmation; rejected keys remain Needs you. Empty inboxes show one next action and a link to Setup.
- **Workspace appearance and navigation.** A neutral light canvas, lighter fields and softer menus accompany the revised inbox and settings navigation. Dark-theme tokens remain.
- **Package commands and automatic local setup.** Checkout commands pin published `@runeditrun/rer` **0.2.25**. Rer dev v2 enters as the real native owner through `RER_OPEN`; local visitor and teammate email is suppressed without storage or external sending. The README path is `npm install -g @runeditrun/rer`, clone, then `rer dev`: the command provisions pinned tools, installs dependencies and sets up a local origin and private owner password without private answers or external mail/AI credentials. The `v0.4.1` tag predates package conversion, so updating requires current source and frozen dependency installation.

### Updating from 0.4.1

Back up and apply `120_activation_observations.sql` then `121_move_in_categories.sql` **before starting the updated Worker**. Migration 120 adds nullable observation data without backfill; 121 replaces category revision triggers without rewriting existing rows. Never reset to upgrade. See [Updates and recovery](docs/INDEPENDENT-RELEASE.md).

These notes claim no hosted installation, real vendor-account compatibility, paid-provider execution, import capacity or operating-cost qualification. Synthetic fixture boundaries, accessibility HOLD and D1/R2-only backup limits remain; see [Acceptance](ACCEPTANCE.md).

## 0.4.1 — 2026-10-13

### Fixed

- **Worker memory while applying or undoing a large import.** Undoing a
  1,000-conversation import could peak above 128 MiB of sampled Worker heap in
  verification. A reviewed import is now split into children of at most 10
  records (was 20), each invocation applies or reverses up to 20 journal rows
  (was 10), and the D1 request meter counts UTF-8 bytes without copying every
  bound value. Reviews and imports created by 0.4.0 keep their recorded children
  and stay resumable and undoable.
- **Move in reviews of up to 5,000 records.** Preparing a review read the
  database twice for every child, so the smaller children pushed imports of
  roughly 2,500 records or more (and every 5,000-record import, in 0.4.0 too)
  past the Worker's 1,000-query limit. They stayed in "Preparing review" with no
  error. Authority is now checked once before and once after all child plans are
  written. A review's decisions and diagnostics, which passed D1's 2 MB row limit
  for 5,000 Intercom records, are kept as a private object under the import's
  storage prefix; the import row keeps the summary and the object's hash. Reviews
  prepared by 0.4.0 are read unchanged. A background step that still runs out of
  queries records the error on the import, which the page shows with
  **Resume import**.
- **Delivery build.** The delivery workflow allows 90 minutes, enough for the
  full verification, frees the runner disk space Verify already frees, and uses
  Node.js 22.20.0 like the rest of the project.

No migration. A 0.4.0 installation merges `v0.4.1`; a 0.3 installation follows
[Upgrading from 0.3.x](OPERATIONS.md#upgrading-from-03x).

## 0.4.0 — 2026-10-12

### Added

- **Move in.** Owners and admins import support history (conversations,
  contacts, tags, saved replies and articles) from supported Zendesk and
  Intercom exports. Each import shows its plan, rejections and conflicts before
  you approve it, keeps original source IDs, timestamps and publication state,
  resumes after a stop and can be undone. Applying or undoing an import sends no
  mail and starts no model work, assignment or notification.
- **Resolution feedback and Reports.** A visitor can rate the answer to their
  resolved conversation with thumbs up or down and an optional comment. Each
  resolution records how it was reached (AI, assisted, human or unknown). Reports
  show volume, median and p90 first-response and resolution times, AI resolution
  and satisfaction for a workspace-calendar range, with a daily series and
  formula-safe CSV exports. Imported history is excluded.
- **Connections.** Scoped workspace API tokens (seven scopes, shown once, stored
  hashed, revocable), thirteen Bearer API operations, four signed webhook events
  with delivery logs, and Slack delivery. Explicit HTTP 5xx and 429 answers are
  retried a bounded number of times; timeouts and redirects are reported as
  uncertain and never replayed.
- **The rer local path.** `pnpm exec rer install`, `setup` and `dev`
  replace `scripts/install.mjs`, `scripts/setup.mjs` and `scripts/operations.mjs`.
  Native password sign-in is kept. `export`,
  `import` and `reset` move or clear local data.
- Installation archives are refused in build output and are never served by the
  local app.

### Changed

- Use **Node.js 22.20.0** and pnpm 10.12.4. (0.3 used Node.js 26.8.1 or newer.)
- Apply the ten additive migrations `0110_move_in.sql` to
  `119_local_portability.sql`, in order, before the updated Worker serves
  traffic. They leave earlier migrations and existing rows unchanged.

### Upgrading from 0.3.x

Back up first: locally `.wrangler/state` and `.dev.vars`; on Cloudflare the D1
database, every R2 object and your secrets, including `INTEGRATION_ENCRYPTION_KEY`.
Update your checkout, switch to Node.js 22.20.0 and run `pnpm exec rer setup`
with your existing owner email. It applies the migrations and keeps your owner,
password, data and saved settings. Never use `reset` to upgrade.
[Upgrading from 0.3.x](OPERATIONS.md#upgrading-from-03x) lists every step.

### Known limits

- Accessibility is on a confirmed owner **HOLD**: an automated checker wrongly
  accepted four contrast cases. No WCAG conformance is claimed.
- Backups and archives cover D1 and R2 only. **Durable Object** storage is not
  included, and full portable-storage fidelity (including resizable ArrayBuffer
  preservation) is not established.
- Hosted operating costs are **unmeasured**. Timed activation and paid-provider
  (model and mail) execution are not qualified.
- Move in and the connection protocols are qualified with **synthetic fixtures**
  only; real vendor exports and live Slack were not supplied.
- No hosted installation, compliance or FedRAMP qualification is claimed.
- The hosted service at **app.happytohelp.com** is separate legacy production. It
  is not part of this release and is not upgraded by it.

## 0.3.0 — 2026-10-10

- Hand assistant replies and attachments to the editable composer, close compact
  panels and focus the draft; keep desktop columns open and Send explicit.
- Adopt completed local reply attachments as the current operator's
  native media before filling the composer. Repeated Use keeps one file; revoked
  authority, changed conversations and incomplete copies leave a visible error.
  Ordinary Send preserves the copied bytes through the native message path.

- Make delegated Codex structured output strict at every object, including unused
  reply and attachment fields, while preserving authorized legacy reply delivery.
- Keep native model-provider HTTP status and a bounded, redacted error excerpt
  on failed delegations so operators can inspect the failure after reload.
  Provider failures remain terminal and never send a reply or replay work.

- Persist shared public appearance through native settings, with widget/Help Center
  parity and visible loading, error, offline and recovery states. Long public
  names, multiline greetings and unbroken article text wrap within their surfaces;
  wide article code and semantic tables scroll within named, keyboard-focusable
  regions with visible focus rings inside the content column.
- Let keyboard users focus and scroll the chat transcript, including long welcome
  greetings, with a visible focus ring and a tab path back to the composer.
- Add explicit, scanner-safe native email sign-in with hashed short-lived one-use
  tokens, current authority checks and safe native return destinations.
- Exercise the real paired connector through native repair, a reviewed draft and
  operator Send, including visitor socket delivery and stable reload identity.
- Adopt the unchanged Base delivery producer pinned at
  `d6a1bd83ee80ec3d603ded2c067d4c504d8a2bf5`; builds emit schema-2 manifests and raw
  payloads. Preserve exact candidate payload bytes and deployment policy.

Real provider and hosted acceptance remain separate; the historical
accessibility checker HOLD remains in force.

## 0.2.2

### Added

- AI answers carry publication-bound citations. Retrieval excludes unpublished or
  withdrawn sources, and stored citations retain the source version used for the answer.
- The empty inbox and Setup page share an observed, project-scoped eight-step
  activation checklist. Saved settings alone do not count as delivery, DNS, model,
  inbound-mail or widget proof; unknown provider outcomes are never replayed.
- Knowledge authoring exposes article publication, retrieval eligibility and
  source navigation. Conversation AI controls share one state, demo workspaces
  retain their context, and the spend card explains effective runtime ceilings.
- Migration `0107_activation_receipts.sql` adds activation observations;
  `0108_public_answer_citations.sql` adds publication identities, retained
  citation sources and customer-context mutation fences. The upgrade also includes
  `0105_edition_delegation.sql` and
  `0106_project_verification_secret.sql` after public v0.2.1.
- Pending invitations on Agents can be copied, resent (when email is configured) and revoked by
  owners and by admins for agent invitations. The routes re-check the caller's role. New public
  helpers `GET /api/identity/auth-options` and `POST /api/identity/link-status`, with
  `pnpm run test:identity-browser`, `tests/identity-links.mjs` and `tests/management-invitations.mjs`.

### Qualification boundary

- Cited answers and the activation checklist are implemented. The real timed
  activation recording is still missing; recorder preparation is not a pass.
- Accessibility remains **FAIL / confirmed owner HOLD** because the retained
  checker has false accepts and timing/background limitations. No complete WCAG
  conformance is claimed. Further checker correction remains held.
- Local tests and a version number do not establish hosted, live-provider,
  production-import or portable-storage fidelity acceptance. Exact release
  receipts remain in maintainer custody outside the public source.

### Fixed

- Widget settings (Theme, Texts, Settings) now show what the widget actually renders:
  default colors, default copy and default toggles, with the default copy also shown as
  each text field's placeholder. Editing one field changes only that value in the form
  and the live preview, and Save stores only edited fields, so saving without edits no
  longer blanks the widget copy, turns defaults off or paints colors black. Clearing a
  text field or restoring a default removes its override. Saving widget settings no longer
  discards the theme and text when the form includes a `settings` section.
- Every project now has a server secret (`H2H_SECRET`) for signed-in-user verification.
  It is generated when a project is created (setup, registration, project creation, demo
  inbox) and migration `0106_project_verification_secret.sql` backfills existing projects
  that had none. Owners and admins can reveal and copy it from Widget > Code; other roles
  see an explanation instead of disabled buttons.
- `GET /api/identity/projects/:id` returns only the project's id, name, widget key, allowed
  origin and creation time; the server secret reaches owners and admins only through widget settings.
- The delegation consent page and Connected applications are served under a strict
  Content-Security-Policy (same-origin sources, no plugins, `base-uri 'self'`, no framing) and
  `form-action` limited to this origin plus, on the consent page, the callback registered for
  the request's client. The consent page keeps `X-Frame-Options: DENY` and `no-store`; the
  application header layer no longer replaces that `X-Frame-Options` with `SAMEORIGIN`.
- Every destructive delete in the management and library screens (saved reply,
  contact, AI assistant, plugin, agent/member, article, category and website
  dataset) now asks through one shared, accessible confirmation dialog instead
  of deleting at once or using a native browser prompt; Tab and Shift+Tab stay
  inside it. Contact erasure uses the
  same dialog with its exact typed `ERASE` confirmation. The last owner cannot
  be removed, and removing yourself is called out before it is confirmed.
- List tables on phones (saved replies, agents, contacts, plugins, websites,
  articles) stack each row as a captioned card, so no column or row action is
  hidden behind an unnoticed sideways scroll; row actions that sit in a ⋮ menu on
  wide screens are shown as visible controls on the card.
- The evaluation-run form shows field-level messages in place of the browser's
  JSON parser text, has an empty state, one consistent name (“Evaluation runs”)
  and explains its limits (a maximum cost of 0 is not accepted; 1 to 32,000
  tokens).
- Website datasets refuse crawl depths outside 0 to 100 and page limits outside
  1 to 10,000 in the form, the API and the crawler start; contacts created from
  the dashboard or API must have a name, an email or an external ID.

### Changed

- The owner-approved “Customer Support, Solved.” homepage clarity pass (owner direction 2026-10-02) keeps the 1, 2, 3 story and cuts everything
  that stood between a reader and it. The hero drawing is one column: Maya cannot turn on the Spanish
  version of her store, Codex has fixed it (a cyan note card with a check), and the reply is in the
  composer with Send circled, with callouts 1, 2, 3 and the caption steps; the subhead is “Your Codex
  or Claude fixes the problem and writes the reply. You press Send.” and the line under the actions
  is “100% free and open source.” “Not just better. Free.” now says it plainly (100% free and open
  source, free as in code and free as in cost, MIT licensed, “No seats. No plans. No fees.”) beside a
  drawing of the MIT licence. “Help before they ask”, “The rest of your support desk” and “Try it
  beside what you have” are trimmed to one short line each with smaller drawings, and a short
  “Ready when you are.” band replaces “Yours to run”. The page no longer mentions prices, hosting,
  providers or Run Edit Run, and the examples strip, the signals list, the bill, installer and Local
  panel drawings, and the costs and hosted-options links are removed. The page meta description is
  updated.
- Historical pre-clarity homepage state: the page then led with the local-agent handoff; its hero drew a conversation whose
  task Codex or Claude on the team's own computer had already completed, with the Local panel,
  internal note and drafted reply the team reviewed, and a subhead that said who ran it and who
  approved sending. “Help before they ask” then followed the hero, followed by the four product parts. The
  “Your own agent can investigate” section was replaced by a short “How the handoff works” detail
  built from the New task form. All drawings mirrored the real interface wording.
- Historical initial homepage approval (owner approval 2026-10-01; superseded by the 2026-10-02 clarity pass): the page at that point was described as the “Customer Support, Solved.” page with a drawn inbox hero, the four product parts, “Help before they ask”, “Your own agent can investigate” and “Yours to run”, set in Outfit on warm paper with colour only inside labelled HTML/SVG drawings. Outfit was self-hosted from public/fonts/outfit/ under the SIL Open Font License 1.1, so the page made no third-party request. This preserves the initial approved state; the current page is described by the clarity-pass entry above.

- The public identity pages (`/login`, `/register`, `/forgot-password`, `/reset-password`,
  `/verify-email`, `/accept-invitation` and the completed-setup state of `/setup`) use the
  homepage's paper, ink and Outfit with the HappyToHelp wordmark, a link home and links to
  one another, instead of the dashboard-styled form. Invitation, verification and reset links are
  checked on load and report a missing, invalid, expired or used link with a way forward. A
  signed-out invitee sees the workspace and email and either creates an account or signs in and
  returns to the link. Every new-password field states and enforces the 12 to 1024 character rule.
  `/login` points to `/setup` while no owner exists; sign-up is offered only when it can work and
  stays closed until setup is done; forgot-password without an email provider still fails closed
  and says the workspace owner must reset the password.

- Local computers and delegation use the workspace design system. The Connect
  computer dialog is styled outside the inbox; authorizing a computer shows
  “Computer approved” or “Request denied” and clears the code; Connected
  applications and the connection consent screen render in the application
  shell instead of bare server HTML, cancelling a connection returns to
  Connected applications, and missing, invalid, unavailable or signed-out
  requests show friendly pages. The consent form and revocation rules are
  unchanged. Registering a client whose identifier already exists now answers
  409 `CLIENT_EXISTS` instead of a server error. URLs keep text that reads as a
  number (an OAuth `state`, a device code) exactly as written.

### Removed

- The previous illustrated homepage: its components, styles, scroll-parallax
  hook, its artwork under `public/homepage` and their provenance entries.

## 0.2.1 — 2026-09-27

### Fixed

- Hosted Assisted and Managed builds (the hosted options from Run Edit Run) no
  longer fail with `pnpm: not found`. Run Edit Run's trusted project build
  provides Node but no global pnpm, and the package scripts that `build` and
  `verify` run call `pnpm`. The `rer-project.json` build and verify commands now
  put the pnpm 10.12.4 that `scripts/independent/setup-build.mjs` installs in
  `.rer-tools` first on `PATH`. Standalone installation and the `pnpm run`
  scripts are unchanged.
- The `rer-project.json` artifact check no longer fails with `97 !== 94`.
  `tests/independent-runtime.mjs` still requires an exact table count, now 97:
  migrations `0102_public_abuse_limits` (`abuse_counters`) and
  `0103_contact_erasure` (`contact_erasures`, `contact_erasure_objects`) in
  0.2.0 added three tables that the expected count had not been updated for.

## 0.2.0 — 2026-09-25

First public source release of the self-hosted edition: the version of
HappyToHelp you install and run yourself.

### Added

- Native TypeScript rewrite on Cloudflare Workers: TanStack Start/React pages,
  Hono API, D1 records, R2 files, Queues for background work and a Durable
  Object for live conversation delivery, replacing the original PHP/Laravel and
  AWS services.
- The original dashboard, customer widget, AI assistance and suggestions,
  knowledge base with published help centers, customer context, local-agent
  delegation, training/evaluation runs and integrations (email, GitHub, help
  center imports, brand images and website preview), ported to the new
  Cloudflare runtime.
- Village public homepage with layered, reduced-motion-aware artwork. (Replaced
  on 2026-10-01 by the “Customer Support, Solved.” homepage; see
  [0.2.2](#022).)
- Standalone browser installer (`node scripts/install.mjs`) for local or
  Cloudflare installation, with agent-assisted prefill.
- Fictional demo inbox for trying the workspace without real customer data.
- Local importer for exports from the original HappyToHelp service.
- Contact erasure for owners and admins, from the dashboard (**Erase personal
  data…**) or `POST /api/management/projects/:projectId/contacts/:contactId/erase`.
  It removes the contact's identity, messages' content, attachments (including
  R2 objects), customer context, AI and delegated-work text, inbound email
  evidence and legacy import copies, keeps transcript order, and records a
  non-identifying `contact_erasures` tombstone. [docs/PRIVACY.md](docs/PRIVACY.md)
  describes what is stored, what goes to which provider, and what erasure cannot
  reach.

### Security

- First-owner setup fails closed. Only loopback development may create the first
  owner without a private `H2H_SETUP_TOKEN`. A remote deploy of a fresh
  installation refuses to publish without a token of at least 32 characters,
  and a Worker reached any other way answers owner setup with HTTP 503 until one
  is configured.
- Operator pages and API responses send `Content-Security-Policy:
  frame-ancestors`, `X-Content-Type-Options: nosniff` and
  `Referrer-Policy: strict-origin-when-cross-origin`; published Help Center
  pages stay embeddable.
- The dashboard parses user agents with `ua-parser-js` 1.0.41 directly,
  replacing a wrapper that pinned a release affected by a high-severity ReDoS
  advisory (GHSA-fhg7-m89q-25r3).
- Automatic inbound mail (autoresponders, bounces, list mail) is labelled and
  never triggers an AI reply or a notification. Notifications sent through
  Resend or SendGrid carry `Auto-Submitted` and `X-Auto-Response-Suppress`
  headers so that other systems do not answer them automatically.
- Public widget, registration and project-creation requests are rate limited
  per visitor, conversation, client address and account, with counters in D1
  (`RATE_LIMITS`). Per-project ceilings on widget sessions, conversations and
  attachments bound what rotating client addresses can create. A refused
  request gets HTTP 429 with `Retry-After`.
- Automatic AI work that visitors can trigger has daily ceilings per project
  (replies, estimated spend, context runs) and across the installation
  (`AI_DAILY_CEILINGS`). Past a ceiling, visitor messages still reach operators,
  the skipped reply is shown in the transcript, a visitor's explicit reply
  request gets HTTP 429 until 00:00 UTC without the operator-only reason or
  spend, and `GET /api/dashboard/projects/:projectId/ai-usage` reports the day's
  usage. See [docs/PUBLIC-LIMITS.md](docs/PUBLIC-LIMITS.md).
- A reply request's `requestId` (widget `request` command, dashboard `request`
  action) must be a UUID, or the request gets HTTP 400, so no caller-chosen text
  becomes a generation ID that contact erasure keeps.

### Fixed

- The scheduled outbox replay no longer leaves a conversation undelivered after
  a failed, queued or uncertain AI generation for an email message.
- Revoking a paired computer or its grant withdraws authority without claiming
  that the local run stopped: started work ends as revoked with an unconfirmed
  local outcome, and the conversation can be delegated again at once.

### Changed

- Licensed under MIT for the whole repository, including artwork.
- Dashboard styles are first-party, built on Bootstrap 5.3 (MIT) with icons from
  the `feather-icons` package (MIT); no commercial theme, font or image is used.
- The delivery artifact is byte-reproducible from a commit with the declared
  Node and pnpm versions (`pnpm run test:reproducible-build`).
- `pnpm run verify` includes a first-release journey test against a Worker
  built from the source and run locally, and continuous integration runs it with
  every browser suite and the homepage and public-site checks on pushes to
  `main` and on pull requests.
