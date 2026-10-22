# HappyToHelp product contract

Target edition · 17 October 2026 · US-first, USD. HappyToHelp is a complete customer service help desk and AI support agent for a US SMB support lead switching from Zendesk, Intercom (with Fin), Help Scout or Freshdesk. It owns the job from customer intake through a shared operational queue, self-service and live business context to an authorized resolution and continued customer recovery. Decagon, Sierra and Pylon set the agent/procedure and B2B-channel baseline; the target goes further with verified repair and obligations that survive handoffs.

This is the product we are building towards. Required behavior is not a claim of current implementation, provider acceptance or compliance. The final table records current code/test coverage as done, partial or missing; each clause names the public journey that will prove it. The matching evidence map is [ACCEPTANCE.md](ACCEPTANCE.md). A cited test is implementation evidence, not a claim that it was executed for this document change.

Keep the owner-approved homepage, UI and behavior intact. The retained owner decisions of 8 October (native passwords), 9 October (import equality and bounded ordinary HTTPS transport) and the detailed PUBLIC-001 specification remain in force. This contract expansion authorizes future build rounds against the missing work; it does not silently change today's marketing claims. The product remains editable source on Cloudflare Workers with a separately authorized local connector, run through `rer`.

## Product target

HappyToHelp is the complete help desk and AI support agent a US SMB support lead buys instead of Zendesk, Intercom (with Fin), Help Scout or Freshdesk; Decagon, Sierra and Pylon set the agent and procedure baseline it must also meet.

| | |
| --- | --- |
| Category | Customer service help desks and AI support agents |
| Incumbents a buyer switches from | Zendesk, Intercom (with Fin), Help Scout, Freshdesk (agent baseline: Decagon, Sierra, Pylon) |
| First buyer | A US SMB support lead, costs in USD, moving a Zendesk, Intercom, Help Scout or Freshdesk help desk |

## Retained product and operating guarantees

- **NATIVE-001 — Native owner installation.** A clean owner can inspect the
  operating description before installing dependencies, install locked source,
  prepare local or selected remote bindings/migrations, build, verify and deploy
  through `rer`. Local setup exits with no app running; dev
  prints a private `RER_OPEN` address that enters as the real local owner through
  the rer dev v2 boundary, preserving native sessions, roles and passwords.
  Reset is explicitly confirmed and local;
  export/import preserve supported native data with documented exclusions.
  Deployment dry-run makes no provider requests. The delivered runtime requires no original checkout or PHP service.

  **Acceptance evidence:** Use a clean checkout through rer describe/check, locked installation, setup, dev, verify, reset, export/import and deployment dry-run; preserve owner/data/settings and refuse unconfirmed destructive work. Prove the runtime works independently of the original checkout; separately qualify remote provisioning.

- **IDENTITY-002 — Retained native password identity (owner decision 2026-10-08).** Preserve native password sign-in, first-owner setup, the accepted owner
  experience and prior account/workspace data with the maintained Base command mechanisms. Retain this edition's authentication and native owner setup. Existing tenant and permission checks
  continue to govern every session. A second factor for these native accounts is required by IDENTITY-003; it adds to native passwords and never replaces them.

  **Acceptance evidence:** Complete native password setup, login, recovery and workspace re-entry, then upgrade with prior owner credentials and data intact; configured providers must not replace native identity.

- **IDENTITY-001 — Scoped authority.** Owner setup, registration, login/recovery,
  project switching, membership and widget admission establish native identity.
  Every private read/write enforces the current actor/project/role; blocked or
  deleted projects and revoked credentials lose access. Provider configuration
  never substitutes for user authority. The public widget key and origin are not
  a secret: visitor, registration and project-creation requests are bounded by
  D1-backed limits (`RATE_LIMITS`) and refused with HTTP 429 and `Retry-After`.

  **Acceptance evidence:** Through native session and widget routes, deny cross-tenant, blocked/deleted and revoked access; prove public admission returns 429 with Retry-After when limited and provider configuration conveys no actor authority.

- **FIRST-RUN-001 — A useful first workspace.** First-run setup is one screen: the
  owner's email, a password, the website and, only where the server requires one,
  the private setup token. Missing names and colors are derived and every derived
  value can be changed. A completed installation leads the owner to a workspace that
  is already set up, whose Setup page lists only what cannot be done for them (an
  AI service key, the widget on their website and, with a hosted email provider, a
  verified sending domain), leads with the widget, lets the owner skip any of
  them for now, and shows everything else under "What we've set". Every workspace created by first-owner setup, signed-in
  workspace creation or email-verified registration, and never a demo workspace,
  is provisioned in one step: a starter
  assistant as its default visitor assistant, a reply-by-email mailbox when the
  installation holds `INBOUND_EMAIL_TOKEN`, and mail sent from the installation
  sender until the workspace's own domain is verified. The starter assistant answers
  visitors by itself once a provider key exists, within the daily AI ceilings; with
  no key no assistant is assigned to a new conversation, it stays with the team and
  the AI page and Setup say a key is missing. The first-run Create workspace action
  may send one welcome email to the owner; an uncertain send is never replayed.
  Ordinary workspace creation leads with the widget snippet; Advanced retains the
  server secret and verification examples. Empty inboxes offer installation, a link to
  Setup and a demo. Workspace headers follow workspace switching.
  Visitor headers retain the operator's display name.

  **Acceptance evidence:** Run fresh first-owner setup and signed-in workspace creation to Setup and an installable widget; inspect derived editable name/color, starter assistant, mailbox/sender, skip/Advanced controls and mobile headers. With no model key a new visitor stays with the team; with a configured provider exercise the capped starter. A workers.dev hostname must not become a business name.

- **LOCAL-MAIL-001 — Rer dev mail.** Trusted local development configuration
  uses the rer dev v2 development transport: it validates and suppresses visitor
  and teammate mail, reports `development`, stores no messages and exposes no mail viewer.
  It sends no external email and never claims delivery. The local
  owner enters automatically through the dev boundary; native password identity,
  ordinary hosted email-link confirmation and prior stored data are retained.
  Production has no local dev surface. Missing credentials or failed remote
  delivery never select a local substitute.

  **Acceptance evidence:** Enter through rer dev v2; send visitor and teammate mail and prove development suppression without storage, viewer or external send; refuse forged and production dev entry and never substitute suppression for a failed hosted provider.

- **CONVERSATION-001 — Durable transcript.** Customer, operator, generation,
  import and administrative writers preserve stable message/command identity,
  revision/frontier, attachment ownership and final-reply admission atomically.
  Competing or repeated writes cannot admit two incompatible final replies.
  Owner/admin contact erasure removes message content while keeping identity,
  revision and frontier, so erased transcripts stay coherent.

  **Acceptance evidence:** Race visitor, operator, model and import writers through conversation routes with duplicate and lost responses; admit only compatible final replies. Erase a contact through the owner door and verify coherent identity/revision/frontier with content removed.

- **DELIVERY-001 — Live delivery and recovery.** Persist before broadcast;
  reconnect/outbox replay and socket authorization recover committed messages
  after reload, disconnection or process wake. Provisional AI deltas never become
  durable final answers until guarded admission succeeds.

  **Acceptance evidence:** Disconnect/reconnect widget and operator sockets after persisted writes, restart the runtime and recover the same committed messages/attachments; unauthorized replay is denied and superseded AI deltas never become final replies.

- **UI-001 — Existing editable experience.** Reuse the original React dashboard,
  transcripts/drafts/suggestions, settings and Shadow DOM widget; preserve useful
  desktop/mobile flows, attachment display, collector/privacy controls and errors.
  Native routing and transport use the configured application origin.

  **Acceptance evidence:** Use the native dashboard and separately installed widget at 1440 and 390 pixels with realistic conversations, attachments, drafts, errors and workspace switching; retain the approved desktop/mobile navigation and configured-origin transport.

- **MOVE-IN-001 — Reviewed history import.** Current workspace owner/admin
  reviewers privately upload, inspect per-kind plans, source-located omissions,
  rejections, conflicts and publication changes, then explicitly apply bounded,
  resumable imports of conversations, contacts, tags, saved replies and articles.
  Preserve source identities, timestamps, private notes and publication state;
  reject unsupported meaning rather than inventing it. Recheck current role and
  workspace authority for apply, resume and whole-import undo. Retain immutable
  source custody and conflict-safe reversal journals. Imports and undo send no
  mail, widget messages, model requests, assignment or connection notifications;
  imports are excluded from Reports. Native tag controls enforce workspace scope.
  Owner decision 2026-10-09 requires exact business-state repeat/undo equality,
  including contacts, conversations, messages, private notes, tags, source links
  and every other imported business table. Only platform counters/sequences,
  audit history and import journals are excluded. Synthetic 1,000-conversation
  datasets for Zendesk and Help Scout qualify this local flow.

  **Acceptance evidence:** Through Move in, exercise all five kinds, source custody, per-row omissions/rejections/conflicts, current-role denials, inert apply/resume/repeat/undo and exact business-state equality for synthetic 1,000-conversation Zendesk and Help Scout datasets; counters/sequences, audit and journals are the only named exclusions.

- **OUTCOMES-001 — Resolution feedback and provenance.** Current original visitor
  sessions may rate a closed resolution with thumbs up/down and an optional
  comment up to 1,000 characters. Changes retain history; reopened cycles cannot
  receive the previous resolution's rating. Operators retain access to each past
  resolution's latest feedback after reopening; visitor eligibility and report
  denominators remain tied to the current cycle. Erasure removes rating comments.
  Confirmed operator-sent drafts establish assisted outcomes, otherwise confirmed
  human replies establish human outcomes. AI requires a complete visible answer
  history without a person handoff; missing evidence remains unknown. Status,
  assignment and cancellation transitions recheck current authority atomically.

  **Acceptance evidence:** Close, rate, rerate, reopen and close again via widget/operator routes; prevent previous-session/cycle feedback, retain old-cycle operator visibility, redact erased comments and verify human/assisted/AI/unknown attribution from actual visible answers.

- **REPORTS-001 — Workspace calendar reports.** Native conversations created in
  the workspace IANA calendar range with at least one persisted message form the cohort; Move in and legacy imports
  are excluded. First visitor-to-visible-answer response and creation-to-first
  known-resolution durations use median and nearest-rank p90. Each conversation
  contributes its latest closed cycle once to outcome and satisfaction rates.
  Reopened conversations leave those denominators. Aggregate queries return
  bounded data; CSV streams every matching conversation with formula-safe cells.
  Empty widget conversations stay durable but are excluded from Reports and its
  analytics CSVs. A separate step-up guarded JSON export includes all workspace
  conversations, messages, private notes and attachment names across dates and imports;
  attachment bytes stay in the portable backup.

  **Acceptance evidence:** Compare Reports and formula-safe CSV to hand-calculated response/resolution median and p90, latest-cycle outcome and satisfaction cohorts across DST and tenants, including more than 10,000 rows and excluded imports/reopened cycles.

- **CONNECTIONS-001 — Workspace integrations.** Owner/admin tokens have explicit
  scopes, optional expiry, one-time display, hashed storage and durable audit.
  Bearer-only API calls have no CORS, per-token limits and native guarded writes.
  Contact erasure fences API identity restoration and pending event payloads.
  Native events commit tenant-bound webhook and Slack intents; historical import
  apply and undo do not emit them. Slack projects bounded native visitor text
  through Base escaping. Base owns signing, durable attempts and retry policy.
  HTTP 500 stays uncertain and is not replayed; 429 retains bounded retries.
  **Scoped edition override, owner decision 2026-10-09:** this consumer uses
  ordinary platform HTTPS fetch through the unchanged Base wire interface. It
  refuses every 3xx with manual redirect handling, enforces a 10-second timeout,
  a 1 MiB request limit and 64 KiB streamed-response limit. Destination syntax
  and literal IP validation remain enforced. This expressly overrides Base's
  transport DNS-pinning requirement for this edition; it does not claim DNS
  pinning or change copied Base contracts. Local synthetic protocol checks do
  not establish a live Slack connection or hosted installation.

  **Acceptance evidence:** Issue, use, expire and revoke each scoped show-once token; exercise native API operations, erasure fences, signed events and Slack escaping. Refuse redirects/unsafe literal destinations and over-limit traffic; preserve timeout, streamed bounds, uncertain 500 without replay and bounded 429 behavior under the recorded HTTPS override.

- **ACTIVATION-001 — Observed owner setup.** An owner sees the durable,
  project-scoped eight-step list on the Setup page; the genuinely empty inbox
  shows one next action and a link to it, and loads none of it. A
  step is confirmed only by an observation, never by a saved configuration, an
  installer default or a preset, so a workspace with nothing observed yet is zero
  of its applicable steps. The system runs its own checks: while an owner is signed
  in the page asks the server to observe, bounded by freshness windows. These
  checks are non-generative metadata, domain and DNS reads and never send mail.
  They distinguish saved configuration from observed sender DNS, authenticated
  model metadata, an inbound receipt, effective runtime ceilings, allowed origin
  and an authenticated widget ping; whether an article is published is not one of
  them (that step stays among the eight ids but is hidden and never counted). Mail to the owner
  is confirmed by a used emailed sign-in link, or by the provider's reported outcome
  for the welcome or test email; local development mail is suppressed and never
  confirms delivery, and provider acceptance or queueing is pending. `GET` performs no
  provider work and writes nothing. Only an explicit owner action (Create
  workspace, or Send me a test) may send mail, to that owner's mailbox, with
  durable identity; ambiguous work is never replayed. Missing provider permissions
  and unsupported status APIs remain unavailable. Configuration changes invalidate
  observations; model and DNS validation expire after 15 minutes and every
  observation shows its time. The owner can skip an owner-only step (the widget,
  the AI service, the sending domain) for now, and undo it. A skip is stored on the
  server for the workspace, can be made by an owner or admin only, makes no provider
  request, and moves the step out of Needs you and out of the confirmed count and its
  total; a skipped step is never shown as confirmed. An observation always wins: a
  skipped step that is later observed is confirmed and counted, and a rejected
  provider key stays under Needs you whether or not it was skipped. Provider keys and
  their fingerprints never enter API responses or browser storage.

  **Acceptance evidence:** Read Setup without side effects, observe fresh/expired/rejected configuration and explicit provider outcomes, skip/undo owner steps and reload. A skip or preset never counts as confirmation; local suppression never proves delivery; keys/fingerprints remain server-only and uncertain explicit test/welcome mail is never replayed.

- **AI-001 — Configured model execution.** Retain Ensemble model selection,
  context/tools, streamed events, normalization, raw per-round provider usage,
  attribution, bounded suggestions and reply lifecycle. Missing providers fail
  explicitly when AI is asked for, and a default assistant whose provider has no
  key is simply not assigned to new conversations; uncertain provider attempts
  remain uncertain and are not replayed automatically. Usage is diagnostic/provider accounting data, not an active
  payment, balance or debit system. Visitor-caused automatic AI work is capped per
  UTC day per project and installation (`AI_DAILY_CEILINGS`); a skipped reply is
  recorded as terminal and never replayed.

  **Acceptance evidence:** Request configured suggestions/replies through native routes; inspect normalized streaming events, per-round usage, context/tool and budget bounds, explicit missing-provider errors and durable daily-cap skips; crash/ambiguous attempts must not automatically replay.

- **KNOWLEDGE-001 — Published knowledge.** Dataset ingestion/crawl, retained
  corpus, lexical/selected semantic retrieval, citations and article/category
  authoring maintain project scope and publication state. A failed refresh cannot
  replace the last usable published corpus. Public pages exclude drafts/deleted
  projects and preserve original canonical article/search routes.

  **Acceptance evidence:** Publish and search articles/categories through authoring and public help-center doors; deny draft/deleted/cross-project access, verify citations and canonical links and retain the last usable published corpus after a failed refresh.

- **CONTEXT-001 — Attributed customer context.** Profiles, monitoring, insights
  and context packets preserve evidence attribution, source bounds, consent and
  project ownership. Provider output must satisfy the selected schemas before
  becoming usable customer context.

  **Acceptance evidence:** Generate/read profile, monitoring, insight and context packets through native routes; reject ungrounded/schema-invalid or cross-project content, preserve attributed evidence and respect consent/source bounds.

- **DELEGATION-001 — Explicit local authority.** Pairing, devices/grants,
  revocation, tool context and work/result states preserve investigation, resolve
  and advance-authorized resolve-and-reply distinctions. Revocation withdraws
  authority and never asserts that a local process stopped: started work becomes
  terminal with an unconfirmed outcome, and only the device may report cancellation.
  Local processes remain in the optional connector, never an implicit Worker capability.

  **Acceptance evidence:** Pair the packaged connector, investigate, separately authorize a child fix, obtain a distinct read-only observation and use human Send with exact-request replay. Refuse stale/revoked/offline/unverified/uncertain work and distinguish resolve from advance-authorized resolve-and-reply; revocation cannot assert process cancellation.

- **TRAINING-001 — Durable evaluation.** Training and evaluation preserve run/case
  state, model/budget selection, raw provider usage and cancellation/recovery.
  Synthetic data admission is explicitly local/test-only. Historical pending
  attempts require reconciliation; a fixture pass is not live-provider quality
  acceptance.

  **Acceptance evidence:** Create, run, cancel and recover persisted evaluations through training routes with model/budget selection and raw usage; reconcile historical pending/uncertain attempts and keep synthetic admission local/test-only, with live quality qualification separate.

- **INTEGRATION-001 — Honest external effects.** Email/inbound mail, GitHub,
  branding and knowledge imports use configured native adapters, tenant-scoped
  credentials, durable identity and ambiguous-outcome handling. Website previews
  use a separate origin, scoped expiring grants and public-network restrictions.
  Machine-generated inbound mail never triggers autonomous AI replies,
  notifications or outbound email; its classification is recorded before
  admission and survives recovery and redelivery. The `email:` message local-id
  prefix is reserved for inbound claims and refused by the message API.
  Shopify, Stripe and CRM support actions are required by COMMERCE-001, BILLING-001 and CRM-001. HappyToHelp never holds funds or becomes a payment processor; historical imported balances remain custody records, not executable authority.

  **Acceptance evidence:** Use configured email, inbound mail, GitHub and knowledge-import public doors; test idempotency, machine-generated-mail suppression, separate-origin preview grants and network denial. An operator reply emails the visitor even with an online/unverified widget; a visitor address matching the reply sender is intentionally excluded and the message status explains that cause. Test accepted, failed and uncertain outcomes without invented delivery; business-action evidence is also required by COMMERCE-001, BILLING-001 and CRM-001.

- **PUBLIC-001 — Public product source.** The approved
  homepage (owner approval 2026-10-01, clarity pass 2026-10-02, hero redesign
  2026-10-08, hero leading with help before they ask 2026-10-20) is the real public `/` experience, in
  this order: the hero, whose headline “Knows what your customer needs before they do.” stands left-aligned beside one
  hand-drawn picture of both moments on a pale aqua blob, joined by an aqua pen arrow: 1, a checkout page in its window
  with the widget's offer card (signed with the speech-bubble mark) floating over its corner; 2, a conversation already
  solved (a customer, Maya, cannot turn on the Spanish version of her store; the agent's fix, beside a code glyph, says
  it is fixed; the reply to Maya carries Send inside it, the only step left), each numbered on a filled aqua disc; with
  the subhead “Some customers who get stuck never write in. They just leave.”, the line
  “100% free, open source alternative to Zendesk, Intercom, Help Scout and Freshdesk”, an aqua pen-stroke flourish under the calls to
  action that draws itself in once, and under the picture the captions “Before they ask” (“When someone seems stuck,
  the widget offers a hand.”) and “When they ask” (“Your Codex or Claude fixes the problem and writes the reply. You
  press Send.”) on filled aqua number discs; “Not just better. Free.” (100% free and
  open source, free as in code and free as in cost, MIT licensed, “No seats. No
  plans. No fees.”, each promise after a line icon in a pale aqua circle, with the MIT license drawn as an ink card
  over a wordless code editor, “free of charge” and the rights highlighted in aqua);
  “The rest of your support desk” (chat widget, shared inbox, help center, suggested
  replies, as frameless ink cards numbered on filled aqua discs); “Try it beside what you have” (install, bring the
  help center from Zendesk, Intercom or Freshdesk, add the chat widget, on filled aqua discs, beside the finished
  import in its window); “Ready when you are.”, a big closing headline with an aqua pen line drawn under it;
  and the footer, signed with the header's lockup. Below the hero the drawings carry the hero's language: each
  floats on a pale aqua blob, the mark's three aqua sparks spring from the corner of four of its cards, a window
  frame stays only for the code editor, the checkout and the import, the text links carry the hero's aqua
  underline, and a full-width aqua pen line with one loop divides Free from the desk and the desk
  from Try it beside what you have. The page carries no price, hosting or provider line and no plug for any other service.
  The drawings mirror the real interface and make no claim the product cannot
  back; conversation, ticket-history and automation import, reporting and
  compliance claims are deliberately absent. It is a warm off-white page in one geometric sans-serif
  (Outfit, self-hosted from `public/fonts/outfit/`, so the page makes no
  third-party request, over a metric-matched local fallback, so no text moves
  when it loads) with near-black ink and black pill buttons; color
  appears only inside the drawings, which are labeled HTML/SVG rather than raster images,
  and in aqua accents outside them (the hero's and the desk's number discs, the promises' circles, link underlines, the
  hero flourish, the dividers, the closing line) and in the sparks of the speech-bubble mark beside the header and
  footer wordmark. The wordmark is not set in Outfit: it is drawn by hand as round-capped SVG strokes following
  Nunito's letter shapes (SIL OFL), with no font data embedded, and the link it sits in is named HappyToHelp by
  visually hidden text. The page's text
  and real links, derived from `package.json` `repository.url`, are ordinary DOM
  content; the hero flourish draws in once as the page appears, and each moment below the hero (a drawing, the
  promises, the steps, a desk card, a divider, the closing line) plays once, in under 1.8s, as it scrolls into view
  (an IntersectionObserver), moving only opacity, transforms, clipping and strokes, so nothing shifts; reduced-motion
  preferences remove all animation, transitions and smooth scrolling without
  changing layout, leaving every drawing in its final state and every stroke fully drawn. `/docs` renders, at build
  time, the Markdown files listed in `docs/site.json`, in the homepage's paper,
  ink and Outfit, with section navigation, page contents and GitHub links for
  everything unpublished; an unknown page gets the branded 404. Every build
  renders the current files, and an unlisted Markdown file fails verification. Dynamic published
  help centers retain project scope, canonical links, search and draft/deleted denial. The customer widget
  remains available through owner-configured installation; broader marketing
  routes, pricing, legal, referrer, waitlist and public auto-widget behavior
  are outside this edition.

  **Acceptance evidence:** Exercise the approved homepage and /docs requirements retained in this clause and the detailed acceptance specification at desktop/mobile, including keyboard/reduced motion, published Markdown manifest/link validation and draft/deleted help-center denial; target requirements do not authorize changed marketing claims.

- **MIGRATION-001 — Prior-data custody.** Explicit legacy artifacts preserve IDs,
  exact historical financial values, transcripts, object hashes, publication and
  permissions through resumable guarded D1/R2 import. Historical financial SQL,
  imported rows and reconciliation holds remain immutable archive custody; they
  never become active payments, balances or provider work. The one exception is an
  explicit owner/admin contact erasure: it takes precedence over archive custody for
  that contact's personal data and redacts the imported rows and their verbatim
  archive copies (row digests are kept, so replaying the bundle does not restore
  them), leaving a `contact_erasures` audit tombstone. Old credentials do not
  become trusted native authority.

  **Acceptance evidence:** Import representative legacy IDs, permissions, exact historical financial values and media hashes through local D1/R2; resume safely and refuse conflicts without external work. Erase an imported contact and prove archive redaction plus tombstone/digest fencing prevents restoration of erased personal data.

- **SOURCE-001 — Author-owned capability graph.** The edition selects maintained
  source with inspect/check/lock/release commands. Shared capabilities include
  substantial implementation, migrations and meaningful tests; a second consumer
  preserves its own policy. Release excludes credentials/private fixtures and
  retains asset provenance/licensing obligations. Original work is preserved.

  **Acceptance evidence:** Run inspect/lock/check and offline Base-copy verification on staged intentional source, exercise origin/drift/mode refusals and release only the selected licensed tree without credentials or private fixtures; source custody alone is not product acceptance.


## Target clauses

### Complete support operations

- **DESK-001 — The shared support desk.** A visitor starts website live chat, identifies themselves under the workspace policy, sends files and returns to their history. Humans see one durable shared inbox with customer history, scoped retained-history search with words, quoted phrases and literal customer-identity matching, open/closed/mine/unassigned/AI/tag filters and saved replies that insert into the composer without silently sending. Ticket status follows the STATUS-001 lifecycle and saved replies extend to MACRO-001 action macros. Replies, attachment downloads and errors are visible on both sides; privacy/collector controls remain effective.

  **Acceptance evidence:** Through the installed widget and operator inbox, exchange messages and real attachment bytes, search/filter the resulting queue, insert and edit a saved reply, reload both sides and deny another tenant the same records.

- **WIDGET-001 — Availability-aware messenger and proactive messages.** The messenger shows team availability from business-hour schedules (SLA-001) and live agent presence. When no human or permitted AI assistant is available it says so with the expected reply time, captures the visitor's email (or, where consented, SMS/WhatsApp under CHANNELS-001) so the answer reaches them, and creates the ticket instead of leaving the visitor waiting. Leads configure proactive messages triggered by page URL, time on page, scroll depth, exit intent, visitor attributes, returning visit or cart value, with audience, brand, frequency caps and quiet hours. Each proactive message shows a clear sender identity and an easy dismiss, respects consent and collector settings, and never starts a conversation that sends personal data on the visitor's behalf. Impressions, opens, dismissals and resulting conversations and resolutions are reported. This clause backs the homepage hero's "Before they ask".

  **Acceptance evidence:** Outside configured hours, open the installed widget, see the offline message and expected reply time, leave an email and verify the ticket and the emailed answer. During hours with no agent online verify the same; with an available AI assistant verify it answers and discloses itself. Configure a proactive message on a checkout URL after 20 seconds with a once-per-day cap; verify it appears once, dismisses, stays silent under a declined collector setting and appears in reports with its impressions and conversations.

- **MAIL-001 — Complete support email.** Connect inbound forwarding, an IMAP/SMTP mailbox, Gmail/Google Workspace or Microsoft 365/Outlook using scoped credentials/OAuth. New mail creates tickets and replies thread by stable Message-ID/In-Reply-To/References with deliberate handling of changed subject, aliases and multiple recipients. Operators manage CC/BCC, attachments, signatures and branded sender/reply addresses. Duplicate/redelivered mail, bounces, spam and auto-responders cannot create loops or send twice, and mail classified as spam or failing sender checks goes to the reviewable Suspended view of MAIL-002; reconnect/backfill has a visible cursor and errors, and removal stops new intake without deleting history.

  **Acceptance evidence:** For each of forwarding, IMAP, Gmail and Microsoft 365, use the connection UI and real provider test accounts to receive a new thread, reply from the inbox, receive its follow-up and attachment, disconnect/reconnect with redelivery and observe bounce/permission failure. Verify no duplicate ticket/reply or machine-mail AI loop; keep provider-protocol tests separate from live acceptance. Spam and failing-sender mail reaches the MAIL-002 Suspended view, not a ticket.

- **MAIL-002 — Reviewable suspended and spam mail.** Inbound mail that is spam-scored, fails DMARC/SPF/DKIM or alignment, comes from a blocked sender or domain, forges a verified customer's address, exceeds size limits or is a detected mail loop is never silently dropped. It lands in a Suspended view with its reason, authentication results, headers and safely previewed attachments, and creates no ticket, AI work, acknowledgment or notification. Permitted operators recover a false positive into a normal ticket that threads correctly (into the existing ticket when its references match) without retroactively triggering acknowledgments or AI unless they choose to; delete true spam; and block or allow a sender or domain. Recovery, deletion and list changes are audited. Suspended mail is kept for a stated retention period (default 14 days) and then explicitly deleted with an audit record; the view shows counts and the oldest age so nothing ages out unseen. Allow/block lists and suspension reasons are reportable.

  **Acceptance evidence:** Through real inbound doors deliver a spam-scored message, a DMARC-failing message, mail from a blocked sender and a forged From of a known customer; verify each appears in Suspended with its reason and creates no ticket, AI request or outbound mail. Recover the DMARC-failing message into a new ticket and another into its existing thread, delete the spam, allow-list a sender and redeliver. Advance the clock past retention at the runtime edge and verify explicit, audited deletion; refuse every action to a role without permission.

- **OUTBOUND-001 — Agent-created and proactive tickets.** From the inbox an operator creates a ticket for an existing or new contact: search by name, email or phone or create the contact inline under CUSTOMER-001 identity rules; choose brand, sender address, channel, form, fields, assignee and group; and make the first comment public or an internal note. A public first comment is sent as an outbound email, or, where the customer consented, as an approved SMS/WhatsApp template under CHANNELS-001. The customer is recorded as requester and the operator as submitter, and the customer's reply threads into the same ticket. Logging a phone call or walk-in creates a ticket without contacting the customer. Proactive service notices to several customers (for example a delayed order) create one ticket per requester with a preview, consent checks and rate limits, never send twice on retry and remain distinct from marketing campaigns, which belong to Mango.

  **Acceptance evidence:** From the inbox create a ticket for an existing contact and one for a new contact, send the first public email, reply as each customer from a real mailbox and confirm the reply threads into the created ticket with requester and submitter attribution. Create an internal-only ticket (no send), a WhatsApp-template ticket to an opted-in number and one to an opted-out number (refused), and a proactive notice to three contacts with one failed send; verify no duplicate send on retry and refusal for an operator without create authority.

- **CHANNELS-001 — Messaging and social support.** Connect US SMS through Twilio and WhatsApp Business, Instagram Direct and Facebook Messenger through authorized Meta business accounts. Inbound messages, supported media, delivery states and channel identity enter the shared inbox; replies return in the original channel. Respect consent, opt-out, A2P 10DLC registration, approved WhatsApp templates and channel reply windows; an expired window becomes an actionable blocker with an approved continuation, never silent loss or unauthorized cross-channel contact.

  **Acceptance evidence:** Using each connected provider account, exchange a customer message/media and operator reply in one mapped conversation, redeliver a signed event, revoke the connection and exercise opt-out and expired-window/template refusal with visible delivery failure and no duplicate send.

- **CHANNELS-002 — B2B shared-channel support.** Slack Connect and Microsoft Teams customer channels become authorized support intake, with thread replies, attachments, requester/account mapping and internal/private separation. The team can acknowledge, assign and hand off from Slack/Teams while the canonical support record retains the thread and current status. Installed-channel permissions, edited/deleted events, duplicates and disconnected channels have explicit behavior; Slack notifications alone do not satisfy this clause.

  **Acceptance evidence:** Install scoped Slack and Teams apps, open support threads from allowed customer channels, reply and assign from both surfaces and observe bidirectional updates/reconnect. A private note, disallowed channel or revoked workspace must never leak into customer channels.

- **VOICE-001 — Telephone service and unified voice agent.** Connect Aircall and Twilio Voice numbers for inbound/outbound customer support, business-hours routing, IVR, queues, transfers, voicemail and missed-call follow-up. Calls, consented recordings/transcripts and summaries attach to the customer conversation. The same governed AI procedures can serve voice, email and chat, with immediate human transfer and visible failed transfers; disclose automated agents and obtain recording consent under the configured US jurisdiction.

  **Acceptance evidence:** Call a connected support number through IVR to an agent, transfer to a human, leave voicemail after hours and call back from the inbox; verify consent, transcript/recording access, linked history, failed-transfer escalation and erasure. Use the provider-approved emergency-calling test procedure to verify number/location routing and disclosed limitations before launch. Repeat an approved procedure across voice/chat/email and inspect one consistent authority policy.

- **QUEUE-001 — Assignment rules and available teams.** Support leads define teams, membership, skills, capacity, availability and routing rules by channel, brand, language, account, tag or priority. Route to a named owner, team, round-robin or capacity-aware queue; explain which rule won, prevent starvation and preserve fair state across restarts. Manual takeover, absent/offline assignees, reassignment and unassigned overflow always leave a visible responsible queue.

  **Acceptance evidence:** Configure two teams and a round-robin rule through settings, admit concurrent tickets through real channel routes, change availability and restart; verify ownership, fairness, overflow, explainable decisions and current-role refusal on manual takeover.

- **TRIAGE-001 — Intelligent triage.** Each new ticket and customer message is classified for intent (from a lead-editable taxonomy with US commerce and SaaS defaults), sentiment and language, with a confidence score and the quoted evidence, by the configured model within AI-001 budgets. The predictions become ticket fields that QUEUE-001 routing, SLA-001 priority, AUTOMATION-001/002 conditions, views, AGENT-001 procedure selection and reports can use. A low-confidence prediction routes to the default queue instead of guessing. Operators correct a prediction and the correction is recorded as a label; leads see accuracy per intent against those labels before enabling a prediction for routing. With no model key there is no prediction, shown as unavailable and never invented.

  **Acceptance evidence:** Enable triage and send messages with clear intents, negative sentiment and Spanish text through email and the widget; verify the fields, quoted evidence and confidence on each ticket, and that an intent routing rule and a negative-sentiment priority rule act. Send an ambiguous message (low confidence, default queue), correct a prediction and verify the accuracy report. Remove the model key and verify triage shows unavailable and routing still works.

- **QUEUE-002 — Structured and bulk queue work.** Operators manage workspace-scoped tags, typed/validated custom issue fields (including values customers submit through FORMS-001) and priorities, and statuses from the STATUS-001 lifecycle; saved views can filter and sort on them. Leads select tickets and bulk assign, tag, change priority/status or apply a permitted MACRO-001 macro with a preview, per-record authority checks and a complete partial-failure result. Bulk actions cannot publish replies or reveal another workspace accidentally.

  **Acceptance evidence:** Create a custom field and priority view, bulk-update mixed eligible/stale/forbidden tickets from the inbox and reload; verify each permitted effect, rejected reason, audit and lack of cross-tenant changes. Bulk-apply a macro and filter a view by STATUS-001 status and a form-submitted field.

- **QUEUE-003 — Collaboration without conflicting replies.** Internal notes and @mentions notify only permitted teammates; followers (internal CCs, distinct from customer CCs and never shown to the customer) receive updates under NOTIFY-001; viewing, typing and unsent-draft indicators warn of collisions before send. Guarded send still refuses stale replies. Operators save personal/shared work views and reusable replies/macros with scoped permissions; private notes and drafts never appear in customer channels, forwarding or public history.

  **Acceptance evidence:** Use two signed-in operators on the same ticket: type, mention, save a view/reply, race sends and reload. Confirm early collision warnings, one admitted final reply, scoped mention delivery and no private content in the visitor transcript. Add a follower and verify updates reach them and never the customer.

- **MACRO-001 — Action macros with placeholders.** Operators apply a personal, group or shared macro that in one action sets the reply text (public or internal note), status, priority, tags (add or remove), assignee and group, followers, custom fields and attachments. Reply text supports placeholders for the requester's name, first name and email, ticket ID, subject and link, assignee, brand, organization, and custom ticket and contact fields, with explicit fallbacks (for example first name, else "there"). Applying a macro previews every change and puts the rendered text in the composer for editing; nothing is sent until the operator sends. A placeholder that cannot be resolved is flagged and blocks sending instead of reaching the customer as a literal. Macros are versioned, permission-scoped by role, group and brand, searchable, usage-reported and applicable in bulk (QUEUE-002). AI may recommend a macro but never applies one silently.

  **Acceptance evidence:** From a ticket, apply a shared macro that sets status Pending, adds a tag, assigns a group and agent, sets a custom field and inserts a reply using the requester's first name and ticket ID; inspect the preview, edit the text, send and reload. Apply it to a requester with no name (fallback used) and with a placeholder for an absent custom field (flagged, send blocked). Verify a role without macro access cannot apply it, bulk application reports per-ticket results and the customer sees only the rendered text.

- **QUEUE-004 — Snooze and scheduled follow-up.** Snooze a ticket until an exact timezone-aware time or a dependency; incoming customer replies wake it immediately. Schedule outbound service replies, see/cancel/edit them before send and prevent stale queued replies after a customer response or reassignment. Each follow-up has a responsible owner, due time, stop condition and visible pending/failed/uncertain outcome; restarts cannot lose it or resend an ambiguous attempt.

  **Acceptance evidence:** From a ticket, snooze, schedule and cancel replies, then inject customer responses before/at the due time and restart the worker/executor. Observe a single wake/send or explicit refusal, overdue ownership and uncertainty without automatic replay.

- **STATUS-001 — Ticket status lifecycle.** Every ticket has one status from a lifecycle the lead can extend: New, Open, Pending (waiting on the customer), On-hold (waiting on an internal team or third party), Solved and Closed, plus workspace custom statuses that each map to one of those categories. A customer reply to a Pending or On-hold ticket returns it to Open and wakes its owner. On-hold and every internal status label are never shown to the customer, who sees an open request in the widget, portal and email. A customer reply to a Solved ticket reopens it. After a lead-configured period (default 4 days) a durable time-based automation (AUTOMATION-002) moves Solved to Closed, and Closed is final: a customer reply to a Closed ticket creates a new follow-up ticket linked to it that carries the requester, CCs, tags and fields. Status filters, sorts, views, bulk edits (QUEUE-002), SLA pausing (SLA-001), resolution cycles (OUTCOMES-001) and reports all use this lifecycle, and every change records its actor, time and source (person, rule, automation or customer reply).

  **Acceptance evidence:** Through the inbox, widget and email routes, move a ticket through New, Open and Pending, reply as the customer and observe Open with an owner wake. Set On-hold and read the widget, portal and email views for absence of the internal state. Solve it, reply as the customer and observe reopen; solve again, advance the clock at the runtime edge past the close period and observe Closed by automation; reply to the Closed ticket and observe a new linked follow-up ticket with the carried fields. Create a custom status in the Pending category and confirm SLA pausing and report attribution; refuse a status change by a forbidden role.

- **SLA-001 — Business-hour service commitments.** Leads configure first/next response and resolution SLAs by priority, customer plan, channel and brand, using US IANA timezones, weekly hours and holiday calendars. Show due times and pause reasons in the queue; Pending pauses customer-wait clocks and On-hold follows the policy's stated choice under the STATUS-001 lifecycle, and reopen restarts the next-response clock. Durable approaching-breach, breach and unattended-ticket alerts escalate to named backups through inbox/email/Slack/Teams and persist until acknowledged or resolved.

  **Acceptance evidence:** Configure two calendars and policies through settings; admit/reply/pause/reopen tickets across a holiday and DST boundary, restart and advance the test clock at the network/runtime edge. Compare displayed due times and breach/workload reports to hand calculations and confirm escalation/acknowledgment and no duplicate alerts. Verify Pending pauses and On-hold follows the configured policy.

- **AUTOMATION-001 — Explainable durable support workflows.** Leads version event-triggered condition/action rules (on ticket create and update) for routing, tagging, priority/status, reminders, customer updates and refund-exception escalation; actions include notifying the requester and CCs, the assignee, the group or followers (NOTIFY-001), adding an internal note and calling a signed webhook. Time-based conditions are AUTOMATION-002. Preview the effect against historical tickets in a workflow sandbox without real sends, then publish explicitly. Ordered/conflicting rules, loop prevention, owner, due time and stop condition are inspectable. Background execution persists decisions and failure/uncertainty across handoffs and restart; operators pause, cancel or reconcile work without blind retries.

  **Acceptance evidence:** Configure and simulate a route/tag/status/reminder rule through workflow settings; prove sandbox sends no external effects. Publish it, create matching/nonmatching tickets, cause a provider failure and process restart, inspect the chosen rule and terminal result and pause it before another side effect. Include a notify-assignee and a customer-update action and verify one send to the permitted recipient only.

- **AUTOMATION-002 — Time-based automations.** Leads define automations that run at least hourly over New, Open, Pending, On-hold and Solved tickets. Conditions include hours since created, updated, assigned, requester update, agent update, Pending, On-hold, Solved and SLA due, in calendar or business hours (SLA-001 schedules), combined with status, priority, tag, form, field, brand, channel and group. Actions set status, priority, tags, fields and assignee or group, add an internal note and send a templated customer or teammate notification (NOTIFY-001). An automation must include a condition its own action nullifies, or it fires at most once per ticket, so it cannot repeat; publishing one that could loop is refused. Runs are durable across restart, never replay an uncertain send, and record which automation changed what. Ready templates cover the common cases: nudge the customer after 48 business hours in Pending, auto-solve after 96, and close Solved after N days.

  **Acceptance evidence:** Through workflow settings create the Pending nudge at 48 hours and auto-solve at 96 hours and a Solved-to-Closed automation; preview them against current tickets with no side effects. Seed tickets at known times, advance the clock at the runtime edge across an hourly boundary, a weekend and a DST change, and restart mid-run. Verify exactly one nudge per ticket, auto-solve at the configured business time, no action after a customer reply resets the condition, refusal to publish a repeating automation and "automation <name>" recorded as the actor of each change.

- **NOTIFY-001 — Customer acknowledgments and teammate notifications.** Default, editable triggers send the requester and CCs one "request received" acknowledgment for a new ticket (per channel and brand, with the ticket reference and expected reply time), a notification when a public reply is added, and a solved notice. Machine-generated mail, suspended mail (MAIL-002), imports and merges never trigger them, and each ticket receives at most one acknowledgment even under redelivery. Teammates are notified by inbox, email, push (MOBILE-001) and Slack/Teams: the assignee on assignment and on customer update, the group on unassigned group tickets, followers on update and mentioned teammates on mention, each according to personal preferences and current permission to the ticket, workspace and brand. Templates use MACRO-001 placeholders with a visible failure for a missing value. Every notification carries loop-suppression headers and records its delivery outcome; an uncertain send is never replayed.

  **Acceptance evidence:** Create tickets through email, the widget and a request form with a CC, redeliver the same inbound message and send an auto-responder; verify exactly one acknowledgment to the requester and the CC and none for the auto-responder, an import or a merge. Assign the ticket, add a follower, update it as the customer and mention a teammate; verify each notification reaches only permitted current members according to preference, a revoked member receives nothing, a group notification reaches the group and an uncertain provider send stays uncertain without a second send.

- **CONVERSATION-002 — Merge and external forwarding.** Merge duplicate tickets with an explicit surviving thread, source links, attribution, attachments, notes, SLA/outcome treatment and reversible history where safe. Forward selected customer-visible content to an external partner and thread their reply back while clearly distinguishing an external participant from a teammate. Customer identity, private notes and channel restrictions are previewed; merges cannot cross tenants or silently erase evidence.

  **Acceptance evidence:** Merge two duplicate tickets via the inbox, inspect both source histories and reports, then forward selected content to a partner and receive their reply. Verify no private note leaks, no duplicate customer send, explicit unsafe-undo refusal and no cross-workspace merge.

- **CONVERSATION-003 — Problem and incident linking.** An operator marks a ticket as a Problem and links Incident tickets that report the same issue, manually, from search or from a TRIAGE-001 or agent suggestion a person confirms. The problem lists its incidents with customers and counts. Solving the problem can, with a previewed public reply that uses MACRO-001 placeholders per requester, solve or update every linked incident in its own channel, each reply going only to that incident's requester, with per-ticket outcomes and consent and reply-window checks. Incidents keep their own SLA, history and CSAT; unlinking is audited. A problem can link an ESCALATION-001 engineering issue so that one shipped fix updates every affected customer.

  **Acceptance evidence:** Create a problem and link five incidents arriving by email, widget and SMS; solve the problem with a previewed bulk update and verify each requester receives only their own reply in their channel, an incident whose reply window expired is reported blocked, no customer sees another's identity and each incident keeps its own status, SLA and CSAT invitation. Unlink one incident before solving and verify it is untouched.

- **CUSTOMER-001 — Customer and company support records.** Maintain contacts, verified linked channel identities, companies/accounts, account members, custom attributes, consent/preferences and all interaction history. Link/unlink or merge identities with preview and source provenance; email text alone never grants access. Show current business-system context with last sync time, permission and unavailable/stale state, plus account-level open work and relationship history. Import contacts and companies from CSV outside a vendor migration with column mapping, validation, duplicate matching by email or external ID, a dry-run preview and whole-import undo; such imports send nothing.

  **Acceptance evidence:** Open one customer arriving over chat/email/social, explicitly link their verified identities and company, inspect account tickets and edit attributes; attempt an unauthorized identity merge, deny another account history and show stale connector context after disconnect. Import a contacts-and-companies CSV with a duplicate and an invalid row; preview, apply and undo with no send.

- **COMMERCE-001 — Shopify order actions.** Connect Shopify stores with merchant-granted scopes; show customer orders, fulfillment, delivery, return and refund state in the conversation. Authorized agents/humans can perform permitted return, cancellation and full/partial refund actions with USD amounts, tax/shipping implications and a reason. Preview the exact order/action, require the configured approval and limit, use provider idempotency and verify provider state before telling the customer it succeeded.

  **Acceptance evidence:** Connect a Shopify test store through settings, find a customer order from a ticket, approve a bounded partial refund/return or cancellation and read back the order/provider ledger. Deny excess/refused/revoked scopes, double clicks and cross-store access; a timeout remains pending/uncertain until reconciliation, with no second refund.

- **BILLING-001 — Stripe billing and subscription resolution.** Connect Stripe for customer/payment/invoice/subscription context and permitted refunds, credits and subscription cancellation, pause or plan changes. Show USD totals, tax/proration/effective-date consequences and linked provider records before approval; separate read, prepare, approve and execute scopes and spending limits. Reconcile actual provider state after timeout and report what changed in the original conversation. No raw card data or customer funds enter HappyToHelp.

  **Acceptance evidence:** From a support ticket linked to a Stripe test customer, inspect an invoice, approve a bounded refund and a subscription change and verify provider readback plus customer-visible results. Exercise duplicate requests, proration preview, denied approval and an uncertain timeout without double money movement.

- **CRM-001 — Live CRM and account context.** Connect Orbit, HubSpot and Salesforce independently; map contacts, companies/accounts, support entitlements, plan and owner to support records with source IDs and sync freshness. Read relevant CRM context and write only explicitly scoped support outcomes/approved field changes. Conflicts, identity mismatch and revoked grants are surfaced; the CRM remains the sales/account system of record.

  **Acceptance evidence:** For each named CRM, connect a test account through settings, map a customer, change source entitlement and refresh the ticket, publish an approved support outcome and disconnect. Verify conflict handling, read-only scope refusal and no cross-account data exposure.

- **ESCALATION-001 — Engineering and team escalations that return.** Create or link GitHub Issues, Linear and Jira issues and Slack/Teams handoffs from a conversation, choosing exactly what context/attachments to share. Persist reciprocal links, assignee, status and dependency; signed provider updates return to the support thread, wake its owner and draft a customer update when a fix ships. Issue closure alone never proves customer recovery; operators approve customer publication or grant an explicit bounded policy.

  **Acceptance evidence:** From a ticket, create/link an issue in each named tracker and a Slack/Teams handoff; receive duplicate/out-of-order provider status updates and close the issue. Verify one linked escalation, refreshed ticket state, private-content exclusion and an approved customer update with recovery still unconfirmed until observed.

- **API-001 — Owned API and managed connectors.** Expose a documented versioned HappyToHelp API and signed outbound webhooks for conversations, contacts, articles and support events with scoped authorization, pagination, stable cursors, idempotency and revocation. Provide Zapier actions/triggers and managed MCP tools with the same tenant/action boundaries. Offer Help Scout Inbox API/webhook read synchronization for staged migration/coexistence, with cursors and deduplication; it is separate from native API authority. Connection health, scopes, event attempts and manual reconciliation are visible.

  **Acceptance evidence:** Use a scoped client to page/export records and perform native guarded writes, validate a signed webhook and revoke the token. Exercise a Zapier trigger/action, MCP read versus denied write and Help Scout incremental ingestion with duplicate events/reconnect; verify no replay of old imports or erased identities.

- **MOVE-IN-002 — Switch from every named incumbent.** Provide guided one-click connection or export upload for Zendesk, Intercom, Help Scout and Freshdesk, covering contacts/companies, conversations/messages/attachments/private notes, tags/custom fields, ownership, timestamps and articles/categories/publication. Preview supported mappings and every unsupported field/rule/brand/permission; no silent truncation. Resume with source IDs, deduplicate a second run, perform an inert final delta cutover and explicitly repoint channels. Preserve links and counts; imports never activate automations or expose formerly private knowledge. Imported tickets keep their email threading keys so post-cutover replies land in them (MOVE-IN-003), and configuration moves in under MOVE-IN-004.

  **Acceptance evidence:** For each of the four vendors, use its documented export/API through Move in with representative realistic records, compare exact source/target counts and attachment bytes, inspect omission reports, resume/repeat/undo and final delta, then receive a new live message after channel cutover. Exercise role revocation and source redaction without accidental sends. Reply to a pre-cutover notification (MOVE-IN-003) and import configuration (MOVE-IN-004).

- **MOVE-IN-003 — Replies to pre-migration mail land in the imported ticket.** Imported tickets keep their email threading keys: every source Message-ID and In-Reply-To/References chain, the source ticket number and each vendor's reply token (Zendesk encoded IDs in `[XXXX-XXXX]` brackets and ticket-number subject tags, Help Scout conversation numbers and reply addresses, Freshdesk `[#ticket]` subjects and reply-to addresses, Intercom conversation reply addresses). After channel cutover, a customer reply to a notification the old system sent is matched by those keys in that priority and lands in the imported conversation with its migrated requester, owner, group and status, reopening it under STATUS-001 when Solved and creating a linked follow-up when Closed. A key that matches more than one record, or a record belonging to a different customer identity, goes to review instead of the wrong ticket; an unmatched reply creates a new ticket marked as a possible pre-migration reply. Keys are imported inertly and are covered by repeat/undo equality and erasure.

  **Acceptance evidence:** Import Zendesk, Help Scout, Freshdesk and Intercom datasets that carry real notification headers, perform cutover, then reply to a pre-cutover notification from each vendor by headers only, by subject token only and by reply address; verify each reply lands in the right imported conversation with its owner and status, reopens a Solved one and links a follow-up to a Closed one. Send a reply whose token belongs to another customer (held for review) and an unmatched reply (new ticket with the hint); undo the import and verify the keys no longer match.

- **MOVE-IN-004 — Bring configuration, not only history.** Move in maps each incumbent's configuration into native equivalents: macros with their actions and placeholders (MACRO-001), views, groups and memberships, business-hour schedules and holidays, SLA policies, request forms and custom fields (FORMS-001), triggers and automations, brands and help-center structure. A per-item preview shows what translates exactly, what translates with a stated change and what is unsupported, with the reason. Translated rules arrive inactive as drafts; an admin reviews, simulates them in the AUTOMATION-001 sandbox and activates them, and nothing sends, routes or breaches during import. Placeholders translate to native placeholders or are flagged.

  **Acceptance evidence:** Import a Zendesk configuration with a macro that uses placeholders and four actions, a view, two groups, a schedule with holidays, an SLA policy, two request forms and a trigger/automation pair, plus the Help Scout, Freshdesk and Intercom equivalents. Inspect the per-item mapping, activate selected items after simulation and verify they behave as the source did on a test ticket; unsupported items are listed and inactive drafts cause no effect.

- **PORTAL-001 — Authenticated customer self-service.** A customer securely signs in to a branded portal to search permitted knowledge, create tickets with attachments through FORMS-001 request forms (which anonymous visitors may also submit where the lead allows), review/reply/reopen their own requests and manage notification preferences. Company-wide ticket visibility is an explicit entitlement, never inferred from an email domain. Identity recovery, revoked membership and inaccessible/deleted requests fail safely across web and mobile.

  **Acceptance evidence:** As two customer identities in different companies, sign in, create/reply/reopen a ticket and inspect its history; grant then revoke company visibility, recover identity and verify all unauthorized deep links and attachments are denied. Submit an anonymous request form and a signed-in one (FORMS-001).

- **FORMS-001 — Customer request forms with custom fields.** Leads build several request forms (for example Order problem, Refund, Technical) from typed custom ticket fields (text, number, decimal, date, drop-down, multi-select, checkbox, pattern-validated text and lookups to an order or account), with required and conditional fields, customer-facing labels, descriptions and locale translations, and offer them in the help center, portal, widget and API. Anonymous visitors may submit where the lead allows, with email verification, rate limits and bot protection; signed-in customers' identity and organization are prefilled. Submissions are validated on the server and refused with the failing field named; accepted values are stored as typed ticket fields with the chosen form and are usable by QUEUE-001 routing, SLA-001 policies, AUTOMATION-001/002 conditions, views and reports. Agents see and edit the same fields under field-level permissions; forms and fields are versioned so old tickets keep their values.

  **Acceptance evidence:** Submit the Order-problem form anonymously (with email verification) and the Technical form signed in, each with a required field and a conditional field shown only for a chosen value; confirm both tickets arrive with typed values that a routing rule and an SLA policy act on. Submit invalid input (a missing required value, a pattern failure and a hidden conditional value injected through the API) and verify server refusal naming the field. Translate a form and submit it in Spanish; deny an agent role a restricted field.

- **KNOWLEDGE-002 — Governed private and multilingual knowledge.** Support public and authenticated private help centers, multiple languages/locales, version history, editorial review, redirects and brand/domain publishing. Source refreshes and translated drafts preserve permissions and previous published versions; restricted knowledge is never exposed to public search, an unauthorized agent answer or another account. Agents may propose cited changes, while named editors control publication.

  **Acceptance evidence:** Publish an English article and reviewed translation, restrict an account-only collection, update/rollback a version and follow an old URL. Search and ask the agent as public, permitted and forbidden customers and verify permission-aware citations, locale fallback disclosure and failed-refresh preservation.

- **KNOWLEDGE-003 — Branded help center, article feedback and knowledge in the ticket.** Leads brand each help center with logo, colors, fonts, custom domain, navigation and editable page templates (home, category, section, article, search and request form), previewed before publication with readable contrast enforced. Each article offers "Was this helpful?" votes with an optional comment. Leads see per-article views and votes, search terms with and without results, click-through and tickets created after reading, by brand and locale. From a ticket an operator searches the help center, previews an article and inserts its link or text into the reply in one action, limited to knowledge that customer may see, and can flag an article as outdated or propose a new one (PUSH-004).

  **Acceptance evidence:** Brand two help centers with logo, colors and domain and edit an article template; preview, publish and verify an unreadable color is refused. Vote on an article as a visitor, search for a term with no results and then open a ticket; compare analytics with the known events. From a ticket search, insert an article link and send; verify a restricted article cannot be inserted into a reply to a customer without access.

- **BRANDS-001 — Multi-brand support operations.** A business can manage distinct brands, mailboxes, widget identities, domains, help centers, signatures, channels and policies with deliberate shared teams and reporting. Route and report by brand without mixing customer identities, private knowledge or sender credentials. Cross-brand administration and customer handoffs require explicit access and a visible explanation.

  **Acceptance evidence:** Configure two brands with different domains/senders and a shared permitted team; receive and resolve messages from each, change one policy, inspect per-brand and aggregate reports and deny an unauthorized cross-brand customer/agent read.

- **ACCESS-001 — Enterprise identity and custom permissions.** Retain native owner/password access while optionally connecting Google Workspace, Microsoft Entra ID or Okta using SAML/OIDC SSO and SCIM provisioning. Define custom roles and field/tool/brand/team permissions for operators, admins, reviewers and agents; separate integration installation, refund approval, knowledge publication and destructive access. Collaborator (light-agent) seats can view permitted tickets, add internal notes and follow tickets but cannot reply publicly, change fields or read restricted knowledge. Deprovisioning/revocation promptly ends sessions, pending tool authority and customer-data access, with tested owner recovery.

  **Acceptance evidence:** Provision an operator through each supported identity protocol, assign a restricted custom role, attempt denied exports/refunds/publication, then deprovision during active work and verify sessions/tools lose access. Native owner recovery remains usable and cannot be replaced by provider configuration. A collaborator seat adds a note and is refused a public reply.

- **IDENTITY-003 — Two-factor authentication for native accounts.** Native password accounts enroll a second factor: a TOTP authenticator app or WebAuthn security keys and passkeys, with ten single-use recovery codes shown once. An owner can require two-factor sign-in for every teammate or by role; affected users must enroll at their next sign-in before reaching any data, and existing sessions without the factor end. A sign-in without the factor, with a wrong or replayed TOTP code (one use per time step) or with a used recovery code is refused, rate-limited and audited. Owner-assisted reset of a teammate's factor requires the owner's own recent factor, notifies the teammate and is audited; an owner who loses every factor recovers through the documented installation-level owner recovery through `rer`, never by email alone. Refund and billing approval (COMMERCE-001, BILLING-001), integration and credential installation, exports, erasure, role changes and the two-factor policy itself require a recent second-factor step-up. API access uses scoped tokens (CONNECTIONS-001), never a password alone. SSO users follow their identity provider's MFA (ACCESS-001). This adds to the retained native password identity (IDENTITY-002) and never replaces it.

  **Acceptance evidence:** As owner require two-factor sign-in; sign in as an agent and be forced to enroll TOTP and receive recovery codes; sign out and verify refusal without the factor, with a wrong code, with a reused code and with a used recovery code; sign in with a passkey. Reset the agent's factor as owner with a step-up and observe the notification and audit. Approve a test refund and start an export with and without a recent step-up; recover a locked-out owner through `rer`; verify sessions without the factor ended when the policy was turned on.

- **MOBILE-001 — Support from a phone.** Provide responsive operator/customer web flows and native iOS/Android operator apps for shared queues, push notifications, assignment, notes, attachments, knowledge, approval and reply. Show offline state and protect cached customer data; drafts may persist safely, but reconnect must revalidate role/frontier and scheduled effects. Deep links return to the correct permitted workspace and push payloads omit sensitive content by default.

  **Acceptance evidence:** At 1440 and 390 use realistic end-to-end web tickets; on iOS and Android receive a push, deep-link, assign/note/reply with attachment, go offline, lose authority and reconnect. Verify no stale duplicate send, leaked push content or retained cache after sign-out/revocation.

- **OUTCOMES-002 — CSAT across support channels.** Offer configurable post-resolution satisfaction surveys via widget, portal, email and permitted messaging channels with rating scale, optional comment, locale, send timing and opt-out. Associate one latest response with the exact resolution cycle and channel; preserve previous-cycle history and reconcile signed response links without requiring a widget session. Leads inspect low-score follow-up and customer recovery without auto-closing complaints.

  **Acceptance evidence:** Resolve tickets across the channels, receive/answer a survey as the eligible customer, rerate, reopen and revoke/expire a response link; compare cycle-level CSAT and opt-out behavior, ensure no duplicate invitation and verify erased comments disappear everywhere.

- **REPORTS-002 — Workload, service and agent outcomes.** Leads explore team/agent workload, backlog age, incoming volume, response/resolution time, SLA compliance, reopened requests, CSAT and AI containment/handoff/resolution by channel, brand, account, tag and procedure version. Publish inspectable numerators, denominators, timezone and exclusion rules; distinguish bot closure from verified resolution and include failures/unknowns. Operators record time spent per ticket (a timer while the ticket is open, with manual adjustment) and leads report handle time by agent, form and intent. Export complete formula-safe records and schedule permission-scoped reports; no sampling or silent truncation.

  **Acceptance evidence:** Build a known multichannel cohort containing reassignment, reopen, AI handoff, SLA breach and imported history through public routes. Compare dashboard drill-downs, workload and scheduled CSV delivery to hand-calculated totals; revoke a recipient and verify private data is withheld. Record and adjust handle time on tickets and compare handle-time totals.

- **AGENT-001 — A production support agent with clean handoff.** The AI agent answers using approved help-center content, permitted past conversations and fresh connected customer/product state, with citations, retrieval permissions and clear AI disclosure across chat/email/voice. Execute only enabled procedures/tools; distinguish advice, prepared action, approved execution and observed success. A customer can request a person; uncertain, low-evidence or disallowed actions transfer promptly with transcript, sources, attempted actions, failures and the next responsible human. The agent stops replying after handoff until explicitly resumed.

  **Acceptance evidence:** On representative real-provider channel journeys, ask grounded and unanswerable questions, attempt restricted retrieval/actions, request a human mid-tool-call and disconnect. Verify cited valid answers, no private leakage, no unauthorized tool call, durable handoff context and no competing post-handoff AI answer; record live evaluation separately from fixtures.

- **PROCEDURE-001 — Natural-language procedures and release simulation.** Support leads author versioned natural-language operating procedures tied to intents, knowledge versions, live data requirements, tools, approval gates, budgets and human escalation. Simulate paths, adversarial cases, provider errors, handoffs and permissions against redacted historical examples in an isolated workflow sandbox with no real actions. Per-procedure evaluations must pass declared outcomes before an authorized staged release; compare versions, stop/rollback a rollout and keep old cases reproducible.

  **Acceptance evidence:** Through procedure settings, draft a refund procedure, simulate allowed/denied/timeout/prompt-injection paths with network-edge fakes, inspect a failing case and prevent release. Approve a passing version into a bounded live cohort, revoke a tool and roll back; verify no sandbox external effect and exact version linkage in conversations.

- **AGENT-002 — Inspectable quality and resolution economics.** Operators inspect a redacted per-conversation/tool-call trace with source/version, requested scope, human approval, timings, provider outcome and verified result. Leads explore procedure-level evaluation coverage, resolution/reopen/handoff rates, failure clusters and provider costs/usage without treating attempted actions as success. Human labels and later customer outcomes can correct attribution; provider usage remains accounting evidence, not a customer balance or invented monetary saving.

  **Acceptance evidence:** Open production-run traces from a conversation and drill from a procedure report to supporting cases; include timeout, denied tool, handoff, negative CSAT and reopened outcomes. Compare rates and USD provider-cost estimates to raw usage and known denominators, redact secrets and show unavailable price data explicitly.

- **FEEDBACK-001 — Source-linked feedback and release follow-up.** Capture product feedback from a support conversation with the customer/account and supporting quote, link or create its request in Penny, and link engineering delivery in Vector or the buyer's issue tracker. Subscribe the affected requester to an approved service update when a linked feature/fix ships, respecting preference, channel policy and unresolved recovery. Penny owns aggregation, prioritization, roadmap/changelog and requester closure; HappyToHelp retains the support history and responsibility for the customer response.

  **Acceptance evidence:** From two related customer tickets, hand off source-linked feedback to Penny, associate an engineering issue and receive a release event; preview and approve requester updates, deduplicate events, honor opt-out and keep a still-failing customer request open.

- **ERASURE-001 — Customer erasure with coherent history.** Owner/admin contact erasure removes personal content from native/imported transcripts, notes, context, feedback, stored files and archive copies while retaining nonpersonal identity/frontier and an opaque erasure tombstone. Erasure fences APIs, pending events, source re-import and stale restore from resurrecting the identity. Provide completion/failed counts for all stores and separately request deletion from connected providers under their capabilities; do not claim already sent messages or offline archive bytes were recalled.

  **Acceptance evidence:** Erase a populated native/imported contact through the authorized owner route, inspect D1/R2 and the resulting export, retry a stale API/import and test role/cross-tenant denial. Verify coherent redacted threads, tombstone fencing and explicit unresolved external/old-archive deletion.

- **AUDIT-001 — Security and accountable actions.** Encrypt configured provider credentials under installation custody, never return secrets in ordinary reads/logs/exports and enforce tenant, role, origin and public rate limits at every door. Keep an inspectable, exportable append-only audit of authentication/permission changes, imports/exports/erasure, assignments, procedure changes, approvals and external actions with actor, purpose, source, time and outcome; redact erased actors without losing the event. Configure retention/legal holds with visible effects and never silently delete evidence to improve reports.

  **Acceptance evidence:** Using owner/security views, rotate/revoke credentials, attempt cross-tenant/CSRF/SSRF access, approve an action, export audit and erase its actor; inspect durable outcomes with no secrets. Apply retention/hold settings and verify protected records and report denominators survive restart and cleanup.

- **PORTABILITY-001 — Complete customer-owned portable support data.** Export versioned machine-readable conversations, attachments, contacts/companies, knowledge/versions, settings, rules/procedures/evaluations, outcomes and audit with a schema, integrity digest and explicit exclusions. Validate a bounded archive before atomic inactive restore to a clean installation; do not transfer sessions, provider secrets or connector authority and do not replay imported actions. Include D1, R2 and Durable Object business state or a lossless reconstruction; retain erasure fences and receiving-owner identity. This target replaces the current documented incomplete-storage boundary without pretending the held Base-data equivalence is done.

  **Acceptance evidence:** Through rer export/import and owner data controls, populate each business store, export, destroy the disposable source and restore to a clean installation. Compare every portable record and attachment byte, preserve erasure fences, refuse corrupt/oversized/nonempty targets and verify all restored work is inert until separately authorized. Include Durable Object history and interrupted actions.

- **ASSURANCE-001 — Qualified regulated support deployments.** US-first support uses USD, US provider contracts, IANA calendars and channel/recording consent controls. A regulated buyer can qualify an isolated deployment with required DPA/BAA, approved subprocessors/model data handling, access controls, audit, retention, incident response and validated deletion/export; health-data support is gated on those agreements and technical acceptance. The work remains a product obligation, with a named partner/provider path, rather than a claim that self-hosting alone supplies compliance.

  **Acceptance evidence:** Before enabling a regulated workspace, an authorized administrator records required executed agreements/provider settings and runs tenant isolation, permission, audit, retention, recovery and erasure journeys with representative sensitive data. Missing agreements/controls block that configuration visibly; verify access only after qualification and withdrawal upon expiry/revocation.


## Push further: accountable agents

- **PUSH-001 — Reproduce, repair and prove customer recovery.** Given the conversation, authorized live product state and an explicitly paired repair workspace, the agent reproduces the customer's failure, records its observation, prepares or performs only the permitted fix, and verifies with a distinct post-change read or user journey. Environment, operations, data, spending and time limits are granted by a named person; production changes and reply publication have separate authority. Reconcile started/uncertain work, gather customer-scoped recovery evidence, report in the original thread and reopen/escalate if recovery fails or the customer reports recurrence. A successful command or closed engineering issue never proves recovery.

  **Acceptance evidence:** Start with a real support request and reproducible product failure; pair the connector, run read-only reproduction, approve a bounded fix, independently observe the affected customer path and approve/send the original-thread report. Inject stale authority, uncertain change, failed verification, restart and later recurrence; verify no unapproved production effect/reply, truthful evidence and reopened ownership.

- **PUSH-002 — Promises survive every handoff.** The agent extracts explicit commitments, quoted evidence and dependencies from messages and linked issues into durable obligations with a responsible person, due time, current evidence and stop condition. Chase missing evidence internally, detect stale dependencies and draft an honest customer update before a promise expires. Humans accept material due-date or promise changes; no fabricated progress, invented commitment or unapproved customer message is allowed.

  **Acceptance evidence:** In a conversation promise a follow-up, link an engineering dependency, hand off twice and restart. Verify the same cited obligation, accepted owner/due-time changes, reminders and a timely draft; mark an evidence-free dependency stale and block any claim of completed progress until readback exists.

- **PUSH-003 — Learn from reopenings under human control.** The agent joins reopened requests, complaints, CSAT, procedure/tool versions and connected business outcomes to identify failed resolution paths. Propose a concrete procedure/policy change with cited cases, replay evaluation and expected effect; a human approves changed permissions/tools, spending limits and bounded rollout. Track actual post-release recovery and regression, stop/rollback on deterioration and preserve original procedure versions and dissenting evidence.

  **Acceptance evidence:** Create matched resolved/reopened cases under two procedure versions, inspect a proposed change and its replay set, reject then approve a limited rollout and inject regression. Verify only approved versions/actions run, before/after outcomes are attributable and rollback preserves all failure evidence.

- **PUSH-004 — Turn verified edge cases into reviewed knowledge.** The agent identifies unanswered or repeatedly reopened topics from permitted conversations, support searches and procedure failures, clusters the gap and drafts a sourced article/update from verified resolutions. Strip personal data, obey private/brand/locale boundaries and include the evidence and proposed scope. A named editor reviews publication/translation and the agent measures whether later customers recover, proposing corrections when they do not.

  **Acceptance evidence:** Resolve a previously undocumented case, trigger gap analysis, inspect a cited redacted draft, reject and then publish an edited version and ask the next customer's question. Verify permission-aware retrieval, no automatic publication, attribution and a corrective proposal when the case reopens.

## Honest boundaries and connected products

HappyToHelp owns customer support, its operational queue, service follow-up and support CSAT. It consumes sales/customer context from [Orbit](https://github.com/just-every/run-orbit), HubSpot and Salesforce; [Buoy](https://github.com/just-every/run-buoy) owns post-sale customer-success programs. [Penny](https://github.com/just-every/run-penny) owns feedback aggregation, prioritization, roadmap/changelog and requester closure; [Vector](https://github.com/just-every/run-vector) owns engineering issues and delivery. HappyToHelp links their records and follows the support request through verified recovery. General marketing campaigns go to [Mango](https://github.com/just-every/run-mango), incident subscriber communication to [Lamp](https://github.com/just-every/run-lamp), general survey research to [Pencil](https://github.com/just-every/run-pencil) and employee IT service management to [Linen](https://github.com/just-every/run-linen). No neighboring product or unowned LIST gap is absorbed.

Aircall/Twilio and Meta operate the telephone/messaging networks and provider registration; HappyToHelp supplies the connected support experience, routing, consent and failure controls in VOICE-001 and CHANNELS-001. It does not become a carrier or emergency dispatch service: emergency callers are directed to 911 through the provider's supported routing and disclosed number/location limitations, while US emergency-calling obligations for supplied numbers must be qualified before voice launch. Stripe/Shopify execute authorized financial actions; HappyToHelp neither holds funds nor stores raw payment credentials. Commerce, CRM and subscription ledgers remain in their respective systems; complete support actions remain required here.

Arbitrary repair execution runs only in an explicitly paired external workspace, with per-operation authority, never as an implicit Worker capability. Provider apps, native apps, production integration qualification, health-data agreements, consent rules and payments-related support actions are engineering obligations in the named clauses, not reasons to reduce the target. Regulated deployments require ASSURANCE-001 qualification; no current HIPAA, SOC 2 or FedRAMP assurance is claimed. Provider acceptance is not customer receipt, a passing fixture is not a live deployment and a completed tool call is not a verified customer outcome. Existing accessibility and complete-storage holds remain in ACCEPTANCE.md until separately proven.

The platform admission index's `move_in_contact_keys.email_digest` remains lazy derived memoization. Exact business equality preserves its project/contact links and validates each populated digest against the native email; NULL-to-correct-digest does not alter business state. Contacts, native email, identity and all source/business links remain in the equality comparison.

## Status

Judged from the code and tests at commit `82de9ed83c8d4f0b75c378fdd3e234015dc5fd5b` (22 October 2026). R5 additionally updates SLA-001, AUTOMATION-001/002, QUEUE-001/004 and STATUS-001 from the workflow, inbox and packaged recovery journeys on 17 October 2026. WIDGET-001 and AUTOMATION-002 are re-judged at `473a30dab0c6458e5250a55cbebeef999e1e3063` (22 October 2026), with workspace presence and the away-reply correction (migrations 240 and 241).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 20 | 2 | 0 | 22 |
| Target and push further | 15 | 26 | 11 | 52 |
| All | 35 | 28 | 11 | 74 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `NATIVE-001` | Native owner installation | published | partial | `scripts/installer/local.mjs`; `scripts/installer/durable-objects.mjs`; `tests/journeys/installer-nightly.mjs`; `tests/helpers/installer/readme-restore.mjs`; `tests/helpers/installer/fresh-install.mjs` | With Cloudflare credentials `rer deploy --dry-run` reads the target's Workers subdomain, settings and secret names (three GET requests, `tests/helpers/installer/fresh-install.mjs`), and without them it refuses, so "Deployment dry-run makes no provider requests" does not hold. Local install, setup, dev, reset, export/import and restore are exercised; remote provisioning is qualified separately. |
| `IDENTITY-002` | Retained native password identity (owner decision 2026-10-08) | published | done | `src/modules/identity/routes.ts`; `tests/journeys/identity.mjs` |  |
| `IDENTITY-001` | Scoped authority | published | done | `src/modules/management/policy.ts`; `tests/journeys/identity.mjs`; `tests/journeys/runtime.mjs` |  |
| `FIRST-RUN-001` | A useful first workspace | published | done | `src/modules/management/provisioning/index.ts`; `tests/journeys/first-run.mjs` |  |
| `LOCAL-MAIL-001` | Rer dev mail | published | done | `src/modules/integrations/email.ts`; `tests/journeys/first-run.mjs` |  |
| `CONVERSATION-001` | Durable transcript | published | done | `src/modules/conversations/admission.ts`; `tests/journeys/runtime.mjs`; `tests/journeys/erasure.mjs` |  |
| `DELIVERY-001` | Live delivery and recovery | published | done | `src/modules/conversations/socket.ts`; `tests/journeys/widget.mjs`; `tests/journeys/first-run.mjs` |  |
| `UI-001` | Existing editable experience | published | done | `src/ui/dashboard`; `src/modules/widget`; `tests/journeys/inbox-browser.mjs` |  |
| `MOVE-IN-001` | Reviewed history import | published | done | `src/modules/move-in/plan.ts`; `tests/journeys/move-in-capacity.mjs`; `tests/journeys/move-in-browser.mjs`; `tests/move-in/native-corrections.mjs` |  |
| `OUTCOMES-001` | Resolution feedback and provenance | published | done | `src/modules/outcomes/rating.ts`; `src/modules/outcomes/operator-feedback.ts`; `tests/reports/ratings.mjs`; `tests/reports/outcomes.mjs` |  |
| `REPORTS-001` | Workspace calendar reports | published | done | `src/modules/reports/routes.ts`; `src/modules/reports/metrics.ts`; `tests/reports/figures.mjs`; `tests/journeys/reports.mjs` |  |
| `CONNECTIONS-001` | Workspace integrations | published | done | `src/modules/api-integrations`; `tests/connections/api.mjs`; `tests/connections/delivery.mjs`; `tests/connections/slack.mjs` |  |
| `ACTIVATION-001` | Observed owner setup | published | done | `src/modules/management/activation`; `tests/journeys/first-run.mjs` |  |
| `AI-001` | Configured model execution | published | done | `src/modules/ai-support/service.ts`; `tests/journeys/first-run.mjs` |  |
| `KNOWLEDGE-001` | Published knowledge | published | done | `src/modules/knowledge/authoring.ts`; `src/modules/public-site/help-center.tsx`; `tests/journeys/knowledge.mjs`; `tests/journeys/public.mjs` |  |
| `CONTEXT-001` | Attributed customer context | published | done | `src/modules/customer-context`; `tests/journeys/context.mjs` |  |
| `DELEGATION-001` | Explicit local authority | published | done | `src/modules/local-computer/results.ts`; `src/edition/delegation/routes.ts`; `tests/journeys/delegation.mjs` |  |
| `TRAINING-001` | Durable evaluation | published | done | `src/modules/training-runs/runner.ts`; `src/edition/ai/training.ts`; `tests/journeys/ai.mjs` |  |
| `INTEGRATION-001` | Honest external effects | published | partial | `src/modules/integrations/inbound.ts`; `src/modules/integrations/github.ts`; `tests/journeys/email.mjs`; `tests/journeys/knowledge.mjs` | Existing mail/GitHub adapters work at test boundaries; the newly required business connectors are missing. |
| `PUBLIC-001` | Public product source | published | done | `src/ui/homepage`; `tests/homepage-browser.mjs`; `tests/journeys/public.mjs` |  |
| `MIGRATION-001` | Prior-data custody | published | done | `src/modules/legacy-import`; `tests/journeys/erasure.mjs`; `tests/journeys/move-in-admission.mjs` |  |
| `SOURCE-001` | Author-owned capability graph | published | done | `scripts/edition-authoring/cli.mjs` |  |
| `DESK-001` | The shared support desk | target | done | `src/modules/management/dashboard.ts`; `src/modules/management/inbox-search.ts`; `src/modules/tickets`; `tests/journeys/first-run.mjs`; `tests/journeys/inbox.mjs`; `tests/journeys/reports.mjs`; `tests/journeys/delegation-browser.mjs` |  |
| `WIDGET-001` | Availability-aware messenger and proactive messages | target | partial | `src/modules/management/availability.ts`; `src/modules/management/live-availability.ts`; `src/modules/collaboration/presence.ts`; `src/modules/collaboration/presence-store.ts`; `src/modules/conversations/socket.ts`; `src/modules/management/away-reply.ts`; `src/modules/widget/js/AwayNotice.jsx`; `src/modules/widget/js/collection/Hesitation.jsx`; `tests/journeys/widget-browser.mjs`; `tests/journeys/widget.mjs` | Outside the schedule's hours, with new conversations off, or during open hours with no teammate online, the installed widget says the team is away, shows when it is back in the visitor's time (or, by presence, that it replies as soon as it is back), asks for an email before the first message and posts the workspace's away message once per conversation (never emailed, no AI reply, and not a reply in response times, outcomes or automations); an assistant answering the conversation keeps answering. Live presence: a teammate who may reply (not a collaborator) is online while their dashboard's workspace stream is connected and they used it within the lead-set idle time (5 to 120 minutes, 15 by default); a closed dashboard is away within 10 seconds, a lost connection or Worker restart within 90 seconds, and an open widget re-checks every 30 seconds; an enabled visitor assistant with its provider key installed keeps the widget available; presence is never exported or restored. Leads turn presence-based away on or off (on by default) and set its idle time and away message in Settings → Availability, audited; collaborators are refused. Behavior-based hesitation detection exists. Configurable proactive messages (page, time, scroll, exit, attribute, visit and cart triggers with audience and brand), their frequency caps and quiet hours, and reporting of their impressions, opens, dismissals and resulting conversations do not. |
| `MAIL-001` | Complete support email | target | partial | `src/modules/integrations/mailboxes/`; `src/modules/integrations/email-threading.ts`; `tests/helpers/email/mailbox-provider.mjs`; `tests/helpers/email/complete-email.mjs`; `tests/helpers/email/transports.mjs`; `docs/email.md` | Forwarding, Gmail and Microsoft 365 OAuth connections, aliases, branded sender, signatures, CC/BCC, header/token threading and cursor/reconnect/backfill/disconnect controls are exercised at the provider edge (`tests/journeys/email.mjs`). The IMAP/SMTP mailbox (`src/modules/integrations/mailboxes/socket.ts`) has no journey or fake TLS edge, so its connection, sync and send are unverified. Live paid provider accounts and production cutover are not qualified. |
| `MAIL-002` | Reviewable suspended and spam mail | target | done | `src/modules/integrations/suspended.ts`; `src/modules/integrations/suspended-store.ts`; `src/modules/integrations/suspended-recovery.ts`; `tests/helpers/email/complete-email.mjs`; `docs/email.md` | R6 local scope complete: separate held-mail store, reasons/authentication/headers, safe text and attachment inspection, existing/new-ticket recovery, address/domain rules and audited 14-day expiry. Public-door journeys cover spoof isolation, permissions, recovery without retrospective effects and erasure. R6's browser check of recovery, allow/block/remove and deletion at 1440 and 390 has no repository journey and was not repeated for this review. |
| `OUTBOUND-001` | Agent-created and proactive tickets | target | partial | `src/modules/management/outbound-tickets.ts`; `src/modules/management/outbound-ticket-input.ts`; `src/modules/management/outbound-ticket-store.ts`; `tests/helpers/email/complete-email.mjs`; `tests/helpers/email/mailbox-provider.mjs`; `docs/email.md` | R6 individual email and call creation complete: requester/operator submitter attribution, mailbox and authorized sender, immutable CC/BCC, private call notes and durable send identity/outcomes. Provider-edge journeys inspect sent copies; R6's rer dev browser check of both creation paths has no repository journey and was not repeated for this review. Multi-requester proactive notices, remaining ticket configuration and consented SMS/WhatsApp templates remain outside this round. |
| `CHANNELS-001` | Messaging and social support | target | missing |  | No implementation located. No SMS/Meta support channel implementation located. |
| `CHANNELS-002` | B2B shared-channel support | target | missing |  | `src/modules/api-integrations/dispatch.ts`; `tests/connections/slack.mjs`; `src/modules/escalations/actions.ts`. Slack receives new-conversation notifications and outbound engineering handoff posts only, which this clause excludes; customer intake, bidirectional Slack Connect and Teams are absent. |
| `VOICE-001` | Telephone service and unified voice agent | target | missing |  | No implementation located. No voice routing/agent or Aircall connector implementation located. |
| `QUEUE-001` | Assignment rules and available teams | target | done | `src/modules/workflows/routing.ts`; `src/modules/workflows/routing-candidates.ts`; `src/ui/native/pages/workflows/RoutingSettings.jsx`; `tests/helpers/workflows/routing.mjs` |  |
| `TRIAGE-001` | Intelligent triage | target | done | `src/modules/triage/`; `src/modules/workflows/routing-triage.ts`; `tests/helpers/ai/triage.mjs`; `tests/helpers/ai/triage-browser.mjs`; `docs/triage.md` | Configured-model classification runs after admission, with confidence, exact quoted evidence and native ticket fields. Operator labels measure accuracy before explicit intent-routing approval. Triage gates only rules with a triage condition; other routing rules act at admission whether the model is pending, down or unsure. An unsure or failed result places an unplaced ticket in the default queue once, never over a teammate's choice. Local API, dashboard, widget admission, erasure and rer archive journeys cover roles and custody. Live model quality is not claimed. |
| `QUEUE-002` | Structured and bulk queue work | target | done | `src/modules/tickets`; `tests/journeys/inbox.mjs`; `tests/helpers/inbox/ticket-queue.mjs`; `tests/helpers/inbox/ticket-queue-capabilities.mjs`; `tests/helpers/inbox/tickets-browser.mjs` |  |
| `QUEUE-003` | Collaboration without conflicting replies | target | done | `src/modules/collaboration`; `src/modules/conversations/socket.ts`; `src/modules/tickets`; `src/ui/dashboard/components/collaboration`; `tests/journeys/inbox.mjs`; `tests/journeys/first-run.mjs` |  |
| `MACRO-001` | Action macros with placeholders | target | done | `src/modules/macros`; `src/ui/native/pages/macros`; `src/ui/dashboard/components/macros`; `tests/helpers/r4/macros.mjs`; `tests/journeys/inbox.mjs` |  |
| `QUEUE-004` | Snooze and scheduled follow-up | target | done | `src/modules/workflows/schedules.ts`; `src/modules/workflows/routes-schedules.ts`; `src/ui/dashboard/components/workflows/WorkflowPanel.jsx`; `tests/helpers/workflows/schedules.mjs` |  |
| `STATUS-001` | Ticket status lifecycle | target | done | `src/modules/tickets`; `src/modules/workflows/followups.ts`; `src/modules/workflows/rule-time.ts`; `tests/helpers/inbox/ticket-lifecycle.mjs`; `tests/helpers/inbox/ticket-api-privacy.mjs`; `tests/helpers/workflows/rules.mjs` |  |
| `SLA-001` | Business-hour service commitments | target | partial | `src/modules/workflows/calendars-time.ts`; `src/modules/workflows/sla.ts`; `src/modules/workflows/sla-alerts.ts`; `tests/helpers/workflows/sla.mjs` | R5 calendars, first/next/resolution clocks, queue due times, pauses and durable acknowledged alerts are implemented. Rule and SLA notices use R4’s proven-address delivery claims; Slack/Teams per-user notices belong to R11. |
| `AUTOMATION-001` | Explainable durable support workflows | target | partial | `src/modules/workflows/rule-admin.ts`; `src/modules/workflows/rule-engine.ts`; `src/modules/workflows/rule-preview.ts`; `tests/helpers/workflows/rules.mjs` | R5 ordered/versioned event rules, sandbox, publishing, pause/cancel and durable loop-safe execution are implemented. Notify actions use R4’s proven-address delivery claims, with explicit terminal delivery outcomes. Signed-webhook actions are not part of the R5 build-row end state. "Operator replied" rules also run on the workspace's system away reply, which `migrations/150_workflow_journal.sql` journals as an operator reply. |
| `AUTOMATION-002` | Time-based automations | target | done | `src/modules/workflows/rule-time.ts`; `src/modules/workflows/rule-engine.ts`; `src/jobs.ts`; `tests/journeys/inbox.mjs`; `tests/helpers/workflows/rules.mjs` | Hourly durable time automations, the 48/96 business-hour templates, the seeded four-day close, restart-safe cursors, customer-reply reset, unsafe-repeat refusal and automation actors pass their journeys. The last-agent-update time (`src/modules/workflows/time-rules.ts`, `src/modules/workflows/rule-model.ts`) counts a teammate's reply and never the workspace's system away reply (migration 241), so an agent-update automation waits for the teammate's reply (`tests/helpers/workflows/rules.mjs`). |
| `NOTIFY-001` | Customer acknowledgments and teammate notifications | target | partial | `src/modules/integrations/triggers.ts`; `src/modules/integrations/triggers`; `src/modules/integrations/notification-teammates.ts`; `src/modules/integrations/operator-notifications.ts`; `tests/journeys/email.mjs`; `tests/journeys/inbox.mjs` | R4 supplies editable requester/CC received and solved notices, inbox/email teammate notices, personal preferences, frozen delivery claims and the workflow notification interface. Push and per-user Slack/Teams remain R11. |
| `CONVERSATION-002` | Merge and external forwarding | target | done | `src/modules/conversation-actions`; `src/ui/dashboard/components/conversation-actions`; `tests/helpers/r4/conversation-actions.mjs`; `tests/journeys/inbox.mjs` |  |
| `CONVERSATION-003` | Problem and incident linking | target | partial | `src/modules/tickets/problem-routes.ts`; `src/modules/tickets/problem-execute.ts`; `tests/helpers/inbox/problems.mjs`; `docs/tickets.md` | R10a: problem marking, single and bulk incident links, per-requester placeholder previews, email/widget updates and solve, per-ticket failures, history/audit, erasure and safe restore. Triage suggestions, engineering issue links and later channel transports remain later rounds. |
| `CUSTOMER-001` | Customer and company support records | target | partial | `src/modules/customers`; `src/modules/import-kit/csv`; `src/ui/native/pages/Companies.jsx`; `tests/helpers/company-records.mjs`; `tests/helpers/customer-csv.mjs`; `tests/journeys/inbox.mjs` | Company records, typed attributes, domains, members, all account tickets, company inbox filtering, previewed reversible merge with provenance, and mapped CSV preview/apply/undo are implemented. Imports send nothing; new records participate in erasure, audit and portable storage. Full cross-channel identity governance and live connector context remain incomplete. |
| `COMMERCE-001` | Shopify order actions | target | missing |  | No implementation located. No Shopify order/refund connector implementation located. |
| `BILLING-001` | Stripe billing and subscription resolution | target | missing |  | No implementation located. No active Stripe billing/subscription action connector located; legacy financial imports confer no action authority. |
| `CRM-001` | Live CRM and account context | target | missing |  | No implementation located. No Orbit, HubSpot or Salesforce connector implementation located. |
| `ESCALATION-001` | Engineering and team escalations that return | target | partial | `src/modules/escalations`; `tests/journeys/connections.mjs`; `tests/journeys/connections-browser.mjs`; `tests/helpers/escalations/dev-proof.mjs` | Teams belongs to R11; live provider accounts remain unqualified. |
| `API-001` | Owned API and managed connectors | target | partial | `src/modules/api-integrations`; `local-agent/lib/mcp.mjs`; `src/modules/move-in/plan.ts`; `tests/connections/api.mjs`; `tests/connections/delivery.mjs` | Native API/webhooks, Help Scout export import and connector MCP transport exist; managed catalog, Zapier and continuous Help Scout synchronization do not. |
| `MOVE-IN-002` | Switch from every named incumbent | target | partial | `src/modules/move-in/plan.ts`; `src/modules/move-in/readers/normalise.ts`; `tests/journeys/move-in-capacity.mjs`; `tests/move-in/helpscout-security.mjs`; `tests/move-in/door-readers.mjs`; `tests/journeys/move-in-browser.mjs` | Reviewed Zendesk, Help Scout, Freshdesk and Intercom history import exists (`tests/journeys/move-in-admission.mjs`); attachment bytes, one-click API connection, final delta cutover, channel repoint, companies and custom fields, activated ownership and configuration move-in are incomplete. |
| `MOVE-IN-003` | Replies to pre-migration mail land in the imported ticket | target | partial | `src/modules/move-in/email-threading.ts`; `src/modules/integrations/email-threading.ts`; `src/modules/integrations/email-threading-keys.ts`; `tests/helpers/email/complete-email.mjs`; `docs/email.md` | R6 vendor scope complete: inert imported message/header, subject-token and reply-address keys for Zendesk, Freshdesk, Help Scout and Intercom. Public upload/review/apply and inbound journeys match all four vendors and hold wrong-customer replies. Header proposals preserve sender-authority gates; Closed remains final with a linked follow-up. Live cutover, broader legacy acceptance and unmatched-migration hints remain unqualified. |
| `MOVE-IN-004` | Bring configuration, not only history | target | partial | `src/modules/move-in/plan.ts`; `tests/journeys/move-in-browser.mjs` | Saved replies and tags move in today; macro actions, views, groups, schedules, SLA policies, forms, triggers and automations do not. |
| `PORTAL-001` | Authenticated customer self-service | target | done | `src/modules/portal`; `src/modules/public-site/portal-pages.ts`; `src/modules/customers`; `tests/helpers/customer-portal-journey.mjs`; `tests/helpers/company-portal.mjs`; `tests/journeys/knowledge.mjs` | Email-link sign-in, request flows, attachments and preferences include explicit per-company ticket visibility, off by default. Current membership and entitlement fence list, detail, reply, reopen and attachment access; removals take effect on the next request. Local runtime journeys establish these paths; no live email-provider qualification is claimed. |
| `FORMS-001` | Customer request forms with custom fields | target | partial | `src/modules/forms/settings.ts`; `src/modules/forms/definition.ts`; `src/modules/forms/validation.ts`; `src/modules/forms/challenge.ts`; `src/modules/forms/submit.ts`; `src/ui/native/pages/request-forms/RequestFormsSettings.jsx`; `tests/helpers/request-forms-journey.mjs`; `tests/helpers/self-service-fixture.mjs`; `tests/journeys/knowledge.mjs` | Published forms reuse typed ticket fields with required/conditional questions, translated labels, server validation, email-verified customer identity and fail-closed Turnstile checks for anonymous submissions. Verified customer sessions submit without Turnstile. Order/account lookup fields and explicit version-history management remain incomplete; live Turnstile and mail delivery are not established. |
| `KNOWLEDGE-002` | Governed private and multilingual knowledge | target | partial | `src/modules/knowledge/access.ts`; `src/modules/knowledge/experience.ts`; `src/modules/knowledge/experience-routes.ts`; `src/modules/knowledge/help-auth.ts`; `src/modules/knowledge/public-sources.ts`; `src/modules/public-site/help-center.tsx`; `tests/journeys/knowledge.mjs` | Public and signed-in/email-domain collections, reviewed translations, article history/restore and slug redirects are implemented. The assistant answers from public-audience articles only, so restricted knowledge never reaches an answer. Per-brand domain publishing and agent-proposed cited changes are absent. |
| `KNOWLEDGE-003` | Branded help center, article feedback and knowledge in the ticket | target | partial | `src/modules/knowledge/feedback.ts`; `src/modules/knowledge/analytics-routes.ts`; `src/ui/native/pages/knowledge/KnowledgeExperience.jsx`; `src/ui/dashboard/components/ArticlePicker.jsx`; `src/modules/public-site/help-center.tsx`; `src/modules/public-site/request-pages.ts`; `tests/journeys/knowledge.mjs`; `tests/journeys/public.mjs` | Plain-text page templates (home, category, section, article, search and request form), article votes/comments, locale/brand activity analytics and recipient-scoped article insertion are implemented; no journey exercises the request-form template. Per-brand custom domains and ticket-after-reading attribution remain deferred. |
| `BRANDS-001` | Multi-brand support operations | target | partial | `src/modules/management/projects.ts`; `tests/journeys/inbox.mjs` | Separate workspaces exist; unified multi-brand governance and routing are absent. |
| `ACCESS-001` | Enterprise identity and custom permissions | target | partial | `src/modules/access/`; `src/platform/auth.ts`; `src/modules/integrations/inbound-authority.ts`; `src/edition/delegation/common.ts`; `src/modules/tickets/model.ts`; `tests/journeys/identity.mjs`; `tests/helpers/inbox/ticket-lifecycle.mjs` | Native owner/admin/agent, the collaborator role (notes and follow only) and restricted custom roles exist, with refusals audited and owner recovery retained. Connected-application grants are held to the approving member's current role, so narrowing a role narrows its grants at once. Ticket fields carry read and write roles, including custom roles. SSO (SAML/OIDC), SCIM, and brand and team permissions are absent. |
| `IDENTITY-003` | Two-factor authentication for native accounts | target | done | `src/modules/identity/two-factor/`; `src/platform/auth.ts`; `src/edition/delegation/consent.ts`; `tests/journeys/identity.mjs`; `tests/journeys/identity-browser.mjs`; `tests/journeys/delegation-browser.mjs` | Each second-factor answer claims its attempt before it is checked, so parallel guesses stay within the limit. Registering a connected application and approving its access are credential installs and step up. A re-entered password (step-up, password change) claims its attempt the same way. Every factor enrollment, a teammate's password reset link (owner's own factor), a changed sign-in email, and copying or resending an admin or owner invitation step up; the identity invitation door without those rules is removed. Accounts without a second factor may confirm beside the password by a single-use, 15-minute, account-bound email sign-in link; requests are atomically rate-limited and audited, and only the fresh sign-in session gains proof. New email claims install no unknown password or recent proof. Existing credentials remain intact; recent mailbox proof authorizes setting a new password without the old one, so older claim-generated or externally chosen passwords cannot strand an account. Enrolled second factors remain required. Setting a first password on an account without one (every moved-in teammate) and adding, repointing or re-enabling a side-panel plugin step up too. |
| `MOBILE-001` | Support from a phone | target | partial | `src/ui/dashboard`; `src/modules/widget`; `tests/journeys/inbox-browser.mjs`; `tests/journeys/reports-browser.mjs` | Responsive web journeys exist; native apps, mobile push and protected offline work are absent. |
| `OUTCOMES-002` | CSAT across support channels | target | partial | `src/modules/outcomes/survey-routes.ts`; `src/modules/outcomes/survey-delivery.ts`; `src/modules/outcomes/survey-store.ts`; `src/modules/reports/surveys.ts`; `src/modules/portal/requests.ts`; `src/modules/portal/preferences.ts`; `src/ui/native/pages/surveys/SurveyPanel.jsx`; `tests/helpers/csat-journey.mjs`; `tests/helpers/customer-portal-journey.mjs`; `tests/helpers/self-service-fixture.mjs`; `tests/journeys/knowledge.mjs`; `tests/reports/ratings.mjs` | Email surveys, expiring single-use signed links, opt-out, low-score results and cycle history coexist with widget ratings. The portal exposes the same eligible unused signed link and opt-out, without minting another invitation. Other messaging-channel surveys remain incomplete. |
| `REPORTS-002` | Workload, service and agent outcomes | target | partial | `src/modules/reports/team-routes.ts`; `src/modules/reports/schedule-dispatch.ts`; `src/modules/reports/timers.ts`; `tests/reports/team-journey.mjs`; `docs/reports.md` | R10a: complete current agent/team/channel/brand/tag workload and backlog, persisted R5 SLA compliance, reopen rate, adjustable ticket timers (a member's own Stop ends only their timer; removal or loss of ticket access ends theirs; a lead ends a teammate's only by naming it, recorded as the lead's in history and audit) and handle time by agent/form/visible intent, timezone/date/team/brand/import filters, complete CSV and permission-scoped daily/weekly mail. Existing response/outcome/CSAT reports retained. Account and procedure-version dimensions await their owning rounds. |
| `AGENT-001` | A production support agent with clean handoff | target | partial | `src/modules/ai-support/service.ts`; `src/modules/knowledge`; `src/edition/delegation/routes.ts`; `tests/journeys/first-run.mjs`; `tests/journeys/delegation.mjs` | Configured AI and scoped local handoff exist; full multichannel, business-action and production-quality coverage is incomplete. |
| `PROCEDURE-001` | Natural-language procedures and release simulation | target | partial | `src/modules/training-runs/runner.ts`; `src/edition/ai/training.ts`; `src/modules/management/resources.ts`; `tests/journeys/ai.mjs` | Assistant instructions and durable evaluations exist; versioned procedures, their sandbox simulation and controlled rollout do not (the AUTOMATION-001 rule sandbox does not run procedures). |
| `AGENT-002` | Inspectable quality and resolution economics | target | partial | `src/edition/ai/training-trace.ts`; `src/modules/local-computer/results.ts`; `src/modules/reports/routes.ts`; `tests/reports/figures.mjs`; `tests/journeys/first-run.mjs` | Provider-round traces, training details and aggregate reports exist; full production tool/procedure exploration is incomplete. |
| `FEEDBACK-001` | Source-linked feedback and release follow-up | target | missing |  | No implementation located. No Penny/Vector feedback and shipped-feature support follow-up implementation located. |
| `ERASURE-001` | Customer erasure with coherent history | target | done | `src/modules/management/contact-erasure.ts`; `src/modules/management/contact-erasure/providers.ts`; `tests/journeys/erasure.mjs`; `tests/journeys/erasure-browser.mjs` |  |
| `AUDIT-001` | Security and accountable actions | target | done | `src/modules/audit/`; `migrations/180_account_security.sql`; `tests/journeys/identity.mjs`; `tests/journeys/erasure.mjs`; `tests/journeys/identity-browser.mjs` |  |
| `PORTABILITY-001` | Complete customer-owned portable support data | target | partial | `scripts/installer/local.mjs`; `scripts/installer/durable-objects.mjs`; `scripts/installer/portability-policy.mjs`; `scripts/installer/migration-ledger.mjs`; `scripts/export-d1.mjs`; `tests/journeys/installer-nightly.mjs`; `tests/journeys/restore.mjs`; `tests/helpers/platform-archive.mjs`; `tests/journeys/erasure.mjs` | Local `rer export` and `rer import` carry D1, R2 and Durable Object storage with schema and digest and restore inertly into a clean installation. A Platform-applied installation (`rer_migrations` ledger) exports, its archive restores into Platform and native destinations, and incomplete, multiple or mismatched migration ledgers refuse before any write (`tests/helpers/platform-archive.mjs`; released in v0.4.12). A hosted installation cannot produce that archive: `rer export --target remote` refuses, and only the SQL and R2 backup procedure (`scripts/export-d1.mjs`) exists. Base-data equivalence remains held. |
| `ASSURANCE-001` | Qualified regulated support deployments | target | missing |  | No implementation located. No regulated-deployment agreement/control qualification flow or compliance acceptance located. |
| `PUSH-001` | Reproduce, repair and prove customer recovery | push-further | partial | `src/modules/local-computer/results.ts`; `src/edition/delegation/routes.ts`; `tests/journeys/delegation.mjs`; `tests/helpers/delegation-journey/case.mjs` | Approved local repair, independent readback and human Send exist with an edge fixture; sustained customer recovery verification/reopening is incomplete. |
| `PUSH-002` | Promises survive every handoff | push-further | missing |  | No implementation located: obligation records with owner and due time, reminders and follow-up drafts are absent (durable messages and notes in `src/modules/conversations/admission.ts` are not obligations). |
| `PUSH-003` | Learn from reopenings under human control | push-further | missing |  | No implementation located: version-joined diagnosis of reopened cases, proposals and controlled rollout are absent (evaluation runs in `src/modules/training-runs/runner.ts` are generic). |
| `PUSH-004` | Turn verified edge cases into reviewed knowledge | push-further | missing |  | No implementation located: gap clustering from unanswered cases, sourced draft articles and recovery measurement are absent (article authoring in `src/modules/knowledge/authoring.ts` is manual). |
