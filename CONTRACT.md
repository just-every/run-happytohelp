# HappyToHelp target product contract

HappyToHelp is a complete customer-service help desk and AI support agent for a US SMB support lead switching from Zendesk, Intercom with Fin, Help Scout or Freshdesk. It carries customer intake through a shared queue, self-service and live business context to an authorized resolution and continued customer recovery; Decagon, Sierra and Pylon set the agent and procedure baseline.

## Product target

| | |
| --- | --- |
| Category | Customer service help desks and AI support agents |
| Incumbents a buyer switches from | Zendesk, Intercom (with Fin), Help Scout, Freshdesk |
| Up-and-comers it must also beat | Decagon, Sierra, Pylon |
| First buyer | US SMB support lead; USD; workspace IANA time zone |

The primary journey: Install and connect the help desk, receive a customer request, triage and assign it, resolve it with grounded business context, verify recovery and keep the customer’s follow-up promises.

## How to read this contract

- This follows the RER contract standard; Core, Agent surface and Later are separate tiers.
- Done means all acceptance points have recorded proof; local fixtures, live providers and production acceptance remain distinct.
- Field proof is visible in its register and never blocks a clause’s fixture completion.
- ACCEPTANCE.md, docs/CLAIMS.md and the Status summary are generated from this file.
- The accepted owner decisions, Knowledge partial scope, accessibility hold and production cutover boundaries remain in force in RULINGS.md and HANDOVER.md.

## Door rules

- **D-1.** Customer recovery is an observed customer-path outcome; a command succeeding or an engineering issue closing does not establish it.

## Shared duties (Base)

| Base duty | Duty | Delta clauses | Base journey |
| --- | --- | --- | --- |
| BASE-ACCESS-001 | Sign-in | IDENTITY-002 | not run |
| BASE-ACCESS-002 | Sessions | IDENTITY-001 | not run |
| BASE-ACCESS-003 | Public endpoints | IDENTITY-001 | not run |
| BASE-ACCESS-004 | Server-side authorisation | IDENTITY-001 | not run |
| BASE-INPUT-001 | Validation | CONTEXT-001 | not run |
| BASE-INPUT-002 | HTML | none | not run |
| BASE-INPUT-003 | Uploads | DESK-001 | not run |
| BASE-SECRET-001 | No leakage | CONNECTIONS-001, ACTIVATION-001, AUDIT-001 | not run |
| BASE-SECRET-002 | Startup | LOCAL-MAIL-001 | not run |
| BASE-DATA-001 | Export and import | MOVE-IN-001, REPORTS-001, MIGRATION-001, PORTABILITY-001 | not run |
| BASE-DATA-002 | Retention | none | not run |
| BASE-DATA-003 | Erasure | CONVERSATION-001, OUTCOMES-001, MIGRATION-001, ERASURE-001 | not run |
| BASE-DATA-004 | Outbound flows | CONTEXT-001, INTEGRATION-001 | not run |
| BASE-DATA-005 | Independence | NATIVE-001, SOURCE-001 | not run |
| BASE-PUBLIC-001 | Privacy | KNOWLEDGE-001, WIDGET-001 | not run |
| BASE-PUBLIC-002 | Origins | WIDGET-001 | not run |
| BASE-PUBLIC-003 | Accessibility | none | not run |
| BASE-OPS-001 | Health | none | not run |
| BASE-OPS-002 | Migrations | NATIVE-001, IDENTITY-002 | not run |
| BASE-OPS-003 | Idempotency | CONVERSATION-001, DELIVERY-001, CONNECTIONS-001 | not run |
| BASE-OPS-004 | Failure is visible | AI-001, TRAINING-001 | not run |
| BASE-OPS-005 | Audit | none | not run |
| BASE-ROLE-001 | Roles through every door | IDENTITY-001, DELIVERY-001, MOVE-IN-001, CONNECTIONS-001, KNOWLEDGE-001, NOTIFY-001, KNOWLEDGE-002, ACCESS-001, AUDIT-001 | not run |
| BASE-AUDIT-001 | Searchable, durable audit | OUTCOMES-001, CONNECTIONS-001, AUDIT-001 | not run |
| BASE-BACKUP-001 | Independent backup, restore and rollback | PORTABILITY-001 | not run |
| BASE-DATA-006 | Erasure respects retention and legal hold | ERASURE-001, AUDIT-001 | not run |
| BASE-SIGNIN-001 | Standards-based SSO and lifecycle | ACCESS-001 | not run |
| BASE-SIGNIN-002 | Native multi-factor authentication | IDENTITY-003 | not run |
| BASE-INSTALL-001 | Free self-host and removal | NATIVE-001 | not run |
| BASE-MAIL-001 | Truthful mail outcomes | LOCAL-MAIL-001, ACTIVATION-001, INTEGRATION-001, MAIL-001, NOTIFY-001 | not run |
| BASE-ACCESSIBILITY-001 | One accessibility bar | UI-001, PUBLIC-001, PUBLIC-002, MOBILE-001 | not run |
| BASE-DOCS-001 | On-site docs from one contract | PUBLIC-002 | not run |
| BASE-AGENT-001 | One MCP door per seed | API-001 | not run |
| BASE-AGENT-002 | The seed's jobs are tools, through the UI's own actions | AI-001, API-001, AGENT-001, SURFACE-001 | not run |
| BASE-AGENT-003 | Records are resources | SURFACE-002 | not run |
| BASE-AGENT-004 | Business identity and short-lived, audience-bound tokens | none | not run |
| BASE-AGENT-005 | An agent acts as a person in a role, never more | DELEGATION-001 | not run |
| BASE-AGENT-006 | Every action declares its risk class | SURFACE-001, SURFACE-003, SURFACE-004, SURFACE-005, SURFACE-006 | not run |
| BASE-AGENT-007 | The company's policy decides, at one chokepoint | AI-001, DELEGATION-001, API-001, KNOWLEDGE-002, AGENT-001, PROCEDURE-001, PUSH-001, PUSH-002, PUSH-003, PUSH-004, SURFACE-007 | not run |
| BASE-AGENT-008 | Truthful attribution | none | not run |
| BASE-AGENT-009 | Every agent action is audited with its class and decision | AGENT-002 | not run |
| BASE-AGENT-010 | Agents can follow changes | SURFACE-002 | not run |
| BASE-AGENT-011 | Limits are policy, and Pause stops everything | none | not run |
| BASE-AGENT-012 | Writes are idempotent and conflict-safe | none | not run |
| BASE-AGENT-013 | Manifest, docs and the conformance journey | SURFACE-001, SURFACE-002, SURFACE-007 | not run |

## Published clauses

- `NATIVE-001`: *Tier:* Core · *Cites:* BASE-INSTALL-001, BASE-OPS-002, BASE-DATA-005 · *Register:* R-3
- `IDENTITY-002`: *Tier:* Core · *Cites:* BASE-ACCESS-001, BASE-OPS-002
- `IDENTITY-001`: *Tier:* Core · *Cites:* BASE-ACCESS-002, BASE-ACCESS-003, BASE-ACCESS-004, BASE-ROLE-001
- `FIRST-RUN-001`: *Tier:* Core
- `LOCAL-MAIL-001`: *Tier:* Core · *Cites:* BASE-MAIL-001, BASE-SECRET-002 · *Register:* R-4
- `CONVERSATION-001`: *Tier:* Core · *Cites:* BASE-OPS-003, BASE-DATA-003
- `DELIVERY-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-OPS-003
- `UI-001`: *Tier:* Core · *Cites:* BASE-ACCESSIBILITY-001 · *Register:* R-1, R-2
- `MOVE-IN-001`: *Tier:* Core · *Cites:* BASE-DATA-001, BASE-ROLE-001
- `OUTCOMES-001`: *Tier:* Core · *Cites:* BASE-DATA-003, BASE-AUDIT-001
- `REPORTS-001`: *Tier:* Core · *Cites:* BASE-DATA-001
- `CONNECTIONS-001`: *Tier:* Core · *Cites:* BASE-SECRET-001, BASE-ROLE-001, BASE-OPS-003, BASE-AUDIT-001 · *Register:* R-4
- `ACTIVATION-001`: *Tier:* Core · *Cites:* BASE-MAIL-001, BASE-SECRET-001
- `AI-001`: *Tier:* Core · *Cites:* BASE-AGENT-002, BASE-AGENT-007, BASE-OPS-004
- `KNOWLEDGE-001`: *Tier:* Core · *Cites:* BASE-ROLE-001, BASE-PUBLIC-001
- `CONTEXT-001`: *Tier:* Core · *Cites:* BASE-DATA-004, BASE-INPUT-001
- `DELEGATION-001`: *Tier:* Core · *Cites:* BASE-AGENT-005, BASE-AGENT-007
- `TRAINING-001`: *Tier:* Core · *Cites:* BASE-OPS-004 · *Register:* R-8
- `INTEGRATION-001`: *Tier:* Core · *Cites:* BASE-MAIL-001, BASE-DATA-004 · *Register:* R-4
- `PUBLIC-001`: *Tier:* Core · *From:* PUBLIC-001 · *Cites:* BASE-ACCESSIBILITY-001 · *Register:* R-1
- `PUBLIC-002`: *Tier:* Core · *From:* PUBLIC-001 · *Cites:* BASE-DOCS-001, BASE-ACCESSIBILITY-001 · *Register:* R-1, R-2
- `MIGRATION-001`: *Tier:* Core · *Cites:* BASE-DATA-001, BASE-DATA-003
- `SOURCE-001`: *Tier:* Core · *Cites:* BASE-DATA-005

### Retained product and operating guarantees

#### NATIVE-001 — Native owner installation

**Requirement.** A clean owner can inspect the operating description before installing dependencies, install locked source, prepare local or selected remote bindings/migrations, build, verify and deploy through `rer`. Local setup exits with no app running; dev prints a private `RER_OPEN` address that enters as the real local owner through the rer dev v2 boundary, preserving native sessions, roles and passwords. Reset is explicitly confirmed and local; export/import preserve supported native data with documented exclusions. Deployment dry-run makes zero outbound requests and explicitly reports that fact. A separately and explicitly started read-only provider preflight uses the owner's scoped Cloudflare token with owner consent to read the account's Workers subdomain and the Worker's settings and secret names (three GETs for an existing Worker); it sends no mail and changes no resources. Dry-run and preflight are independent steps, neither a mock of the other. The delivered runtime requires no original checkout or PHP service.

**Acceptance.**
1. Use a clean checkout through rer describe/check, locked installation, setup, dev, verify, reset and export/import; preserve owner/data/settings and refuse unconfirmed destructive work.
2. For deployment dry-run, assert zero outbound requests and an explicit no-outbound report without provider credentials.
3. As a separate acceptance point, explicitly start the read-only provider preflight with owner consent and the owner's scoped token; assert only the three expected Cloudflare GETs for an existing Worker, no mail and no mutations, and refuse missing credentials or consent.
4. Prove the runtime works independently of the original checkout; separately qualify remote provisioning.

#### IDENTITY-002 — Retained native password identity

**Requirement.** Supersedes `BASE-ACCESS-001` under RL-1: HappyToHelp retains native passwords, its first-owner experience and prior account/workspace data. Native second factors add to passwords under IDENTITY-003; configured identity providers never replace that identity.

**Acceptance.**
1. Complete native password setup, login, recovery and workspace re-entry, then upgrade with prior owner credentials and data intact; configured providers must not replace native identity.

#### IDENTITY-001 — Scoped authority

**Requirement.** The native project and widget admission model distinguishes an operator, registered member and visitor. Public widget keys and origins are identifiers; visitor, registration and workspace-creation admission have the bounded limits in the [public limits](docs/PUBLIC-LIMITS.md). Provider configuration conveys no native actor authority.

**Acceptance.**
1. Through native session and widget routes, deny cross-tenant, blocked/deleted and revoked access; prove public admission returns 429 with Retry-After when limited and provider configuration conveys no actor authority.

#### FIRST-RUN-001 — A useful first workspace

**Requirement.** A single first-run screen provisions a useful workspace with editable derived identity, a starter assistant, mailbox and installation sender. Setup leads with widget installation, shows the remaining owner work and supports skip and Advanced. The [first-workspace rules](docs/first-workspace-spec.md) retain every provisioning, no-key, mailbox, sender, navigation and header condition.

**Acceptance.**
1. Run fresh first-owner setup and signed-in workspace creation to Setup and an installable widget; inspect derived editable name/color, starter assistant, mailbox/sender, skip/Advanced controls and mobile headers.
2. With no model key a new visitor stays with the team; with a configured provider exercise the capped starter under the company’s policy.
3. A workers.dev hostname must not become a business name.

#### LOCAL-MAIL-001 — Rer dev mail

**Requirement.** Trusted local development configuration uses the rer dev v2 development transport: it validates and suppresses visitor and teammate mail, reports `development`, stores no messages and exposes no mail viewer. It sends no external email and never claims delivery. The local owner enters automatically through the dev boundary; native password identity, ordinary hosted email-link confirmation and prior stored data are retained. Production has no local dev surface. Missing credentials or failed remote delivery never select a local substitute.

**Acceptance.**
1. Enter through rer dev v2; send visitor and teammate mail and prove development suppression without storage, viewer or external send; refuse forged and production dev entry and never substitute suppression for a failed hosted provider.

#### CONVERSATION-001 — Durable transcript

**Requirement.** Customer, operator, generation, import and administrative writers preserve stable message/command identity, revision/frontier, attachment ownership and final-reply admission atomically. Competing or repeated writes cannot admit two incompatible final replies. Owner/admin contact erasure removes message content while keeping identity, revision and frontier, so erased transcripts stay coherent.

**Acceptance.**
1. Race visitor, operator, model and import writers through conversation routes with duplicate and lost responses; admit only compatible final replies.
2. Erase a contact through the owner door and verify coherent identity/revision/frontier with content removed.

#### DELIVERY-001 — Live delivery and recovery

**Requirement.** Persist before broadcast; reconnect/outbox replay and socket authorization recover committed messages after reload, disconnection or process wake. Provisional AI deltas never become durable final answers until guarded admission succeeds.

**Acceptance.**
1. Disconnect/reconnect widget and operator sockets after persisted writes, restart the runtime and recover the same committed messages/attachments; unauthorized replay is denied and superseded AI deltas never become final replies.

#### UI-001 — Existing editable experience

**Requirement.** Reuse the original React dashboard, transcripts/drafts/suggestions, settings and Shadow DOM widget; preserve useful desktop/mobile flows, attachment display, collector/privacy controls and errors. Native routing and transport use the configured application origin.

**Acceptance.**
1. Use the native dashboard and separately installed widget at 1440 and 390 pixels with realistic conversations, attachments, drafts, errors and workspace switching; retain the approved desktop/mobile navigation and configured-origin transport.

#### MOVE-IN-001 — Reviewed history import

**Requirement.** Current workspace owner/admin reviewers privately upload, inspect per-kind plans, source-located omissions, rejections, conflicts and publication changes, then explicitly apply bounded, resumable imports of conversations, contacts, tags, saved replies and articles. Preserve source identities, timestamps, private notes and publication state; reject unsupported meaning rather than inventing it. Recheck current role and workspace authority for apply, resume and whole-import undo. Retain immutable source custody and conflict-safe reversal journals. Imports and undo send no mail, widget messages, model requests, assignment or connection notifications; imports are excluded from Reports. Native tag controls enforce workspace scope. Owner decision 2026-10-09 requires exact business-state repeat/undo equality, including contacts, conversations, messages, private notes, tags, source links and every other imported business table. Only platform counters/sequences, audit history and import journals are excluded. Synthetic 1,000-conversation datasets for Zendesk and Help Scout qualify this local flow.

**Acceptance.**
1. Through Move in, exercise all five kinds, source custody, per-row omissions/rejections/conflicts, current-role denials, inert apply/resume/repeat/undo and exact business-state equality for synthetic 1,000-conversation Zendesk and Help Scout datasets; counters/sequences, audit and journals are the only named exclusions.

#### OUTCOMES-001 — Resolution feedback and provenance

**Requirement.** Current original visitor sessions may rate a closed resolution with thumbs up/down and an optional comment up to 1,000 characters. Changes retain history; reopened cycles cannot receive the previous resolution's rating. Operators retain access to each past resolution's latest feedback after reopening; visitor eligibility and report denominators remain tied to the current cycle. Erasure removes rating comments. Confirmed operator-sent drafts establish assisted outcomes, otherwise confirmed human replies establish human outcomes. AI requires a complete visible answer history without a person handoff; missing evidence remains unknown. Status, assignment and cancellation transitions recheck current authority atomically.

**Acceptance.**
1. Close, rate, rerate, reopen and close again via widget/operator routes; prevent previous-session/cycle feedback, retain old-cycle operator visibility, redact erased comments and verify human/assisted/AI/unknown attribution from actual visible answers.

#### REPORTS-001 — Workspace calendar reports

**Requirement.** Native conversations created in the workspace IANA calendar range with at least one persisted message form the cohort; Move in and legacy imports are excluded. First visitor-to-visible-answer response and creation-to-first known-resolution durations use median and nearest-rank p90. Each conversation contributes its latest closed cycle once to outcome and satisfaction rates. Reopened conversations leave those denominators. Aggregate queries return bounded data; CSV streams every matching conversation with formula-safe cells. Empty widget conversations stay durable but are excluded from Reports and its analytics CSVs. A separate step-up guarded JSON export includes all workspace conversations, messages, private notes and attachment names across dates and imports; attachment bytes stay in the portable backup.

**Acceptance.**
1. Compare Reports and formula-safe CSV to hand-calculated response/resolution median and p90, latest-cycle outcome and satisfaction cohorts across DST and tenants, including more than 10,000 rows and excluded imports/reopened cycles.

#### CONNECTIONS-001 — Workspace integrations

**Requirement.** Owner/admin tokens have explicit scopes, optional expiry, one-time display, hashed storage and durable audit. Bearer-only API calls have no CORS, per-token limits and native guarded writes. Contact erasure fences API identity restoration and pending event payloads. Native events commit tenant-bound webhook and Slack intents; historical import apply and undo do not emit them. Slack projects bounded native visitor text through Base escaping. HTTP 500 stays uncertain and is not replayed; 429 retains bounded retries. Under RL-3, this consumer uses ordinary platform HTTPS fetch through the unchanged Base wire interface. It refuses every 3xx with manual redirect handling, enforces a 10-second timeout, a 1 MiB request limit and 64 KiB streamed-response limit. Destination syntax and literal IP validation remain enforced. The transport exception is confined to this edition’s consumer; copied Base contracts retain their requirements. 

**Acceptance.**
1. Issue, use, expire and revoke each scoped show-once token; exercise native API operations, erasure fences, signed events and Slack escaping.
2. Refuse redirects/unsafe literal destinations and over-limit traffic; preserve timeout, streamed bounds, uncertain 500 without replay and bounded 429 behavior under the recorded HTTPS override.

#### ACTIVATION-001 — Observed owner setup

**Requirement.** Setup presents the workspace’s eight-step observation inventory, distinguishes work the owner must do from observed work, and permits durable skip and undo without inventing confirmation. The [observation rules](docs/setup-observation-spec.md) retain every freshness, invalidation, sender, counting and secret-custody condition.

**Acceptance.**
1. Read Setup without side effects, observe fresh/expired/rejected configuration and explicit provider outcomes, skip/undo owner steps and reload.
2. A skip or preset never counts as confirmation; local suppression never proves delivery; keys/fingerprints remain server-only and uncertain explicit test/welcome mail is never replayed.

#### AI-001 — Configured model execution

**Requirement.** Retain Ensemble model selection, context/tools, streamed events, normalization, raw per-round provider usage, attribution, bounded suggestions and reply lifecycle. Missing providers fail explicitly when AI is asked for, and a default assistant whose provider has no key is simply not assigned to new conversations; uncertain provider attempts remain uncertain and are not replayed automatically. Usage is diagnostic/provider accounting data, not an active payment, balance or debit system. Visitor-caused automatic AI work is capped per UTC day per project and installation (`AI_DAILY_CEILINGS`); a skipped reply is recorded as terminal and never replayed.

**Acceptance.**
1. Request configured suggestions/replies through native routes; inspect normalized streaming events, per-round usage, context/tool and budget bounds, explicit missing-provider errors and durable daily-cap skips; crash/ambiguous attempts must not automatically replay.

#### KNOWLEDGE-001 — Published knowledge

**Requirement.** Dataset ingestion/crawl, retained corpus, lexical/selected semantic retrieval, citations and article/category authoring maintain project scope and publication state. A failed refresh cannot replace the last usable published corpus. Public pages exclude drafts/deleted projects and preserve original canonical article/search routes.

**Acceptance.**
1. Publish and search articles/categories through authoring and public help-center doors; deny draft/deleted/cross-project access, verify citations and canonical links and retain the last usable published corpus after a failed refresh.

#### CONTEXT-001 — Attributed customer context

**Requirement.** Profiles, monitoring, insights and context packets preserve evidence attribution, source bounds, consent and project ownership. Provider output must satisfy the selected schemas before becoming usable customer context.

**Acceptance.**
1. Generate/read profile, monitoring, insight and context packets through native routes; reject ungrounded/schema-invalid or cross-project content, preserve attributed evidence and respect consent/source bounds.

#### DELEGATION-001 — Explicit local authority

**Requirement.** Pairing, devices/grants, revocation, tool context and work/result states preserve investigation, resolve and advance-authorized resolve-and-reply distinctions. Revocation withdraws authority and never asserts that a local process stopped: started work becomes terminal with an unconfirmed outcome, and only the device may report cancellation. Local processes remain in the optional connector, never an implicit Worker capability. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. Pair the packaged connector, investigate, separately authorize a child fix, obtain a distinct read-only observation and use human Send with exact-request replay.
2. Refuse stale/revoked/offline/unverified/uncertain work and distinguish resolve from advance-authorized resolve-and-reply; revocation cannot assert process cancellation.

#### TRAINING-001 — Durable evaluation

**Requirement.** Training and evaluation preserve run/case state, model/budget selection, raw provider usage and cancellation/recovery. Synthetic data admission is explicitly local/test-only. Historical pending attempts require reconciliation; a fixture pass is not live-provider quality acceptance.

**Acceptance.**
1. Create, run, cancel and recover persisted evaluations through training routes with model/budget selection and raw usage; reconcile historical pending/uncertain attempts and keep synthetic admission local/test-only, with live quality qualification separate.

#### INTEGRATION-001 — Honest external effects

**Requirement.** Email/inbound mail, GitHub, branding and knowledge imports use configured native adapters, tenant-scoped credentials, durable identity and ambiguous-outcome handling. Website previews use a separate origin, scoped expiring grants and public-network restrictions. Machine-generated inbound mail never triggers autonomous AI replies, notifications or outbound email; its classification is recorded before admission and survives recovery and redelivery. The `email:` message local-id prefix is reserved for inbound claims and refused by the message API. Shopify, Stripe and CRM support actions are required by COMMERCE-001, BILLING-001 and CRM-001. HappyToHelp never holds funds or becomes a payment processor; historical imported balances remain custody records, not executable authority.

**Acceptance.**
1. Use configured email, inbound mail, GitHub and knowledge-import public doors; test idempotency, machine-generated-mail suppression, separate-origin preview grants and network denial.
2. An operator reply emails the visitor even with an online/unverified widget; a visitor address matching the reply sender is intentionally excluded and the message status explains that cause.
3. Test accepted, failed and uncertain outcomes without invented delivery; business-action evidence is also required by COMMERCE-001, BILLING-001 and CRM-001.

#### PUBLIC-001 — Public product source

**Requirement.** The approved homepage keeps its hero, free MIT source promise, support-desk cards, migration steps, closing call and signed footer in their approved order and visual language. The [public product specification](docs/public-product-spec.md) retains every copy, drawing, typography, motion, link and marketing boundary. Target expansion never authorizes changing those claims.

**Acceptance.**
1. Exercise the approved homepage and detailed public product specification at 1440 and 390, including its copy, drawings, real links, keyboard use and reduced motion; target requirements do not authorize changed marketing claims.

#### PUBLIC-002 — Published documentation and help-center doors

**Requirement.** The on-site documentation uses the approved public visual language, section navigation, contents, source links and branded unknown-page response. Every build reflects current listed Markdown and refuses an unlisted file. Dynamic help centers retain the project, publication and canonical-route behavior of KNOWLEDGE-001.

**Acceptance.**
1. Exercise the published Markdown manifest and link validation on desktop and mobile, including the branded unknown-page response.
2. Open dynamic help-center pages and searches, retain canonical links and deny draft or deleted-project content.

#### MIGRATION-001 — Prior-data custody

**Requirement.** Explicit legacy artifacts preserve IDs, exact historical financial values, transcripts, object hashes, publication and permissions through resumable guarded D1/R2 import. Historical financial SQL, imported rows and reconciliation holds remain immutable archive custody; they never become active payments, balances or provider work. The one exception is an explicit owner/admin contact erasure: it takes precedence over archive custody for that contact's personal data and redacts the imported rows and their verbatim archive copies (row digests are kept, so replaying the bundle does not restore them), leaving a `contact_erasures` audit tombstone. Old credentials do not become trusted native authority.

**Acceptance.**
1. Import representative legacy IDs, permissions, exact historical financial values and media hashes through local D1/R2; resume safely and refuse conflicts without external work.
2. Erase an imported contact and prove archive redaction plus tombstone/digest fencing prevents restoration of erased personal data.

#### SOURCE-001 — Author-owned capability graph

**Requirement.** The edition selects maintained source with inspect/check/lock/release commands. Shared capabilities include substantial implementation, migrations and meaningful tests; a second consumer preserves its own policy. Release excludes credentials/private fixtures and retains asset provenance/licensing obligations. Original work is preserved.

**Acceptance.**
1. Run inspect/lock/check and offline Base-copy verification on staged intentional source, exercise origin/drift/mode refusals and release only the selected licensed tree without credentials or private fixtures; source custody alone is not product acceptance.

## Target clauses

### Support operations

#### DESK-001 — The shared support desk

*Tier:* Core · *Cites:* BASE-INPUT-003

**Requirement.** A visitor starts website live chat, identifies themselves under the workspace policy, sends files and returns to their history. Humans see one durable shared inbox with customer history, scoped retained-history search with words, quoted phrases and literal customer-identity matching, open/closed/mine/unassigned/AI/tag filters and saved replies that insert into the composer without silently sending. Ticket status follows the STATUS-001 lifecycle and saved replies extend to MACRO-001 action macros. Replies, attachment downloads and errors are visible on both sides; privacy/collector controls remain effective.

**Acceptance.**
1. Through the installed widget and operator inbox, exchange messages and real attachment bytes, search/filter the resulting queue, insert and edit a saved reply, reload both sides and deny another tenant the same records.

#### WIDGET-001 — Availability-aware messenger and proactive messages

*Tier:* Core · *Cites:* BASE-PUBLIC-001, BASE-PUBLIC-002

**Requirement.** The messenger shows team availability from business-hour schedules (SLA-001) and live agent presence. When no human or permitted AI assistant is available it says so with the expected reply time, captures the visitor's email (or, where consented, SMS/WhatsApp under CHANNELS-001) so the answer reaches them, and creates the ticket instead of leaving the visitor waiting. Leads configure proactive messages triggered by page URL, time on page, scroll depth, exit intent, visitor attributes, returning visit or cart value, with audience, brand, frequency caps and quiet hours. Each proactive message shows a clear sender identity and an easy dismiss, respects consent and collector settings, and never starts a conversation that sends personal data on the visitor's behalf. Impressions, opens, dismissals and resulting conversations and resolutions are reported. This clause backs the homepage hero's "Before they ask".

**Acceptance.**
1. Outside configured hours, open the installed widget, see the offline message and expected reply time, leave an email and verify the ticket and the emailed answer.
2. During hours with no agent online verify the same; with an available AI assistant verify it answers and discloses itself.
3. Configure a proactive message on a checkout URL after 20 seconds with a once-per-day cap; verify it appears once, dismisses, stays silent under a declined collector setting and appears in reports with its impressions and conversations.

#### MAIL-001 — Complete support email

*Tier:* Core · *Cites:* BASE-MAIL-001 · *Register:* R-4

**Requirement.** Connect inbound forwarding, an IMAP/SMTP mailbox, Gmail/Google Workspace or Microsoft 365/Outlook using scoped credentials/OAuth. New mail creates tickets and replies thread by stable Message-ID/In-Reply-To/References with deliberate handling of changed subject, aliases and multiple recipients. Operators manage CC/BCC, attachments, signatures and branded sender/reply addresses. Duplicate/redelivered mail, bounces, spam and auto-responders cannot create loops or send twice, and mail classified as spam or failing sender checks goes to the reviewable Suspended view of MAIL-002; reconnect/backfill has a visible cursor and errors, and removal stops new intake without deleting history.

**Acceptance.**
1. For each of forwarding, IMAP, Gmail and Microsoft 365, use the connection UI and provider sandboxes or official-schema fakes to receive a new thread, reply from the inbox, receive its follow-up and attachment, disconnect/reconnect with redelivery and observe bounce/permission failure.
2. Verify no duplicate ticket/reply or machine-mail AI loop; keep provider-protocol tests separate from live acceptance.
3. Spam and failing-sender mail reaches the MAIL-002 Suspended view, not a ticket.

#### MAIL-002 — Reviewable suspended and spam mail

*Tier:* Core

**Requirement.** Inbound mail that is spam-scored, fails DMARC/SPF/DKIM or alignment, comes from a blocked sender or domain, forges a verified customer's address, exceeds size limits or is a detected mail loop is never silently dropped. It lands in a Suspended view with its reason, authentication results, headers and safely previewed attachments, and creates no ticket, AI work, acknowledgment or notification. Permitted operators recover a false positive into a normal ticket that threads correctly (into the existing ticket when its references match) without retroactively triggering acknowledgments or AI unless they choose to; delete true spam; and block or allow a sender or domain. Recovery, deletion and list changes are audited. Suspended mail is kept for a stated retention period (default 14 days) and then explicitly deleted with an audit record; the view shows counts and the oldest age so nothing ages out unseen. Allow/block lists and suspension reasons are reportable.

**Acceptance.**
1. Through real inbound doors deliver a spam-scored message, a DMARC-failing message, mail from a blocked sender and a forged From of a known customer; verify each appears in Suspended with its reason and creates no ticket, AI request or outbound mail.
2. Recover the DMARC-failing message into a new ticket and another into its existing thread, delete the spam, allow-list a sender and redeliver.
3. Advance the clock past retention at the runtime edge and verify explicit, audited deletion; refuse every action to a role without permission.

#### OUTBOUND-001 — Agent-created and proactive tickets

*Tier:* Core · *Register:* R-4

**Requirement.** From the inbox an operator creates a ticket for an existing or new contact: search by name, email or phone or create the contact inline under CUSTOMER-001 identity rules; choose brand, sender address, channel, form, fields, assignee and group; and make the first comment public or an internal note. A public first comment is sent as an outbound email, or, where the customer consented, as an approved SMS/WhatsApp template under CHANNELS-001. The customer is recorded as requester and the operator as submitter, and the customer's reply threads into the same ticket. Logging a phone call or walk-in creates a ticket without contacting the customer. Proactive service notices to several customers (for example a delayed order) create one ticket per requester with a preview, consent checks and rate limits, never send twice on retry and remain distinct from marketing campaigns, which belong to Mango.

**Acceptance.**
1. From the inbox create a ticket for an existing contact and one for a new contact, send the first public email, reply as each customer from a real mailbox and confirm the reply threads into the created ticket with requester and submitter attribution.
2. Create an internal-only ticket (no send), a WhatsApp-template ticket to an opted-in number and one to an opted-out number (refused), and a proactive notice to three contacts with one failed send; verify no duplicate send on retry and refusal for an operator without create authority.

#### CHANNELS-001 — Messaging and social support

*Tier:* Core · *Register:* R-10

**Requirement.** Connect US SMS through Twilio and WhatsApp Business, Instagram Direct and Facebook Messenger through authorized Meta business accounts. Inbound messages, supported media, delivery states and channel identity enter the shared inbox; replies return in the original channel. Respect consent, opt-out, A2P 10DLC registration, approved WhatsApp templates and channel reply windows; an expired window becomes an actionable blocker with an approved continuation, never silent loss or unauthorized cross-channel contact.

**Acceptance.**
1. Using each connected provider account, exchange a customer message/media and operator reply in one mapped conversation, redeliver a signed event, revoke the connection and exercise opt-out and expired-window/template refusal with visible delivery failure and no duplicate send.

#### CHANNELS-002 — B2B shared-channel support

*Tier:* Core · *Register:* R-10

**Requirement.** Slack Connect and Microsoft Teams customer channels become authorized support intake, with thread replies, attachments, requester/account mapping and internal/private separation. The team can acknowledge, assign and hand off from Slack/Teams while the canonical support record retains the thread and current status. Installed-channel permissions, edited/deleted events, duplicates and disconnected channels have explicit behavior; Slack notifications alone do not satisfy this clause.

**Acceptance.**
1. Install scoped Slack and Teams apps, open support threads from allowed customer channels, reply and assign from both surfaces and observe bidirectional updates/reconnect.
2. A private note, disallowed channel or revoked workspace must never leak into customer channels.

#### VOICE-001 — Telephone service and unified voice agent

*Tier:* Core · *Register:* R-10

**Requirement.** Connect Aircall and Twilio Voice numbers for inbound/outbound customer support, business-hours routing, IVR, queues, transfers, voicemail and missed-call follow-up. Calls, consented recordings/transcripts and summaries attach to the customer conversation. The same governed AI procedures can serve voice, email and chat, with immediate human transfer and visible failed transfers; disclose automated agents and obtain recording consent under the configured US jurisdiction.

**Acceptance.**
1. Call a connected support number through IVR to an agent, transfer to a human, leave voicemail after hours and call back from the inbox; verify consent, transcript/recording access, linked history, failed-transfer escalation and erasure.
2. Use the provider-approved emergency-calling test procedure to verify number/location routing and disclosed limitations before launch.
3. Repeat an approved procedure across voice/chat/email and inspect one consistent authority policy.

#### QUEUE-001 — Assignment rules and available teams

*Tier:* Core

**Requirement.** Support leads define teams, membership, skills, capacity, availability and routing rules by channel, brand, language, account, tag or priority. Route to a named owner, team, round-robin or capacity-aware queue; explain which rule won, prevent starvation and preserve fair state across restarts. Manual takeover, absent/offline assignees, reassignment and unassigned overflow always leave a visible responsible queue.

**Acceptance.**
1. Configure two teams and a round-robin rule through settings, admit concurrent tickets through real channel routes, change availability and restart; verify ownership, fairness, overflow, explainable decisions and current-role refusal on manual takeover.

#### TRIAGE-001 — Intelligent triage

*Tier:* Core

**Requirement.** Each new ticket and customer message is classified for intent (from a lead-editable taxonomy with US commerce and SaaS defaults), sentiment and language, with a confidence score and the quoted evidence, by the configured model within AI-001 budgets. The predictions become ticket fields that QUEUE-001 routing, SLA-001 priority, AUTOMATION-001/002 conditions, views, AGENT-001 procedure selection and reports can use. A low-confidence prediction routes to the default queue instead of guessing. Operators correct a prediction and the correction is recorded as a label; leads see accuracy per intent against those labels before enabling a prediction for routing. With no model key there is no prediction, shown as unavailable and never invented.

**Acceptance.**
1. Enable triage and send messages with clear intents, negative sentiment and Spanish text through email and the widget; verify the fields, quoted evidence and confidence on each ticket, and that an intent routing rule and a negative-sentiment priority rule act.
2. Send an ambiguous message (low confidence, default queue), correct a prediction and verify the accuracy report.
3. Remove the model key and verify triage shows unavailable and routing still works.

#### QUEUE-002 — Structured and bulk queue work

*Tier:* Core

**Requirement.** Operators manage workspace-scoped tags, typed/validated custom issue fields (including values customers submit through FORMS-001) and priorities, and statuses from the STATUS-001 lifecycle; saved views can filter and sort on them. Leads select tickets and bulk assign, tag, change priority/status or apply a permitted MACRO-001 macro with a preview, per-record authority checks and a complete partial-failure result. Bulk actions cannot publish replies or reveal another workspace accidentally.

**Acceptance.**
1. Create a custom field and priority view, bulk-update mixed eligible/stale/forbidden tickets from the inbox and reload; verify each permitted effect, rejected reason, audit and lack of cross-tenant changes.
2. Bulk-apply a macro and filter a view by STATUS-001 status and a form-submitted field.

#### QUEUE-003 — Collaboration without conflicting replies

*Tier:* Core

**Requirement.** Internal notes and @mentions notify only permitted teammates; followers (internal CCs, distinct from customer CCs and never shown to the customer) receive updates under NOTIFY-001; viewing, typing and unsent-draft indicators warn of collisions before send. Guarded send still refuses stale replies. Operators save personal/shared work views and reusable replies/macros with scoped permissions; private notes and drafts never appear in customer channels, forwarding or public history.

**Acceptance.**
1. Use two signed-in operators on the same ticket: type, mention, save a view/reply, race sends and reload.
2. Confirm early collision warnings, one admitted final reply, scoped mention delivery and no private content in the visitor transcript.
3. Add a follower and verify updates reach them and never the customer.

#### MACRO-001 — Action macros with placeholders

*Tier:* Core

**Requirement.** Operators apply a personal, group or shared macro that in one action sets the reply text (public or internal note), status, priority, tags (add or remove), assignee and group, followers, custom fields and attachments. Reply text supports placeholders for the requester's name, first name and email, ticket ID, subject and link, assignee, brand, organization, and custom ticket and contact fields, with explicit fallbacks (for example first name, else "there"). Applying a macro previews every change and puts the rendered text in the composer for editing; nothing is sent until the operator sends. A placeholder that cannot be resolved is flagged and blocks sending instead of reaching the customer as a literal. Macros are versioned, permission-scoped by role, group and brand, searchable, usage-reported and applicable in bulk (QUEUE-002). An agent’s macro recommendation is standard; applying it carries standard and adds external when the result exposes content outside the business. The company’s policy decides each call.

**Acceptance.**
1. From a ticket, apply a shared macro that sets status Pending, adds a tag, assigns a group and agent, sets a custom field and inserts a reply using the requester's first name and ticket ID; inspect the preview, edit the text, send and reload.
2. Apply it to a requester with no name (fallback used) and with a placeholder for an absent custom field (flagged, send blocked).
3. Verify a role without macro access cannot apply it, bulk application reports per-ticket results and the customer sees only the rendered text.

#### QUEUE-004 — Snooze and scheduled follow-up

*Tier:* Core

**Requirement.** Snooze a ticket until an exact timezone-aware time or a dependency; incoming customer replies wake it immediately. Schedule outbound service replies, see/cancel/edit them before send and prevent stale queued replies after a customer response or reassignment. Each follow-up has a responsible owner, due time, stop condition and visible pending/failed/uncertain outcome; restarts cannot lose it or resend an ambiguous attempt.

**Acceptance.**
1. From a ticket, snooze, schedule and cancel replies, then inject customer responses before/at the due time and restart the worker/executor.
2. Observe a single wake/send or explicit refusal, overdue ownership and uncertainty without automatic replay.

#### STATUS-001 — Ticket status lifecycle

*Tier:* Core

**Requirement.** Every ticket has one status from a lifecycle the lead can extend: New, Open, Pending (waiting on the customer), On-hold (waiting on an internal team or third party), Solved and Closed, plus workspace custom statuses that each map to one of those categories. A customer reply to a Pending or On-hold ticket returns it to Open and wakes its owner. On-hold and every internal status label are never shown to the customer, who sees an open request in the widget, portal and email. A customer reply to a Solved ticket reopens it. After a lead-configured period (default 4 days) a durable time-based automation (AUTOMATION-002) moves Solved to Closed, and Closed is final: a customer reply to a Closed ticket creates a new follow-up ticket linked to it that carries the requester, CCs, tags and fields. Status filters, sorts, views, bulk edits (QUEUE-002), SLA pausing (SLA-001), resolution cycles (OUTCOMES-001) and reports all use this lifecycle, and every change records its actor, time and source (person, rule, automation or customer reply).

**Acceptance.**
1. Through the inbox, widget and email routes, move a ticket through New, Open and Pending, reply as the customer and observe Open with an owner wake.
2. Set On-hold and read the widget, portal and email views for absence of the internal state.
3. Solve it, reply as the customer and observe reopen; solve again, advance the clock at the runtime edge past the close period and observe Closed by automation; reply to the Closed ticket and observe a new linked follow-up ticket with the carried fields.
4. Create a custom status in the Pending category and confirm SLA pausing and report attribution; refuse a status change by a forbidden role.

#### SLA-001 — Business-hour service commitments

*Tier:* Core

**Requirement.** Leads configure first/next response and resolution SLAs by priority, customer plan, channel and brand, using US IANA timezones, weekly hours and holiday calendars. Show due times and pause reasons in the queue; Pending pauses customer-wait clocks and On-hold follows the policy's stated choice under the STATUS-001 lifecycle, and reopen restarts the next-response clock. Durable approaching-breach, breach and unattended-ticket alerts escalate to named backups through inbox/email/Slack/Teams and persist until acknowledged or resolved.

**Acceptance.**
1. Configure two calendars and policies through settings; admit/reply/pause/reopen tickets across a holiday and DST boundary, restart and advance the test clock at the network/runtime edge.
2. Compare displayed due times and breach/workload reports to hand calculations and confirm escalation/acknowledgment and no duplicate alerts.
3. Verify Pending pauses and On-hold follows the configured policy.

#### AUTOMATION-001 — Explainable durable support workflows

*Tier:* Core

**Requirement.** Leads version event-triggered condition/action rules (on ticket create and update) for routing, tagging, priority/status, reminders, customer updates and refund-exception escalation; actions include notifying the requester and CCs, the assignee, the group or followers (NOTIFY-001), adding an internal note and calling a signed webhook. Time-based conditions are AUTOMATION-002. Preview the effect against historical tickets in a workflow sandbox without real sends, then publish explicitly. Ordered/conflicting rules, loop prevention, owner, due time and stop condition are inspectable. Background execution persists decisions and failure/uncertainty across handoffs and restart; operators pause, cancel or reconcile work without blind retries.

**Acceptance.**
1. Configure and simulate a route/tag/status/reminder rule through workflow settings; prove sandbox sends no external effects.
2. Publish it, create matching/nonmatching tickets, cause a provider failure and process restart, inspect the chosen rule and terminal result and pause it before another side effect.
3. Include a notify-assignee and a customer-update action and verify one send to the permitted recipient only.

#### AUTOMATION-002 — Time-based automations

*Tier:* Core

**Requirement.** Leads define automations that run at least hourly over New, Open, Pending, On-hold and Solved tickets. Conditions include hours since created, updated, assigned, requester update, agent update, Pending, On-hold, Solved and SLA due, in calendar or business hours (SLA-001 schedules), combined with status, priority, tag, form, field, brand, channel and group. Actions set status, priority, tags, fields and assignee or group, add an internal note and send a templated customer or teammate notification (NOTIFY-001). An automation must include a condition its own action nullifies, or it fires at most once per ticket, so it cannot repeat; publishing one that could loop is refused. Runs are durable across restart, never replay an uncertain send, and record which automation changed what. Ready templates cover the common cases: nudge the customer after 48 business hours in Pending, auto-solve after 96, and close Solved after N days.

**Acceptance.**
1. Through workflow settings create the Pending nudge at 48 hours and auto-solve at 96 hours and a Solved-to-Closed automation; preview them against current tickets with no side effects.
2. Seed tickets at known times, advance the clock at the runtime edge across an hourly boundary, a weekend and a DST change, and restart mid-run.
3. Verify exactly one nudge per ticket, auto-solve at the configured business time, no action after a customer reply resets the condition, refusal to publish a repeating automation and "automation <name>" recorded as the actor of each change.

#### NOTIFY-001 — Customer acknowledgments and teammate notifications

*Tier:* Core · *Cites:* BASE-MAIL-001, BASE-ROLE-001 · *Register:* R-4

**Requirement.** Default, editable triggers send the requester and CCs one "request received" acknowledgment for a new ticket (per channel and brand, with the ticket reference and expected reply time), a notification when a public reply is added, and a solved notice. Machine-generated mail, suspended mail (MAIL-002), imports and merges never trigger them, and each ticket receives at most one acknowledgment even under redelivery. Teammates are notified by inbox, email, push (MOBILE-001) and Slack/Teams: the assignee on assignment and on customer update, the group on unassigned group tickets, followers on update and mentioned teammates on mention, each according to personal preferences and current permission to the ticket, workspace and brand. Templates use MACRO-001 placeholders with a visible failure for a missing value. Every notification carries loop-suppression headers and records its delivery outcome; an uncertain send is never replayed.

**Acceptance.**
1. Create tickets through email, the widget and a request form with a CC, redeliver the same inbound message and send an auto-responder; verify exactly one acknowledgment to the requester and the CC and none for the auto-responder, an import or a merge.
2. Assign the ticket, add a follower, update it as the customer and mention a teammate; verify each notification reaches only permitted current members according to preference, a revoked member receives nothing, a group notification reaches the group and an uncertain provider send stays uncertain without a second send.

#### CONVERSATION-002 — Merge and external forwarding

*Tier:* Core

**Requirement.** Merge duplicate tickets with an explicit surviving thread, source links, attribution, attachments, notes, SLA/outcome treatment and reversible history where safe. Forward selected customer-visible content to an external partner and thread their reply back while clearly distinguishing an external participant from a teammate. Customer identity, private notes and channel restrictions are previewed; merges cannot cross tenants or silently erase evidence.

**Acceptance.**
1. Merge two duplicate tickets via the inbox, inspect both source histories and reports, then forward selected content to a partner and receive their reply.
2. Verify no private note leaks, no duplicate customer send, explicit unsafe-undo refusal and no cross-workspace merge.

#### CONVERSATION-003 — Problem and incident linking

*Tier:* Core

**Requirement.** An operator marks a ticket as a Problem and links Incident tickets that report the same issue, manually, from search or from a TRIAGE-001 or agent suggestion, whose application carries standard and any external exposure class under the company’s policy. The problem lists its incidents with customers and counts. Solving the problem can, with a previewed public reply that uses MACRO-001 placeholders per requester, solve or update every linked incident in its own channel, each reply going only to that incident's requester, with per-ticket outcomes and consent and reply-window checks. Incidents keep their own SLA, history and CSAT; unlinking is audited. A problem can link an ESCALATION-001 engineering issue so that one shipped fix updates every affected customer.

**Acceptance.**
1. Create a problem and link five incidents arriving by email, widget and SMS; solve the problem with a previewed bulk update and verify each requester receives only their own reply in their channel, an incident whose reply window expired is reported blocked, no customer sees another's identity and each incident keeps its own status, SLA and CSAT invitation.
2. Unlink one incident before solving and verify it is untouched.

#### CUSTOMER-001 — Customer and company support records

*Tier:* Core

**Requirement.** Maintain contacts, verified linked channel identities, companies/accounts, account members, custom attributes, consent/preferences and all interaction history. Link/unlink or merge identities with preview and source provenance; email text alone never grants access. Show current business-system context with last sync time, permission and unavailable/stale state, plus account-level open work and relationship history. Import contacts and companies from CSV outside a vendor migration with column mapping, validation, duplicate matching by email or external ID, a dry-run preview and whole-import undo; such imports send nothing.

**Acceptance.**
1. Open one customer arriving over chat/email/social, explicitly link their verified identities and company, inspect account tickets and edit attributes; attempt an unauthorized identity merge, deny another account history and show stale connector context after disconnect.
2. Import a contacts-and-companies CSV with a duplicate and an invalid row; preview, apply and undo with no send.

#### COMMERCE-001 — Shopify order actions

*Tier:* Core · *Register:* R-11

**Requirement.** Connect Shopify stores with merchant-granted scopes; show customer orders, fulfillment, delivery, return and refund state in the conversation. Authorized agents/humans can perform permitted return, cancellation and full/partial refund actions with USD amounts, tax/shipping implications and a reason. Preview the exact order/action, apply the company’s policy to the money class and any external or commitment class, with the USD amount and counterparty, use provider idempotency and verify provider state before telling the customer it succeeded. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. Connect a Shopify test store through settings, find a customer order from a ticket, approve a bounded partial refund/return or cancellation and read back the order/provider ledger.
2. Deny excess/refused/revoked scopes, double clicks and cross-store access; a timeout remains pending/uncertain until reconciliation, with no second refund.

#### BILLING-001 — Stripe billing and subscription resolution

*Tier:* Core · *Register:* R-11

**Requirement.** Connect Stripe for customer/payment/invoice/subscription context and permitted refunds, credits and subscription cancellation, pause or plan changes. Show USD totals, tax/proration/effective-date consequences and linked provider records; separate read, prepare, approve and execute authority. Agent calls carry money and, for binding subscription changes, commitment; the company’s policy decides their disposition and spending limits. Reconcile actual provider state after timeout and report what changed in the original conversation. No raw card data or customer funds enter HappyToHelp. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. From a support ticket linked to a Stripe test customer, inspect an invoice, approve a bounded refund and a subscription change and verify provider readback plus customer-visible results.
2. Exercise duplicate requests, proration preview, denied approval and an uncertain timeout without double money movement.

#### CRM-001 — Live CRM and account context

*Tier:* Core · *Register:* R-11

**Requirement.** Connect Orbit, HubSpot and Salesforce independently; map contacts, companies/accounts, support entitlements, plan and owner to support records with source IDs and sync freshness. Read relevant CRM context and write only explicitly scoped support outcomes/approved field changes. Conflicts, identity mismatch and revoked grants are surfaced; the CRM remains the sales/account system of record. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. For each named CRM, connect a test account through settings, map a customer, change source entitlement and refresh the ticket, publish an approved support outcome and disconnect.
2. Verify conflict handling, read-only scope refusal and no cross-account data exposure.

#### ESCALATION-001 — Engineering and team escalations that return

*Tier:* Core · *Rules:* D-1 · *Register:* R-11

**Requirement.** Create or link GitHub Issues, Linear and Jira issues and Slack/Teams handoffs from a conversation, choosing exactly what context/attachments to share. Persist reciprocal links, assignee, status and dependency; signed provider updates return to the support thread, wake its owner and draft a customer update when a fix ships. Issue closure alone never proves customer recovery; an agent’s customer publication carries external and the company’s policy decides it. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. From a ticket, create/link an issue in each named tracker and a Slack/Teams handoff; receive duplicate/out-of-order provider status updates and close the issue.
2. Verify one linked escalation, refreshed ticket state, private-content exclusion and an approved customer update with recovery still unconfirmed until observed.

#### API-001 — Owned API and managed connectors

*Tier:* Core · *Cites:* BASE-AGENT-001, BASE-AGENT-002, BASE-AGENT-007 · *Register:* R-12

**Requirement.** Expose a documented versioned HappyToHelp API and signed outbound webhooks for conversations, contacts, articles and support events with scoped authorization, pagination, stable cursors, idempotency and revocation. Provide Zapier actions/triggers and managed MCP tools with the same tenant/action boundaries. Offer Help Scout Inbox API/webhook read synchronization for staged migration/coexistence, with cursors and deduplication; it is separate from native API authority. Connection health, scopes, event attempts and manual reconciliation are visible. Creating and appending support requests from another product or agent with credentials bound to a source product is API-002.

**Acceptance.**
1. Use a scoped client to page/export records and perform native guarded writes, validate a signed webhook and revoke the token.
2. Exercise a Zapier trigger/action, MCP read and a write refused by the company’s held policy and Help Scout incremental ingestion with duplicate events/reconnect; verify no replay of old imports or erased identities.

#### API-002 — Source-product credentials and bindings

*Tier:* Core · *From:* API-002

**Requirement.** An owner or administrator issues, inspects, rotates and revokes named source-product credentials, with independent scopes, exact bindings and owner-chosen overlap. The [support-request API specification](docs/support-request-api-spec.md) defines their metadata, bounds and rotation behavior.

**Acceptance.**
1. issue a create-only, an append-only, a read-only and a full credential, observe each secret once, confirm the stored value is a hash and Settings shows prefix, source product, scopes, bindings, expiry and last used.
2. bind a credential to one mailbox and brand and prove a create for another mailbox or brand is refused with `outside_credential_bounds` and not adjusted.
3. rotate a credential with an overlap, use old and new secrets in the window, then see the old refused after it, then revoke, expire (advance the clock) and block the workspace and verify 401 on the next request and an in-flight create committed whole or absent.

#### API-003 — Atomic support-request creation

*Tier:* Core · *From:* API-002

**Requirement.** A source product creates an attributed support request with verified or explicitly asserted requester identity, complete attachments and a navigable source reference. Atomicity, deduplication and conflict outcomes follow the [support-request API specification](docs/support-request-api-spec.md).

**Acceptance.**
1. create a ticket with a valid key, then replay the same key and body for the same status and body marked as a replay and exactly one ticket, send the same key with a changed body for 409 `idempotency_conflict`, fire two concurrent creates with one key for one ticket and one `in_progress`, and omit the key for 400.
2. create with email, with phone and with an external ID, once for an existing verified contact (history not exposed, no merge), once for a new contact (marked asserted and unverified) and once with two identifiers on different contacts (409 `identity_conflict`, neither disclosed), and one for an erased contact (`identity_erased`, no identity recreated).
3. verify the operator sees subject, body, attachments, API channel label, priority, tags, requester, the credential as machine actor and a working source back-link, that a spoofed source product is refused, that a second create with the same source reference returns 409 `source_ref_exists` with the existing ID, and that an unknown tag, an assignment attempt and an internal field are each refused.
4. attach a bounded upload, a digest-matching HTTPS URL, a mismatching digest, a redirecting URL, a private-address URL and an oversize file and verify the atomic result (one stored ticket with bytes intact, or none) and 413/415 with no truncation.

#### API-004 — Append to source-product support requests

*Tier:* Core · *From:* API-002

**Requirement.** A source product appends requester messages or internal notes within its credential bounds. Solved, closed and merged conversations retain their distinct lifecycle outcomes under STATUS-001 and the [support-request API specification](docs/support-request-api-spec.md).

**Acceptance.**
1. append a customer message and an internal note to the created ticket, to a Solved one (reopens), a Closed one (new linked follow-up) and a merged one (`merged_into`), and refuse an append by a create-only credential, to another credential's conversation and across workspaces with 404.

#### API-005 — API intake, consent and capacity

*Tier:* Core · *From:* API-002

**Requirement.** API intake uses the same suspended-mail, consent, channel and notification workflows as other support requests. Requests exceeding declared bounds have explicit outcomes without partial tickets. The [support-request API specification](docs/support-request-api-spec.md) retains every intake, consent and limit rule.

**Acceptance.**
1. deliver a blocked sender, a requester over the per-requester cap and a message failing abuse checks and verify 202 `held_for_review` in Suspended with a reason and no ticket-created event, AI request or outbound mail, then release one from Suspended.
2. send an acknowledgment request with and without a consent record, an opted-in and an opted-out SMS/WhatsApp requester and verify consent, template and opt-out rules and a created ticket either way with no duplicate send on retry.
3. exceed the per-minute limit, the create quota and the per-requester cap and verify 429, `Retry-After`, the rate-limit headers and the limit-naming code each time, with no partial ticket.

#### API-006 — Source-product support events

*Tier:* Core · *From:* API-002

**Requirement.** A source product receives signed support events filtered to its tickets or source-product binding. Event contents and replay behavior follow the [support-request API specification](docs/support-request-api-spec.md).

**Acceptance.**
1. receive signed `conversation.created`, `message.created`, `conversation.status_changed` and `conversation.assigned` at a destination limited to one credential, verify the signature, no transcript text or contact data, duplicate/out-of-order handling and a 429 retry with the same ID, and that another credential's tickets send nothing.

#### API-007 — Accountable API support history

*Tier:* Core · *From:* API-002

**Requirement.** Support history and audit identify the source credential and product; erasure covers API replay and event storage as well as the conversation. The [support-request API specification](docs/support-request-api-spec.md) retains the exact history, redaction and erasure inventory.

**Acceptance.**
1. open the audit export and ticket history to find issue, rotate, binding change, first use, denial counts, revoke, every create and append with credential name, source product, reference and request ID and no secret, and erase the issuing member and a requester to verify redaction without losing the events.
2. erase a populated API-created contact and verify ticket content, stored replay bodies, pending event payloads and attachment bytes are removed, the tombstone and fences hold against a stale replay and a new create, and the owner-visible counts are complete.

#### API-008 — Portable API support custody

*Tier:* Core · *From:* API-002

**Requirement.** API-created tickets and credential metadata remain portable while restored credentials are inert and unusable. Runnable examples explain safe credential use. The [support-request API specification](docs/support-request-api-spec.md) retains the full restoration and documentation requirements.

**Acceptance.**
1. export and restore into a clean installation and verify tickets with channel label, source reference and machine-actor name, credentials present as metadata only (no hash or secret), every credential revoked and unusable, idempotency digests carried, erasure fences kept and nothing replayed.
2. run the `docs/api.md` examples against a dev server and confirm they pass and expose no secret in arguments or logs..

#### MOVE-IN-002 — Switch from every named incumbent

*Tier:* Core

**Requirement.** Provide guided one-click connection or export upload for Zendesk, Intercom, Help Scout and Freshdesk, covering contacts/companies, conversations/messages/attachments/private notes, tags/custom fields, ownership, timestamps and articles/categories/publication. Preview supported mappings and every unsupported field/rule/brand/permission; no silent truncation. Resume with source IDs, deduplicate a second run, perform an inert final delta cutover and explicitly repoint channels. Preserve links and counts; imports never activate automations or expose formerly private knowledge. Imported tickets keep their email threading keys so post-cutover replies land in them (MOVE-IN-003), and configuration moves in under MOVE-IN-004.

**Acceptance.**
1. For each of the four vendors, use its documented export/API through Move in with representative realistic records, compare exact source/target counts and attachment bytes, inspect omission reports, resume/repeat/undo and final delta, then receive a new live message after channel cutover.
2. Exercise role revocation and source redaction without accidental sends.
3. Reply to a pre-cutover notification (MOVE-IN-003) and import configuration (MOVE-IN-004).

#### MOVE-IN-003 — Replies to pre-migration mail land in the imported ticket

*Tier:* Core

**Requirement.** Imported tickets keep their email threading keys: every source Message-ID and In-Reply-To/References chain, the source ticket number and each vendor's reply token (Zendesk encoded IDs in `[XXXX-XXXX]` brackets and ticket-number subject tags, Help Scout conversation numbers and reply addresses, Freshdesk `[#ticket]` subjects and reply-to addresses, Intercom conversation reply addresses). After channel cutover, a customer reply to a notification the old system sent is matched by those keys in that priority and lands in the imported conversation with its migrated requester, owner, group and status, reopening it under STATUS-001 when Solved and creating a linked follow-up when Closed. A key that matches more than one record, or a record belonging to a different customer identity, goes to review instead of the wrong ticket; an unmatched reply creates a new ticket marked as a possible pre-migration reply. Keys are imported inertly and are covered by repeat/undo equality and erasure.

**Acceptance.**
1. Import Zendesk, Help Scout, Freshdesk and Intercom datasets that carry real notification headers, perform cutover, then reply to a pre-cutover notification from each vendor by headers only, by subject token only and by reply address; verify each reply lands in the right imported conversation with its owner and status, reopens a Solved one and links a follow-up to a Closed one.
2. Send a reply whose token belongs to another customer (held for review) and an unmatched reply (new ticket with the hint); undo the import and verify the keys no longer match.

#### MOVE-IN-004 — Bring configuration, not only history

*Tier:* Core

**Requirement.** Move in maps each incumbent's configuration into native equivalents: macros with their actions and placeholders (MACRO-001), views, groups and memberships, business-hour schedules and holidays, SLA policies, request forms and custom fields (FORMS-001), triggers and automations, brands and help-center structure. A per-item preview shows what translates exactly, what translates with a stated change and what is unsupported, with the reason. Translated rules arrive inactive as drafts; an admin reviews, simulates them in the AUTOMATION-001 sandbox and activates them, and nothing sends, routes or breaches during import. Placeholders translate to native placeholders or are flagged.

**Acceptance.**
1. Import a Zendesk configuration with a macro that uses placeholders and four actions, a view, two groups, a schedule with holidays, an SLA policy, two request forms and a trigger/automation pair, plus the Help Scout, Freshdesk and Intercom equivalents.
2. Inspect the per-item mapping, activate selected items after simulation and verify they behave as the source did on a test ticket; unsupported items are listed and inactive drafts cause no effect.

#### PORTAL-001 — Authenticated customer self-service

*Tier:* Core

**Requirement.** A customer securely signs in to a branded portal to search permitted knowledge, create tickets with attachments through FORMS-001 request forms (which anonymous visitors may also submit where the lead allows), review/reply/reopen their own requests and manage notification preferences. Company-wide ticket visibility is an explicit entitlement, never inferred from an email domain. Identity recovery, revoked membership and inaccessible/deleted requests fail safely across web and mobile.

**Acceptance.**
1. As two customer identities in different companies, sign in, create/reply/reopen a ticket and inspect its history; grant then revoke company visibility, recover identity and verify all unauthorized deep links and attachments are denied.
2. Submit an anonymous request form and a signed-in one (FORMS-001).

#### FORMS-001 — Customer request forms with custom fields

*Tier:* Core

**Requirement.** Leads build several request forms (for example Order problem, Refund, Technical) from typed custom ticket fields (text, number, decimal, date, drop-down, multi-select, checkbox, pattern-validated text and lookups to an order or account), with required and conditional fields, customer-facing labels, descriptions and locale translations, and offer them in the help center, portal, widget and API. Anonymous visitors may submit where the lead allows, with email verification, rate limits and bot protection; signed-in customers' identity and organization are prefilled. Submissions are validated on the server and refused with the failing field named; accepted values are stored as typed ticket fields with the chosen form and are usable by QUEUE-001 routing, SLA-001 policies, AUTOMATION-001/002 conditions, views and reports. Agents see and edit the same fields under field-level permissions; forms and fields are versioned so old tickets keep their values.

**Acceptance.**
1. Submit the Order-problem form anonymously (with email verification) and the Technical form signed in, each with a required field and a conditional field shown only for a chosen value; confirm both tickets arrive with typed values that a routing rule and an SLA policy act on.
2. Submit invalid input (a missing required value, a pattern failure and a hidden conditional value injected through the API) and verify server refusal naming the field.
3. Translate a form and submit it in Spanish; deny an agent role a restricted field.

#### KNOWLEDGE-002 — Governed private and multilingual knowledge

*Tier:* Core · *Cites:* BASE-ROLE-001, BASE-AGENT-007

**Requirement.** Support public and authenticated private help centers, multiple languages/locales, version history, editorial review, redirects and brand/domain publishing. Source refreshes and translated drafts preserve permissions and previous published versions; restricted knowledge is never exposed to public search, an unauthorized agent answer or another account. Cited agent changes carry standard while internal and reversible; publication carries external and any commitment its content makes, decided by the company’s policy. Named editors retain their own publication authority.

**Acceptance.**
1. Publish an English article and reviewed translation, restrict a collection by explicit account/company entitlement (email-domain membership alone does not establish that entitlement), update/rollback a version and follow an old URL.
2. Search and ask the agent as public, permitted and forbidden customers and verify permission-aware citations, locale fallback disclosure and failed-refresh preservation.

#### KNOWLEDGE-003 — Branded help center, article feedback and knowledge in the ticket

*Tier:* Core

**Requirement.** Leads brand each help center with logo, colors, fonts, custom domain, navigation and editable page templates (home, category, section, article, search and request form), previewed before publication with readable contrast enforced. Each article offers "Was this helpful?" votes with an optional comment. Leads see per-article views and votes, search terms with and without results, click-through and tickets created after reading, by brand and locale. From a ticket an operator searches the help center, previews an article and inserts its link or text into the reply in one action, limited to knowledge that customer may see, and can flag an article as outdated or propose a new one (PUSH-004).

**Acceptance.**
1. Brand two help centers with logo, colors and domain and edit an article template; preview, publish and verify an unreadable color is refused.
2. Vote on an article as a visitor, search for a term with no results and then open a ticket; compare analytics with the known events.
3. From a ticket search, insert an article link and send; verify a restricted article cannot be inserted into a reply to a customer without access.

#### BRANDS-001 — Multi-brand support operations

*Tier:* Core

**Requirement.** A business can manage distinct brands, mailboxes, widget identities, domains, help centers, signatures, channels and policies with deliberate shared teams and reporting. Route and report by brand without mixing customer identities, private knowledge or sender credentials. Cross-brand administration and customer handoffs require explicit access and a visible explanation.

**Acceptance.**
1. Configure two brands with different domains/senders and a shared permitted team; receive and resolve messages from each, change one policy, inspect per-brand and aggregate reports and deny an unauthorized cross-brand customer/agent read.

#### ACCESS-001 — Enterprise identity and custom permissions

*Tier:* Core · *Cites:* BASE-SIGNIN-001, BASE-ROLE-001 · *Register:* R-5

**Requirement.** Retain native owner/password access while optionally connecting Google Workspace, Microsoft Entra ID or Okta using SAML/OIDC SSO and SCIM provisioning. Define custom roles and field/tool/brand/team permissions for operators, admins, reviewers and agents; separate integration installation, refund approval, knowledge publication and destructive access. Collaborator (light-agent) seats can view permitted tickets, add internal notes and follow tickets but cannot reply publicly, change fields or read restricted knowledge. Deprovisioning/revocation promptly ends sessions, pending tool authority and customer-data access, with tested owner recovery. Under RL-5, `knowledge.edit` gates internal knowledge management and connected-application article reads; `knowledge.publish` still gates publication. Published help keeps its audience gates, so a reader never gains internal articles through it. A separate knowledge-read permission is required for read-only access to selected internal knowledge without edit or publish authority.

**Acceptance.**
1. Provision an operator through each supported identity protocol, assign a restricted custom role, attempt denied exports/refunds/publication, then deprovision during active work and verify sessions/tools lose access.
2. Native owner recovery remains usable and cannot be replaced by provider configuration.
3. A collaborator seat adds a note and is refused a public reply.
4. Exercise the interim `knowledge.edit` gate on internal management and connected-application article reads, and retain published-help audience denials.
5. For the separate knowledge-read permission, prove a custom role with read only reads selected internal knowledge, cannot edit or publish, loses access on the next request after revocation, and has audited access, refusals and revocation.

#### IDENTITY-003 — Two-factor authentication for native accounts

*Tier:* Core · *Cites:* BASE-SIGNIN-002

**Requirement.** Native password accounts enroll a second factor: a TOTP authenticator app or WebAuthn security keys and passkeys, with ten single-use recovery codes shown once. An owner can require two-factor sign-in for every teammate or by role; affected users must enroll at their next sign-in before reaching any data, and existing sessions without the factor end. A sign-in without the factor, with a wrong or replayed TOTP code (one use per time step) or with a used recovery code is refused, rate-limited and audited. Owner-assisted reset of a teammate's factor requires the owner's own recent factor, notifies the teammate and is audited; an owner who loses every factor recovers through the documented installation-level owner recovery through `rer`, never by email alone. Refund and billing approval (COMMERCE-001, BILLING-001), integration and credential installation, exports, erasure, role changes and the two-factor policy itself require a recent second-factor step-up. API access uses scoped tokens (CONNECTIONS-001), never a password alone. SSO users follow their identity provider's MFA (ACCESS-001). This adds to the retained native password identity (IDENTITY-002) and never replaces it.

**Acceptance.**
1. As owner require two-factor sign-in; sign in as an agent and be forced to enroll TOTP and receive recovery codes; sign out and verify refusal without the factor, with a wrong code, with a reused code and with a used recovery code; sign in with a passkey.
2. Reset the agent's factor as owner with a step-up and observe the notification and audit.
3. Approve a test refund and start an export with and without a recent step-up; recover a locked-out owner through `rer`; verify sessions without the factor ended when the policy was turned on.

#### MOBILE-001 — Support from a phone

*Tier:* Core · *Cites:* BASE-ACCESSIBILITY-001 · *Register:* R-1, R-6

**Requirement.** Provide responsive operator/customer web flows and native iOS/Android operator apps for shared queues, push notifications, assignment, notes, attachments, knowledge, approval and reply. Show offline state and protect cached customer data; drafts may persist safely, but reconnect must revalidate role/frontier and scheduled effects. Deep links return to the correct permitted workspace and push payloads omit sensitive content by default.

**Acceptance.**
1. At 1440 and 390 use realistic end-to-end web tickets; on iOS and Android receive a push, deep-link, assign/note/reply with attachment, go offline, lose authority and reconnect.
2. Verify no stale duplicate send, leaked push content or retained cache after sign-out/revocation.

#### OUTCOMES-002 — CSAT across support channels

*Tier:* Core

**Requirement.** Offer configurable post-resolution satisfaction surveys via widget, portal, email and permitted messaging channels with rating scale, optional comment, locale, send timing and opt-out. Associate one latest response with the exact resolution cycle and channel; preserve previous-cycle history and reconcile signed response links without requiring a widget session. Leads inspect low-score follow-up and customer recovery without auto-closing complaints.

**Acceptance.**
1. Resolve tickets across the channels, receive/answer a survey as the eligible customer, rerate, reopen and revoke/expire a response link; compare cycle-level CSAT and opt-out behavior, ensure no duplicate invitation and verify erased comments disappear everywhere.

#### REPORTS-002 — Workload, service and agent outcomes

*Tier:* Core

**Requirement.** Leads explore team/agent workload, backlog age, incoming volume, response/resolution time, SLA compliance, reopened requests, CSAT and AI containment/handoff/resolution by channel, brand, account, tag and procedure version. Publish inspectable numerators, denominators, timezone and exclusion rules; distinguish bot closure from verified resolution and include failures/unknowns. Operators record time spent per ticket (a timer while the ticket is open, with manual adjustment) and leads report handle time by agent, form and intent. Export complete formula-safe records and schedule permission-scoped reports; no sampling or silent truncation.

**Acceptance.**
1. Build a known multichannel cohort containing reassignment, reopen, AI handoff, SLA breach and imported history through public routes.
2. Compare dashboard drill-downs, workload and scheduled CSV delivery to hand-calculated totals; revoke a recipient and verify private data is withheld.
3. Record and adjust handle time on tickets and compare handle-time totals.

#### AGENT-001 — A production support agent with clean handoff

*Tier:* Core · *Cites:* BASE-AGENT-002, BASE-AGENT-007 · *Register:* R-8

**Requirement.** The AI agent answers using approved help-center content, permitted past conversations and fresh connected customer/product state, with citations, retrieval permissions and clear AI disclosure across chat/email/voice. Execute only enabled procedures/tools; distinguish advice, prepared action, execution decided under the company’s policy for the call’s computed classes and observed success. A customer can request a person; uncertain, low-evidence or disallowed actions transfer promptly with transcript, sources, attempted actions, failures and the next responsible human. The agent stops replying after handoff until explicitly resumed.

**Acceptance.**
1. On representative channel journeys with provider sandboxes or official-schema fakes, ask grounded and unanswerable questions, attempt restricted retrieval/actions, request a human mid-tool-call and disconnect.
2. Verify cited valid answers, no private leakage, no unauthorized tool call, durable handoff context and no competing post-handoff AI answer; record live evaluation separately from fixtures.

#### PROCEDURE-001 — Natural-language procedures and release simulation

*Tier:* Core · *Cites:* BASE-AGENT-007 · *Register:* R-8

**Requirement.** Support leads author versioned natural-language operating procedures tied to intents, knowledge versions, live data requirements, tools, company-policy class decisions, budgets and human escalation. Simulate paths, adversarial cases, provider errors, handoffs and permissions against redacted historical examples in an isolated workflow sandbox with no real actions. Per-procedure evaluations must pass declared outcomes before an authorized staged release; compare versions, stop/rollback a rollout and keep old cases reproducible. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. Through procedure settings, draft a refund procedure, simulate allowed/denied/timeout/prompt-injection paths with network-edge fakes, inspect a failing case and prevent release.
2. Approve a passing version into a bounded live cohort, revoke a tool and roll back; verify no sandbox external effect and exact version linkage in conversations.

#### AGENT-002 — Inspectable quality and resolution economics

*Tier:* Core · *Cites:* BASE-AGENT-009 · *Register:* R-8

**Requirement.** Operators inspect a redacted per-conversation/tool-call trace with source/version, requested scope, the company-policy decision and any resulting human approval, timings, provider outcome and verified result. Leads explore procedure-level evaluation coverage, resolution/reopen/handoff rates, failure clusters and provider costs/usage without treating attempted actions as success. Human labels and later customer outcomes can correct attribution; provider usage remains accounting evidence, not a customer balance or invented monetary saving.

**Acceptance.**
1. Open production-run traces from a conversation and drill from a procedure report to supporting cases; include timeout, denied tool, handoff, negative CSAT and reopened outcomes.
2. Compare rates and USD provider-cost estimates to raw usage and known denominators, redact secrets and show unavailable price data explicitly.

#### FEEDBACK-001 — Source-linked feedback and release follow-up

*Tier:* Core

**Requirement.** Capture product feedback from a support conversation with the customer/account and supporting quote, link or create its request in Penny, and link engineering delivery in Vector or the buyer's issue tracker. Subscribe the affected requester to an approved service update when a linked feature/fix ships, respecting preference, channel policy and unresolved recovery. Penny owns aggregation, prioritization, roadmap/changelog and requester closure; HappyToHelp retains the support history and responsibility for the customer response. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. From two related customer tickets, hand off source-linked feedback to Penny, associate an engineering issue and receive a release event; preview and approve requester updates, deduplicate events, honor opt-out and keep a still-failing customer request open.

#### ERASURE-001 — Customer erasure with coherent history

*Tier:* Core · *Cites:* BASE-DATA-003, BASE-DATA-006

**Requirement.** Owner/admin contact erasure removes personal content from native/imported transcripts, notes, context, feedback, stored files and archive copies while retaining nonpersonal identity/frontier and an opaque erasure tombstone. Erasure fences APIs, pending events, source re-import and stale restore from resurrecting the identity. Provide completion/failed counts for all stores and separately request deletion from connected providers under their capabilities; do not claim already sent messages or offline archive bytes were recalled.

**Acceptance.**
1. Erase a populated native/imported contact through the authorized owner route, inspect D1/R2 and the resulting export, retry a stale API/import and test role/cross-tenant denial.
2. Verify coherent redacted threads, tombstone fencing and explicit unresolved external/old-archive deletion.

#### AUDIT-001 — Security and accountable actions

*Tier:* Core · *Cites:* BASE-SECRET-001, BASE-ROLE-001, BASE-AUDIT-001, BASE-DATA-006

**Requirement.** Support audit joins assignment, ticket-field, procedure, approval and external-action history to the responsible support record. Retention and legal-hold controls show their effect on support evidence and report denominators; evidence is never deleted to improve a report.

**Acceptance.**
1. Using owner/security views, rotate/revoke credentials, attempt cross-tenant/CSRF/SSRF access, approve an action, export audit and erase its actor; inspect durable outcomes with no secrets.
2. Apply retention/hold settings and verify protected records and report denominators survive restart and cleanup.

#### PORTABILITY-001 — Complete customer-owned portable support data

*Tier:* Core · *Cites:* BASE-DATA-001, BASE-BACKUP-001

**Requirement.** The portable support inventory includes conversations, attachments, contacts and companies, knowledge versions, settings, rules, procedures, evaluations, outcomes and audit. D1, R2 and Durable Object support history have a lossless representation, including interrupted work, erasure fences and receiving-owner identity. [Operations](OPERATIONS.md) retains the separate Base-data equivalence boundary.

**Acceptance.**
1. Through rer export/import and owner data controls, populate each business store, export, destroy the disposable source and restore to a clean installation.
2. Compare every portable record and attachment byte, preserve erasure fences, refuse corrupt/oversized/nonempty targets and verify all restored work is inert until separately authorized.
3. Include Durable Object history and interrupted actions.

#### ASSURANCE-001 — Qualified regulated support deployments

*Tier:* Core · *Register:* R-7

**Requirement.** US-first support uses USD, US provider contracts, IANA calendars and channel/recording consent controls. A regulated buyer can qualify an isolated deployment with required DPA/BAA, approved subprocessors/model data handling, access controls, audit, retention, incident response and validated deletion/export; health-data support is gated on those agreements and technical acceptance. The work remains a product obligation, with a named partner/provider path, rather than a claim that self-hosting alone supplies compliance.

**Acceptance.**
1. Before enabling a regulated workspace, an authorized administrator records required executed agreements/provider settings and runs tenant isolation, permission, audit, retention, recovery and erasure journeys with representative sensitive data.
2. Missing agreements/controls block that configuration visibly; verify access only after qualification and withdrawal upon expiry/revocation.

### Agent surface

**Specialist: support agent.** It triages customer requests, resolves them with grounded context and permitted business actions, and keeps recovery promises through handoffs.

Inherits BASE-AGENT-001 to BASE-AGENT-013. The company’s policy decides every call.

**How HappyToHelp computes each class.**

- **standard.** An internal ticket, draft, view, label, knowledge draft or reversible support update carries its item count.
- **external.** A reply, forward, published article, proactive offer, issue handoff or any change making support content newly visible outside the business carries recipient count. Existing verified customers, vendors or trusted company domains are known, other counterparties are new, and open publications are public; moving or restoring into an externally visible location also counts.
- **money.** A Shopify refund or cancellation affecting charges, Stripe refund, credit or paid subscription change carries the provider-read amount, USD currency and counterparty; provider-spend settings carry their cost consequences.
- **commitment.** A binding refund offer, customer promise, approved support outcome or relied-on release sign-off carries its promised value and counterparty; an internal nonbinding draft stays standard.
- **accounts.** Buying a voice number or creating an outside channel account or paid provider resource carries its provider and resource type; connecting an already-existing account alone is not account creation.
- **gated.** A provider-hosted OAuth consent, hosted card entry, identity or business verification, personal acceptance of provider terms, or an explicit provider answer requiring a person carries that provider and step; the provider may supply an agent route instead.
- **access.** Changes to support staff, roles, brand/team/knowledge entitlements, devices or connector/agent grants carry affected people and whether authority widens or narrows.
- **security.** Changes to native MFA, credential custody, provider secrets, ingress protections or a security policy carry the setting changed; rotating an integration credential also uses its access consequences.
- **destructive.** Permanent erasure, purging retained mail or an irreversible history operation carries the number of affected support records; a reversible merge or draft deletion stays standard.
- **sensitive.** Reads, exports, replies or actions touching health, identity, bank, card or payroll data carry the server-known regulated kind and record count, including such data in attachments.
- **live.** Changing an active routing rule, SLA, time automation, published procedure, widget campaign or running connector configuration carries the affected service; an inactive draft remains standard.

| Tool | Does | Core clauses | Risk class | Today |
| --- | --- | --- | --- | --- |
| `happytohelp.membership.inspect` | Scoped authority | IDENTITY-001 | standard or sensitive | Unified action registration missing |
| `happytohelp.workspace.create` | A useful first workspace | FIRST-RUN-001 | standard (+ external) | Unified action registration missing |
| `happytohelp.messages.write` | Durable transcript | CONVERSATION-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.messages.reconcile` | Live delivery and recovery | DELIVERY-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.outcomes.record` | Resolution feedback and provenance | OUTCOMES-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.reports.read` | Workspace calendar reports | REPORTS-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.connections.manage` | Workspace integrations | CONNECTIONS-001 | access · security (+ gated) | Unified action registration missing |
| `happytohelp.setup.observe` | Observed owner setup | ACTIVATION-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.answers.run` | Configured model execution | AI-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.knowledge.manage` | Published knowledge | KNOWLEDGE-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.context.read` | Attributed customer context | CONTEXT-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.repair.run` | Explicit local authority | DELEGATION-001 | standard or live (+ external) | Unified action registration missing |
| `happytohelp.evaluations.run` | Durable evaluation | TRAINING-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.connectors.manage` | Honest external effects | INTEGRATION-001 | access · security (+ gated) | Unified action registration missing |
| `happytohelp.inbox.work` | The shared support desk | DESK-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.campaigns.manage` | Availability-aware messenger and proactive messages | WIDGET-001 | standard or external (+ live) | Unified action registration missing |
| `happytohelp.mail.connect` | Complete support email | MAIL-001 | access · security (+ gated) | Unified action registration missing |
| `happytohelp.suspended.manage` | Reviewable suspended and spam mail | MAIL-002 | standard or destructive (+ sensitive) | Unified action registration missing |
| `happytohelp.tickets.create` | Agent-created and proactive tickets | OUTBOUND-001 | standard or external (+ commitment) | Unified action registration missing |
| `happytohelp.channels.manage` | Messaging and social support | CHANNELS-001 | access · security (+ accounts) (+ gated) (+ external) (+ live) | Unified action registration missing |
| `happytohelp.sharedchannels.work` | B2B shared-channel support | CHANNELS-002 | standard or external (+ access) (+ gated) | Unified action registration missing |
| `happytohelp.voice.work` | Telephone service and unified voice agent | VOICE-001 | external (+ accounts) (+ gated) (+ sensitive) | Unified action registration missing |
| `happytohelp.routing.manage` | Assignment rules and available teams | QUEUE-001 | standard or live (+ access) | Unified action registration missing |
| `happytohelp.triage.classify` | Intelligent triage | TRIAGE-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.tickets.bulk` | Structured and bulk queue work | QUEUE-002 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.collaboration.update` | Collaboration without conflicting replies | QUEUE-003 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.macros.apply` | Action macros with placeholders | MACRO-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.followups.manage` | Snooze and scheduled follow-up | QUEUE-004 | standard or external (+ commitment) | Unified action registration missing |
| `happytohelp.status.update` | Ticket status lifecycle | STATUS-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.sla.manage` | Business-hour service commitments | SLA-001 | standard or live | Unified action registration missing |
| `happytohelp.workflows.manage` | Explainable durable support workflows | AUTOMATION-001 | standard or live (+ external) | Unified action registration missing |
| `happytohelp.automations.manage` | Time-based automations | AUTOMATION-002 | standard or live (+ external) | Unified action registration missing |
| `happytohelp.notifications.send` | Customer acknowledgments and teammate notifications | NOTIFY-001 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.threads.mergeforward` | Merge and external forwarding | CONVERSATION-002 | standard or external (+ destructive) (+ sensitive) | Unified action registration missing |
| `happytohelp.problems.manage` | Problem and incident linking | CONVERSATION-003 | standard or external (+ commitment) | Unified action registration missing |
| `happytohelp.customers.manage` | Customer and company support records | CUSTOMER-001 | standard (+ access) (+ sensitive) | Unified action registration missing |
| `happytohelp.shopify.resolve` | Shopify order actions | COMMERCE-001 | standard or money (+ external) (+ commitment) (+ gated) (+ sensitive) | Unified action registration missing |
| `happytohelp.stripe.resolve` | Stripe billing and subscription resolution | BILLING-001 | standard or money (+ external) (+ commitment) (+ gated) (+ sensitive) | Unified action registration missing |
| `happytohelp.crm.context` | Live CRM and account context | CRM-001 | standard or external (+ access) (+ gated) (+ sensitive) | Unified action registration missing |
| `happytohelp.escalations.manage` | Engineering and team escalations that return | ESCALATION-001 | standard or external (+ commitment) | Unified action registration missing |
| `happytohelp.integrations.manage` | Owned API and managed connectors | API-001 | standard or external (+ access) (+ security) (+ gated) | Unified action registration missing |
| `happytohelp.credentials.manage` | Source-product credentials and bindings | API-002 | access · security | Unified action registration missing |
| `happytohelp.requests.create` | Atomic support-request creation | API-003 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.requests.append` | Append to source-product support requests | API-004 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.intake.review` | API intake, consent and capacity | API-005 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.events.read` | Source-product support events | API-006 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.requesthistory.manage` | Accountable API support history | API-007 | standard or destructive (+ sensitive) | Unified action registration missing |
| `happytohelp.requestarchives.export` | Portable API support custody | API-008 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.customerrequests.work` | Authenticated customer self-service | PORTAL-001 | standard or external (+ access) (+ sensitive) | Unified action registration missing |
| `happytohelp.forms.manage` | Customer request forms with custom fields | FORMS-001 | standard or external (+ live) (+ sensitive) | Unified action registration missing |
| `happytohelp.knowledge.publish` | Governed private and multilingual knowledge | KNOWLEDGE-002 | standard or external (+ commitment) (+ access) (+ sensitive) | Unified action registration missing |
| `happytohelp.helpcenter.manage` | Branded help center, article feedback and knowledge in the ticket | KNOWLEDGE-003 | standard or external (+ live) (+ sensitive) | Unified action registration missing |
| `happytohelp.brands.manage` | Multi-brand support operations | BRANDS-001 | standard or live (+ access) (+ security) | Unified action registration missing |
| `happytohelp.roles.manage` | Enterprise identity and custom permissions | ACCESS-001 | access (+ security) (+ gated) | Unified action registration missing |
| `happytohelp.surveys.manage` | CSAT across support channels | OUTCOMES-002 | standard or external (+ sensitive) | Unified action registration missing |
| `happytohelp.teamreports.read` | Workload, service and agent outcomes | REPORTS-002 | standard (+ external) (+ sensitive) | Unified action registration missing |
| `happytohelp.support.resolve` | A production support agent with clean handoff | AGENT-001 | standard or external (+ money) (+ commitment) (+ sensitive) | Unified action registration missing |
| `happytohelp.procedures.manage` | Natural-language procedures and release simulation | PROCEDURE-001 | standard or live (+ commitment) (+ sensitive) | Unified action registration missing |
| `happytohelp.quality.inspect` | Inspectable quality and resolution economics | AGENT-002 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.feedback.handoff` | Source-linked feedback and release follow-up | FEEDBACK-001 | standard or external (+ commitment) | Unified action registration missing |
| `happytohelp.customers.erase` | Customer erasure with coherent history | ERASURE-001 | destructive (+ sensitive) | Unified action registration missing |
| `happytohelp.audit.inspect` | Security and accountable actions | AUDIT-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.archives.export` | Complete customer-owned portable support data | PORTABILITY-001 | standard (+ sensitive) | Unified action registration missing |
| `happytohelp.assurance.qualify` | Qualified regulated support deployments | ASSURANCE-001 | standard (+ commitment) (+ sensitive) | Unified action registration missing |
| `happytohelp.recovery.run` | Reproduce, repair and prove customer recovery | PUSH-001 | standard or live (+ external) (+ money) (+ commitment) (+ sensitive) | Unified action registration missing |
| `happytohelp.promises.manage` | Promises survive every handoff | PUSH-002 | standard or commitment (+ external) | Unified action registration missing |
| `happytohelp.improvement.release` | Learn from reopenings under human control | PUSH-003 | standard or live (+ access) (+ money) (+ commitment) | Unified action registration missing |
| `happytohelp.knowledge.learn` | Turn verified edge cases into reviewed knowledge | PUSH-004 | standard or external (+ commitment) (+ sensitive) | Unified action registration missing |

**Resources.** Workspace, customer, company, ticket, message, attachment, article/version, procedure/version, evaluation, obligation and connector records use `happytohelp://{workspace}/{type}/{id}`; records retain their brand, requester and resolution-cycle relationships.

**Events.** `ticket.created`, `message.created`, `ticket.status_changed`, `ticket.assigned`, `resolution.rated`, `knowledge.published`, `procedure.released`, `obligation.due`, `recovery.observed`, plus inherited approval, review and policy events.

**Prompts.** Work the support queue (DESK-001, TRIAGE-001, QUEUE-001); resolve a customer request (AGENT-001, COMMERCE-001, BILLING-001); verify recovery and keep promises (PUSH-001, PUSH-002); prepare a knowledge correction (PUSH-004).

**Not tools, and why.** NATIVE-001: Installation fact and local command workflow. IDENTITY-002: A person’s password entry and interactive sign-in screen. LOCAL-MAIL-001: Trusted local development transport installation fact. UI-001: A person’s interactive dashboard and widget screens. MOVE-IN-001: Reviewed bulk history import door. PUBLIC-001: A person’s public homepage and marketing presentation. PUBLIC-002: Build-time documentation publication and a person’s help-center screen. MIGRATION-001: Legacy archive import door. SOURCE-001: Source-authoring and installation custody fact. MOVE-IN-002: Incumbent history import door and its connectors. MOVE-IN-003: Inbound-mail connector and imported threading keys. MOVE-IN-004: Configuration import door. IDENTITY-003: A person’s factor enrollment, challenge and recovery screens. MOBILE-001: Native device-only notifications, cache and offline work.

**Limits.** Capacity is the declared request, body, attachment and streamed-response bounds in [public limits](docs/PUBLIC-LIMITS.md) and the [API specification](docs/support-request-api-spec.md). Business thresholds and provider spend are the company’s policy.

**Handoffs.** Listen for Penny or Vector release events, issue-tracker status, CRM entitlement changes and Shopify/Stripe outcomes; emit customer-scoped escalation, feedback, promise-due and recovery events with source links. A closed issue remains distinct from observed customer recovery.

#### SURFACE-001 — Complete support job registry

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-002, BASE-AGENT-006, BASE-AGENT-013

**Requirement.** The specialist’s target registry equals the support jobs and non-tool reasons above, including the retained embedded support and repair features.

**Acceptance.**
1. Discover the specialist from only the installation URL and reconcile the registry’s Core clause inventory against every tool and non-tool reason in this table.
2. Run a seeded ticket action through its operator door and specialist tool and compare the resulting support record and event.

#### SURFACE-002 — Support records and handoff events

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-003, BASE-AGENT-010, BASE-AGENT-013

**Requirement.** The specialist follows tickets, their evidence and their recovery dependencies using the resource relationships, event types and prompts above.

**Acceptance.**
1. Read a ticket, its requester, attachment, current article version, procedure version and obligation through their resource links.
2. Follow a signed issue-release event to its linked support ticket without treating the release as customer recovery; follow a subsequent recovery observation separately.
3. Resolve the same ticket under two brand/team roles and retain the same visible evidence and customer boundaries as their operator views.

#### SURFACE-003 — Internal work and outside exposure

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** Support work computes standard and external from the actual destination and visibility of its result.

**Acceptance.**
1. A reversible internal draft or label carries standard with its ticket count.
2. A reply to a verified existing customer is external with known counterparty and its recipient count; a new partner forward is external/new, and publishing an open article is external/public.
3. Moving or restoring knowledge into an externally visible collection adds external even without a send.

#### SURFACE-004 — Refunds and binding promises

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** Business actions distinguish moving money from making a commitment.

**Acceptance.**
1. A Shopify partial refund and Stripe subscription charge change carry money with provider-derived USD amount and counterparty.
2. A binding customer promise or release sign-off carries commitment and its value and counterparty; a nonbinding internal draft stays standard.
3. A refund offer sent to a customer carries the applicable money, commitment and external classes together.

#### SURFACE-005 — Support authority and irreversible data

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** Support records determine authority, protective-setting, irreversible and regulated-data facts.

**Acceptance.**
1. Changing team, brand or knowledge entitlement carries access with affected people and widening or narrowing direction.
2. Rotating a support integration secret or changing native MFA settings carries security with the setting changed.
3. Erasing a customer or purging retained suspended mail carries destructive with record count; a reversible merge stays standard.
4. Reading or sending a support record containing health, identity, bank, card or payroll data carries sensitive with its server-known kind and record count.

#### SURFACE-006 — Provider steps and running services

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-006

**Requirement.** Provider and active-service state determine accounts, gated and live.

**Acceptance.**
1. Buying a voice number or creating an outside channel account carries accounts and its provider; connecting an existing resource alone does not.
2. Hosted consent, card entry or identity verification and a provider answer requiring a person carry gated with provider and step; exercise the provider’s agent route separately when offered.
3. Publishing an active routing rule, automation, campaign or procedure carries live and the affected service; an inactive draft stays standard.

#### SURFACE-007 — A seeded support week through MCP

*Tier:* Agent surface · *From:* new · *Cites:* BASE-AGENT-007, BASE-AGENT-013

**Requirement.** A stranger specialist works a seeded support week through the tools, using provider sandboxes or official-schema fakes and customer recovery evidence.

**Acceptance.**
1. Under the all-autonomous company policy, triage incoming email and widget tickets, read permitted knowledge, draft and send an answer, resolve a Shopify refund, hand off an issue and record a recovery promise through MCP; every decision follows that policy without a policy wait.
2. Repeat the same week under the held company policy: standard calls enter review and other used classes wait for the test person’s exact-revision approval; the resulting support outcomes equal the all-autonomous run.
3. Follow the shipped issue to a distinct customer-path observation; a still-failing path retains its owner and unresolved promise.
4. Compare ticket, refund, message, source-version, promise and recovery evidence with the seeded oracle under both policies.

## Push further

### Verified customer recovery

#### PUSH-001 — Reproduce, repair and prove customer recovery

*Tier:* Core · *Cites:* BASE-AGENT-007 · *Rules:* D-1 · *Register:* R-9

**Requirement.** Given the conversation, authorized live product state and an explicitly paired repair workspace, the agent reproduces the customer's failure, records its observation, prepares or performs only the permitted fix, and verifies with a distinct post-change read or user journey. Environment, operations, data, spending and time limits are granted by a named person; production changes and reply publication have separate authority. Reconcile started/uncertain work, gather customer-scoped recovery evidence, report in the original thread and reopen/escalate if recovery fails or the customer reports recurrence. A successful command or closed engineering issue never proves recovery. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. Start with a seeded support request and reproducible product failure; pair the connector, run read-only reproduction, approve a bounded fix, independently observe the affected customer path and approve/send the original-thread report.
2. Inject stale authority, uncertain change, failed verification, restart and later recurrence; verify no unapproved production effect/reply, truthful evidence and reopened ownership.

#### PUSH-002 — Promises survive every handoff

*Tier:* Core · *Cites:* BASE-AGENT-007 · *Rules:* D-1

**Requirement.** The agent extracts explicit commitments, quoted evidence and dependencies from messages and linked issues into durable obligations with a responsible person, due time, current evidence and stop condition. Chase missing evidence internally, detect stale dependencies and draft an honest customer update before a promise expires. Material promise or due-date changes carry commitment and customer messages carry external; the company’s policy decides the agent’s calls. No fabricated progress or invented commitment is allowed.

**Acceptance.**
1. In a conversation promise a follow-up, link an engineering dependency, hand off twice and restart.
2. Verify the same cited obligation, accepted owner/due-time changes, reminders and a timely draft; mark an evidence-free dependency stale and block any claim of completed progress until readback exists.

#### PUSH-003 — Learn from reopenings under human control

*Tier:* Core · *Cites:* BASE-AGENT-007

**Requirement.** The agent joins reopened requests, complaints, CSAT, procedure/tool versions and connected business outcomes to identify failed resolution paths. Propose a concrete procedure/policy change with cited cases, replay evaluation and expected effect; policy and Pause changes remain a person’s act; other permission changes carry access, spending changes carry money, and rollout changes carry live under the company’s policy. Track actual post-release recovery and regression, stop/rollback on deterioration and preserve original procedure versions and dissenting evidence. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. Create matched resolved/reopened cases under two procedure versions, inspect a proposed change and its replay set, reject then approve a limited rollout and inject regression.
2. Verify only approved versions/actions run, before/after outcomes are attributable and rollback preserves all failure evidence.

#### PUSH-004 — Turn verified edge cases into reviewed knowledge

*Tier:* Core · *Cites:* BASE-AGENT-007

**Requirement.** The agent identifies unanswered or repeatedly reopened topics from permitted conversations, support searches and procedure failures, clusters the gap and drafts a sourced article/update from verified resolutions. Strip personal data, obey private/brand/locale boundaries and include the evidence and proposed scope. Publication or translation that exposes knowledge outside the business carries external, and binding promises add commitment; the company’s policy decides the agent’s call. Named editors retain their publication authority, and the agent measures whether later customers recover and proposes corrections when they do not. Agent calls in this capability take the company’s policy for their computed classes; acceptance actions naming a person’s approval run under the held company policy.

**Acceptance.**
1. Resolve a previously undocumented case, trigger gap analysis, inspect a cited redacted draft, reject and then publish an edited version and ask the next customer's question.
2. Verify permission-aware retrieval, publication according to the company’s policy for external and any commitment class, attribution and a corrective proposal when the case reopens.

## Field proof register

| ID | Proof | Clauses | State | Date | Receipt |
| --- | --- | --- | --- | --- | --- |
| R-1 | A human screen-reader pass across operator, widget, portal and public documentation. | UI-001, PUBLIC-001, PUBLIC-002, MOBILE-001 | not run | | |
| R-2 | An independently issued VPAT for the installation. | UI-001, PUBLIC-002 | not run | | |
| R-3 | A hosted independently installed domain and actual remote resource provisioning/removal. | NATIVE-001 | not run | | |
| R-4 | Live email, Slack and webhook-provider receipts from an independently installed domain. | LOCAL-MAIL-001, CONNECTIONS-001, INTEGRATION-001, MAIL-001, OUTBOUND-001, NOTIFY-001 | not run | | |
| R-5 | Real Google Workspace, Entra ID and Okta tenant interoperability and certification. | ACCESS-001 | not run | | |
| R-6 | Native iOS and Android store approval and listings. | MOBILE-001 | not run | | |
| R-7 | Executed DPA or BAA, approved subprocessors and external regulated-deployment qualification. | ASSURANCE-001 | not run | | |
| R-8 | Real-model production answer/procedure quality and reconciled provider economics measured on representative channels. | AGENT-001, PROCEDURE-001, AGENT-002, TRAINING-001 | not run | | |
| R-9 | Authorized real customer repair and independent recovery observation over subsequent recurrence. | PUSH-001 | not run | | |
| R-10 | Live provider-account qualification for messaging, shared channels and voice, including emergency-test receipts. | CHANNELS-001, CHANNELS-002, VOICE-001 | not run | | |
| R-11 | Live Shopify, Stripe, Orbit, HubSpot, Salesforce, GitHub, Linear and Jira tenant results. | COMMERCE-001, BILLING-001, CRM-001, ESCALATION-001 | not run | | |
| R-12 | Claude, ChatGPT, Codex and Copilot client receipts for the specialist door. | API-001 | not run | | |

## Boundaries

- HappyToHelp never holds customer funds or becomes a payment processor; historical imported financial values remain custody records.
- Local processes run in the optional paired connector; the Worker has no implicit local-computer authority.
- The homepage makes no conversation-history, ticket-history, automation-import, reporting or compliance promise. Target obligations preserve their full scope without changing approved marketing.
- Wider pricing, legal, referral, waitlist and public automatic-widget routes remain outside this edition.
- Customer-consented messaging, independent provider receipts, regulated deployment and native store listings are claimed only to the proof their register rows record.
- The retained production cutover, guarded hh lander receipts and independent cleanup judgement remain separate from this rewrite.

## Homepage claims

| # | Claim | Clauses |
| --- | --- | --- |
| 1 | Knows what your customer needs before they do. | WIDGET-001, CONTEXT-001 |
| 2 | When someone seems stuck, the widget offers a hand. | WIDGET-001 |
| 3 | Your Codex or Claude fixes the problem and writes the reply. You press Send. | DELEGATION-001, PUSH-001 |
| 4 | 100% free, open source alternative to Zendesk, Intercom, Help Scout and Freshdesk. | NATIVE-001, SOURCE-001, PUBLIC-001 |
| 5 | MIT licensed; free as in code and free as in cost. | SOURCE-001, PUBLIC-001 |
| 6 | No seats. No plans. No fees. | PUBLIC-001, NATIVE-001 |
| 7 | Chat widget. | DESK-001, WIDGET-001 |
| 8 | Shared inbox. | DESK-001 |
| 9 | Help center. | KNOWLEDGE-001, KNOWLEDGE-003 |
| 10 | Suggested replies. | AI-001 |
| 11 | Install and try it beside what you have. | NATIVE-001 |
| 12 | Bring your help center from Zendesk, Intercom or Freshdesk. | KNOWLEDGE-001, MOVE-IN-002 |
| 13 | Add the chat widget to your site. | DESK-001, FIRST-RUN-001 |

## Status

Judged from the code and tests at commit `82de9ed83c8d4f0b75c378fdd3e234015dc5fd5b` (22 October 2026).

| Clauses | Done | Partial | Missing | Total |
| --- | ---: | ---: | ---: | ---: |
| Published | 20 | 3 | 0 | 23 |
| Target and push further | 18 | 24 | 24 | 66 |
| All | 38 | 27 | 24 | 89 |

| Clause | Title | Kind | Status | Evidence | Gap |
| --- | --- | --- | --- | --- | --- |
| `NATIVE-001` | Native owner installation | published | partial | `scripts/installer/local.mjs`; `scripts/installer/durable-objects.mjs`; `tests/helpers/installer/fresh-install.mjs`; `tests/helpers/installer/readme-restore.mjs` | BLOCKED on Base: clean dependency-free rer describe installs dependencies before describing (including published rer 0.2.79). The separately started owner-consented read-only preflight remains unimplemented; real remote provisioning is separately unqualified. The inherited candidate dry-run builds locally without provider requests or credentials; the two acceptance steps remain distinct. P1/P2 real-mailbox delivery is qualified only from the local emitted application with the HH-owned sender and held fleet mailbox, not a hosted independently installed domain. |
| `IDENTITY-002` | Retained native password identity | published | done | `src/modules/identity/routes.ts`; `tests/journeys/identity.mjs` |  |
| `IDENTITY-001` | Scoped authority | published | done | `src/modules/management/policy.ts`; `tests/journeys/identity.mjs`; `tests/journeys/runtime.mjs` |  |
| `FIRST-RUN-001` | A useful first workspace | published | done | `src/modules/management/provisioning/index.ts`; `tests/journeys/first-run.mjs` |  |
| `LOCAL-MAIL-001` | Rer dev mail | published | done | `src/modules/integrations/email.ts`; `tests/journeys/first-run.mjs` |  |
| `CONVERSATION-001` | Durable transcript | published | done | `src/modules/conversations/admission.ts`; `tests/journeys/runtime.mjs`; `tests/journeys/erasure.mjs` |  |
| `DELIVERY-001` | Live delivery and recovery | published | done | `src/modules/conversations/socket.ts`; `tests/journeys/widget.mjs`; `tests/journeys/first-run.mjs` |  |
| `UI-001` | Existing editable experience | published | done | `src/ui/dashboard`; `src/modules/widget`; `tests/journeys/inbox-browser.mjs`; `tests/helpers/inbox/settings-targets-browser.mjs` |  |
| `MOVE-IN-001` | Reviewed history import | published | done | `src/modules/move-in/plan.ts`; `tests/journeys/move-in-capacity.mjs`; `tests/journeys/move-in-browser.mjs`; `tests/journeys/move-in-admission.mjs`; `tests/journeys/move-in-custody.mjs`; `tests/journeys/move-in-erasure.mjs`; `tests/move-in/native-corrections.mjs` |  |
| `OUTCOMES-001` | Resolution feedback and provenance | published | done | `src/modules/outcomes/rating.ts`; `src/modules/outcomes/operator-feedback.ts`; `tests/reports/ratings.mjs`; `tests/reports/outcomes.mjs` |  |
| `REPORTS-001` | Workspace calendar reports | published | done | `src/modules/reports/routes.ts`; `src/modules/reports/metrics.ts`; `tests/reports/figures.mjs`; `tests/journeys/reports.mjs` |  |
| `CONNECTIONS-001` | Workspace integrations | published | done | `src/modules/api-integrations`; `tests/connections/api.mjs`; `tests/connections/delivery.mjs`; `tests/connections/slack.mjs` |  |
| `ACTIVATION-001` | Observed owner setup | published | done | `src/modules/management/activation`; `tests/journeys/first-run.mjs` |  |
| `AI-001` | Configured model execution | published | done | `src/modules/ai-support/service.ts`; `tests/journeys/first-run.mjs` |  |
| `KNOWLEDGE-001` | Published knowledge | published | done | `src/modules/knowledge/authoring.ts`; `src/modules/public-site/help-center.tsx`; `tests/journeys/knowledge.mjs`; `tests/journeys/public.mjs` |  |
| `CONTEXT-001` | Attributed customer context | published | done | `src/modules/customer-context`; `tests/journeys/context.mjs` |  |
| `DELEGATION-001` | Explicit local authority | published | done | `src/modules/local-computer/results.ts`; `src/edition/delegation/routes.ts`; `tests/journeys/delegation.mjs` |  |
| `TRAINING-001` | Durable evaluation | published | done | `src/modules/training-runs/runner.ts`; `src/edition/ai/training.ts`; `tests/journeys/ai.mjs` |  |
| `INTEGRATION-001` | Honest external effects | published | partial | `src/modules/integrations/inbound.ts`; `src/modules/integrations/github.ts`; `tests/journeys/email.mjs`; `tests/journeys/knowledge.mjs` | Implementation/acceptance gaps: The required business connectors remain missing under COMMERCE-001, BILLING-001 and CRM-001. Live qualification gap: Real mail receipt, GitHub account authorization/events and provider-backed knowledge import are unobserved; adapter fixtures do not establish live delivery or account qualification. |
| `PUBLIC-001` | Public product source | published | done | `src/ui/homepage`; `tests/homepage-browser.mjs`; `tests/journeys/public.mjs` |  |
| `PUBLIC-002` | Published documentation and help-center doors | published | done | `src/ui/homepage`; `tests/homepage-browser.mjs`; `tests/journeys/public.mjs` |  |
| `MIGRATION-001` | Prior-data custody | published | done | `src/modules/legacy-import`; `tests/journeys/erasure.mjs`; `tests/journeys/move-in-admission.mjs` |  |
| `SOURCE-001` | Author-owned capability graph | published | partial | `scripts/edition-authoring/cli.mjs` | `tests/helpers/installer/edition-authoring.mjs`, editionAuthoringJourney, runs inside the existing release-artifact test in `tests/journeys/installer.mjs` (Verify runtime-and-identity shard). It exercises CLI origin, local drift and executable-mode refusals, selected licensed release, excluded local credentials/private fixtures, clean-source refusal and receipt verification. Source integrity does not assert a product build or deployment; exact-SHA Verify remains required. |
| `DESK-001` | The shared support desk | target | done | `src/modules/management/dashboard.ts`; `src/modules/management/inbox-search.ts`; `src/modules/tickets`; `tests/journeys/first-run.mjs`; `tests/journeys/inbox.mjs`; `tests/journeys/reports.mjs`; `tests/journeys/delegation-browser.mjs` |  |
| `WIDGET-001` | Availability-aware messenger and proactive messages | target | partial | `tests/helpers/widget/presence.mjs`; `tests/helpers/widget/away.mjs`; `tests/helpers/widget/presence-browser.mjs`; `tests/helpers/widget/assistant-browser.mjs`; `tests/helpers/widget/campaigns.mjs`; `tests/helpers/widget/campaigns-browser.mjs`; `tests/journeys/widget.mjs`; `tests/journeys/widget-browser.mjs` | DONE re-claim awaits successful push Verify on the exact handed-over head and the post-Verify metadata judgement. The required assertions are named in Evidence; no live-model or hosted-domain obligation is added to this clause. |
| `MAIL-001` | Complete support email | target | partial | `src/modules/integrations/mailboxes/`; `src/modules/integrations/email-threading.ts`; `tests/helpers/email/mailbox-provider.mjs`; `tests/helpers/email/complete-email.mjs`; `tests/helpers/email/transports.mjs`; `docs/email.md`; `tests/journeys/email.mjs` | Protocol evidence: `tests/helpers/email/complete-email.mjs`, imapSmtpJourney, independently registered in `tests/journeys/email.mjs`, drives `src/modules/integrations/mailboxes/socket.ts` through connection verification, fragmented IMAP greetings/commands/UTF-8 literals, UIDVALIDITY, cursor sync/backfill, reconnect and SMTP authentication/DATA. Only the TLS socket boundary is replaced; application admission, encrypted credentials and durable send stores assert redelivery without duplicate tickets/effects, cursor retention and inert automatic-mail redelivery. This is protocol fixture proof, not a real TLS server or live mailbox qualification. Live qualification gap: Real forwarding, IMAP/SMTP, Gmail and Microsoft 365 test accounts, domain/sender authorization, delivery, bounce/permission failures and production cutover are unqualified; simulated OAuth/provider responses do not qualify a real account. |
| `MAIL-002` | Reviewable suspended and spam mail | target | done | `src/modules/integrations/suspended.ts`; `src/modules/integrations/suspended-store.ts`; `src/modules/integrations/suspended-recovery.ts`; `tests/helpers/email/complete-email.mjs`; `docs/email.md` |  |
| `OUTBOUND-001` | Agent-created and proactive tickets | target | partial | `src/modules/management/outbound-tickets.ts`; `src/modules/management/outbound-ticket-input.ts`; `src/modules/management/outbound-ticket-store.ts`; `tests/helpers/email/complete-email.mjs`; `tests/helpers/email/mailbox-provider.mjs`; `docs/email.md`; `tests/journeys/email.mjs` | Browser evidence: `tests/helpers/inbox/ui-browser.mjs`, outboundTicketBrowser, independently registered as “New ticket creates email and call tickets with recoverable previewed service notices at 1440 and 390” in `tests/journeys/inbox-browser.mjs`, drives email/private-call creation, immutable replay, consent changes after preview and lost-response recovery. Definitive no-creation refusals retain the editable draft and usable Cancel, close and Escape; uncertain outcomes retain the same command. Service-notice evidence: `tests/helpers/email/complete-email.mjs`, outboundNoticesJourney, exercises preview confirmation, provider/refusal outcomes, consent refusal retained across later opt-in, and fifty requesters under enforced 1000-statement/call invocation meters. Remaining admissions resume under the immutable command after concurrent retries and native re-login. Durable notice commands live in `outbound_notice_commands`, independently of audit retention, for the lifetime of the workspace (no time-based command expiry). The workspace dialog intent is unique across operators and freezes its original actor, fingerprint and refusal or reservation before any admission. Ticket creation and first-message/outbox admission update the same command’s recovery IDs in their existing atomic batches; provider I/O remains outside transactions. Replays return already admitted tickets even after requester blocking, and reserved work keeps its original ticket identity. The existing email journey proves complete, reserved and partial replay after supported 90-day audit retention at day 91, native re-login and workspace isolation. No accepted or reserved command can become a `notice_not_created` certificate when its audit expires. The admission budget includes two additional statements per new notice recipient (ticket and outbox recovery receipts), each folded into an existing batch with no added D1 call. Scheduled abandoned-send reconciliation deliberately uses one additional statement/call compared with the previous main; the 1000-statement and 1000-call platform caps remain enforced. Each admitted message uses the durable outbox; lost dispatch, scheduled recovery and individual jobs finish without duplicate sends. Notification send execution is bounded to 60 seconds, including provider I/O; the scheduled pass reconciles sending claims older than 120 seconds without an open managed hold to uncertain with “the worker stopped during a send; check the provider before resending”. A send whose invocation died between claim and receipt is never retried automatically. The default remains 10 first-notice attempts per workspace per fixed UTC minute, with no batch CC/BCC. Capacity-deferred rows have no send claim; rate and consent refusals are terminal and visibly distinct from provider rejection. Implementation/acceptance gaps: Remaining form/field/brand/assignment configuration and consented SMS/WhatsApp template creation remain incomplete. Live qualification gap: Sending from an authorized real mailbox/domain and receiving the customer's real-mailbox reply are unobserved; inspected fixture copies do not prove delivery or live threading. Real-mailbox reply/cutover receipts are absent. WhatsApp sandbox credentials and an opted-in/out test number are not provisioned. |
| `CHANNELS-001` | Messaging and social support | target | missing |  | No implementation located. No SMS/Meta support channel implementation located. |
| `CHANNELS-002` | B2B shared-channel support | target | missing |  | `src/modules/api-integrations/dispatch.ts`; `tests/connections/slack.mjs`; `src/modules/escalations/actions.ts`. Slack receives new-conversation notifications and outbound engineering handoff posts only, which this clause excludes; customer intake, bidirectional Slack Connect and Teams are absent. |
| `VOICE-001` | Telephone service and unified voice agent | target | missing |  | No implementation located. No voice routing/agent or Aircall connector implementation located. |
| `QUEUE-001` | Assignment rules and available teams | target | done | `src/modules/workflows/routing.ts`; `src/modules/workflows/routing-candidates.ts`; `src/ui/native/pages/workflows/RoutingSettings.jsx`; `tests/helpers/workflows/routing.mjs` |  |
| `TRIAGE-001` | Intelligent triage | target | done | `src/modules/triage/`; `src/modules/workflows/routing-triage.ts`; `tests/helpers/ai/triage.mjs`; `tests/helpers/ai/triage-browser.mjs`; `docs/triage.md` |  |
| `QUEUE-002` | Structured and bulk queue work | target | done | `src/modules/tickets`; `tests/journeys/inbox.mjs`; `tests/helpers/inbox/ticket-queue.mjs`; `tests/helpers/inbox/ticket-queue-capabilities.mjs`; `tests/helpers/inbox/tickets-browser.mjs` |  |
| `QUEUE-003` | Collaboration without conflicting replies | target | done | `src/modules/collaboration`; `src/modules/conversations/socket.ts`; `src/modules/tickets`; `src/ui/dashboard/components/collaboration`; `tests/journeys/inbox.mjs`; `tests/journeys/first-run.mjs` |  |
| `MACRO-001` | Action macros with placeholders | target | done | `src/modules/macros`; `src/ui/native/pages/macros`; `src/ui/dashboard/components/macros`; `tests/helpers/r4/macros.mjs`; `tests/journeys/inbox.mjs` |  |
| `QUEUE-004` | Snooze and scheduled follow-up | target | done | `src/modules/workflows/schedules.ts`; `src/modules/workflows/routes-schedules.ts`; `src/ui/dashboard/components/workflows/WorkflowPanel.jsx`; `tests/helpers/workflows/schedules.mjs` |  |
| `STATUS-001` | Ticket status lifecycle | target | done | `src/modules/tickets`; `src/modules/workflows/followups.ts`; `src/modules/workflows/rule-time.ts`; `tests/helpers/inbox/ticket-lifecycle.mjs`; `tests/helpers/inbox/ticket-api-privacy.mjs`; `tests/helpers/workflows/rules.mjs` |  |
| `SLA-001` | Business-hour service commitments | target | partial | `src/modules/workflows/calendars-time.ts`; `src/modules/workflows/sla.ts`; `src/modules/workflows/sla-alerts.ts`; `tests/helpers/workflows/sla.mjs`; `tests/journeys/inbox.mjs`; `tests/helpers/request-forms-journey.mjs`; `tests/journeys/knowledge.mjs`; `tests/helpers/workflows/sla-slack.mjs`; `tests/helpers/workflows/sla-slack-browser.mjs`; `tests/journeys/inbox-browser.mjs` | Implementation gaps: Teams escalation delivery remains unimplemented. Ct ruling HH-SLA-SLACK-001: APPROVE WITH RIDERS (27 October): only an owner or admin may explicitly select an enabled workspace Slack destination; alerts freeze that destination and send fixed ticket and named-operator identifiers with metric and kind, excluding customer content, names, addresses and private notes. Acknowledgment stays in HappyToHelp and stops pending sends; it does not send a Slack callback or update. Removed backups, disabled destinations, policy opt-out and resolved tickets stop unsent alerts. Installation uses the same owner or admin authority as Teams ESCALATION-001; current installing authority is rechecked before sending. Saving a connection never sends a test: the separate Send test action is explicit test-post consent. Missing or revoked policy consent, wrong workspace and revoked installing authority refuse outbound delivery. Only explicit Slack rate-limit refusals retry, at most five total attempts; unknown effects and interrupted claims never replay. SLA-001 stays partial pending Teams parity, live Slack receipt and exact-SHA evidence. Live qualification gap: Real mailbox receipt and live Slack and Teams escalation delivery and acknowledgment receipt remain unobserved; local network-edge receipts are protocol evidence only. No Slack sandbox credential or Teams tenant is supplied. NOTIFY-001 and CHANNELS-002 inherit no personal Slack or bidirectional-channel delivery claim from this slice. |
| `AUTOMATION-001` | Explainable durable support workflows | target | done | `tests/helpers/inbox/tickets-browser.mjs`; `tests/journeys/inbox-browser.mjs`; `tests/helpers/workflows/rules.mjs`; `tests/journeys/inbox.mjs`; `tests/helpers/r4/notifications.mjs`; `tests/journeys/email.mjs` |  |
| `AUTOMATION-002` | Time-based automations | target | done | `src/modules/workflows/rule-time.ts`; `src/modules/workflows/rule-engine.ts`; `src/jobs.ts`; `tests/journeys/inbox.mjs`; `tests/helpers/workflows/rules.mjs` |  |
| `NOTIFY-001` | Customer acknowledgments and teammate notifications | target | partial | `src/modules/integrations/triggers.ts`; `src/modules/integrations/triggers`; `src/modules/integrations/notification-teammates.ts`; `src/modules/integrations/operator-notifications.ts`; `tests/journeys/email.mjs`; `tests/journeys/inbox.mjs`; `src/modules/workflows/notify.ts`; `src/modules/integrations/notification-actions.ts`; `tests/helpers/r4/notifications.mjs`; `tests/helpers/request-forms-journey.mjs`; `tests/journeys/knowledge.mjs` | Implementation/acceptance gaps: Mobile push and personal Slack/Teams delivery are unimplemented; no Slack bot sandbox credential, push application or Teams test tenant is supplied. The clause stays partial. Live qualification gap: Real requester/CC/teammate mail receipt and live Slack/Teams or push-account delivery are unobserved; proven-address claims and fixture receipts are not live delivery evidence. |
| `CONVERSATION-002` | Merge and external forwarding | target | done | `src/modules/conversation-actions`; `src/ui/dashboard/components/conversation-actions`; `tests/helpers/r4/conversation-actions.mjs`; `tests/journeys/inbox.mjs` |  |
| `CONVERSATION-003` | Problem and incident linking | target | partial | `src/modules/tickets/problem-routes.ts`; `src/modules/tickets/problem-execute.ts`; `tests/helpers/inbox/problems.mjs`; `docs/tickets.md`; `tests/journeys/inbox.mjs`; `tests/journeys/identity.mjs`; `tests/helpers/identity/roles-audit.mjs`; `tests/journeys/inbox-browser.mjs`; `tests/helpers/inbox/tickets-browser.mjs`; `tests/helpers/inbox/problem-suggestions-browser.mjs` | Implementation and acceptance gaps: SMS consent and reply-window transport and its live Twilio receipt remain unavailable (TWILIO_AUTH_TOKEN is not provisioned). The clause stays partial for SMS and live delivery qualification. Live qualification gap: Real email receipt and SMS provider delivery and window enforcement for linked incidents are unobserved; email fixtures and local widget observations qualify only those local paths. |
| `CUSTOMER-001` | Customer and company support records | target | partial | `src/modules/customers`; `src/modules/import-kit/csv`; `src/ui/native/pages/Companies.jsx`; `tests/helpers/company-records.mjs`; `tests/helpers/customer-csv.mjs`; `tests/journeys/inbox.mjs`; `tests/helpers/context/identity-links-browser.mjs`; `tests/journeys/inbox-browser.mjs` | Implementation/acceptance gaps: Full cross-channel identity governance and live connector context remain incomplete. Stored company/domain membership is not proof of external account entitlement. Identity association has an operator screen on the customer page (`src/ui/native/pages/companies/CustomerIdentityLinks.jsx`, `docs/WORKSPACE-WORKFLOWS.md`) that implements the ct ruling below as staff context only, with link history in `migrations/252_customer_identity_link_history.sql`. Named Gap — ct ruling, 23 October 2026 12:11Z: interim default = a reviewed identity link gives the operator context only (a labelled “possibly the same customer” view inside the workspace, audited), never customer-side access, merge or send authority. Target (named Gap) = an operator-confirmed link may show the linked history to staff in the same workspace under ROLE scope, with reviewer, time and evidence kept and the link reversible; nothing is merged, no message is sent because of a link, and customers see only what their own verified session allows. Live qualification gap: Verified chat/email/social identity linkage and fresh/stale business-system context against real accounts are unobserved; synthetic contacts, domains and CSVs do not qualify them. Provider-backed chat/email/social linking and business-system context with live sync/disconnect receipts remain unqualified; no social-provider sandbox is held. |
| `COMMERCE-001` | Shopify order actions | target | missing |  | No implementation located. No Shopify order/refund connector implementation located. |
| `BILLING-001` | Stripe billing and subscription resolution | target | missing |  | No implementation located. No active Stripe billing/subscription action connector located; legacy financial imports confer no action authority. |
| `CRM-001` | Live CRM and account context | target | partial | `tests/journeys/connections.mjs`; `tests/helpers/hubspot-context.mjs` | Local emitted-interface fixture evidence: `tests/journeys/connections-browser.mjs`, Connections owner journey extended by `tests/helpers/hubspot/browser.mjs`: Settings connect/disconnect through native password step-up; exact-scope refusal with cleared token and retained account/property inputs; explicit customer/company mapping and remapping; shared customer and actual-ticket-requester context with changed entitlement, source IDs, owner IDs and check/refresh times; fresh, stale, loading, disconnected, identity-mismatch, revoked-provider and unavailable states; conflicting mapping refusal, native authority revocation while open, denied operator and foreign workspace; stale customer/ticket response isolation, unmap and reconnect clearing. Browser assertions run at 1440px, with changed screens captured at 1440 and 390px. Live HubSpot qualification, wider staff entitlement, ct approval of the conservative default, Orbit, Salesforce and approved CRM writes remain unproved. Conservative default ADOPTED pending ct approval: owner or admin only with native permissions, exact contact and company read scopes, explicit source mapping with email and company-domain plus association checks, no automatic matching or CRM-derived customer access; failed refreshes clear cached context and reconnect clears mappings. Imported and restored archives clear CRM credentials and cached personal context, mark mappings stale and require explicit reauthorization, including older archives. Authorized support operators still need relevant CRM context on their own work: it is not yet shown to them in their ticket and customer panels. Approved CRM writes remain contracted and unproved. CRM-001 remains partial. |
| `ESCALATION-001` | Engineering and team escalations that return | target | partial | `./src/modules/escalations`; `tests/journeys/connections.mjs`; `tests/journeys/connections-browser.mjs`; `tests/helpers/escalations/dev-proof.mjs` | Teams deterministic evidence: `tests/helpers/escalations/journeys.mjs`, sharingJourney and teamsSharing, through `tests/journeys/connections.mjs` — selected messages and attachments, private and unchosen exclusion, reciprocal ticket and Teams message links, concurrent and duplicate requests, revoked installing authority, explicit provider refusal, unknown delivery without replay, and a customer-visible update only after operator Send. teamsUpgrade proves existing provider references survive migration. `tests/helpers/escalations/browser.mjs`, exerciseEscalations, through `tests/journeys/connections-browser.mjs` proves channel selection, preview, confirmation, linked result, refusal and uncertainty at 1440 and 390. Its existing phone journey measures every visible Teams connection control, tracker anchor and handoff control, including Save Teams connection and Refresh status, and requires targets of at least 44 by 44 pixels. It also checks that refused, uncertain and revoked-provider outcomes are fully visible immediately after Share; the landing proof captures the same screens at 1440 and 390. Implementation gaps: A Teams escalation must also return authenticated status, owner notification, a reviewable customer update, and separately observed recovery; these return-path obligations remain unproved for Teams. Teams signed inbound status and fix-shipped draft automation remain absent; ordinary operator Send is required for Teams customer updates. ct batch 14 approved this outbound slice with riders; ESCALATION-001 stays partial. The built slice uses owner or admin installation of one fixed Teams channel, current installing authority rechecked before sending, selected public context only, plain text without mentions, and no automatic replay or customer publication. Remaining Slack SLA riders also apply: consent authority must align, five total attempts permit retries only after an explicit rate-limit refusal, and missing refusal cases still need proof. CHANNELS-002 and NOTIFY-001 inherit their own installed-channel and consent obligations; this outbound slice grants no inbound authority. Live qualification gap: Real GitHub, Linear, Jira, Slack and Teams account scopes, status callbacks and delivery remain unqualified; loopback protocol evidence does not qualify live accounts. |
| `API-001` | Owned API and managed connectors | target | partial | `src/modules/api-integrations`; `local-agent/lib/mcp.mjs`; `src/modules/move-in/plan.ts`; `tests/connections/api.mjs`; `tests/connections/delivery.mjs` | Implementation/acceptance gaps: Managed connector catalog, Zapier actions/triggers and continuous Help Scout API/webhook synchronization are absent. Live qualification gap: Real webhook receiver acceptance, Zapier account execution and Help Scout account scopes/cursors/reconnect are unobserved; native API and export fixtures do not qualify managed provider connectors. |
| `API-002` | Source-product credentials and bindings | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `API-003` | Atomic support-request creation | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `API-004` | Append to source-product support requests | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `API-005` | API intake, consent and capacity | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `API-006` | Source-product support events | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `API-007` | Accountable API support history | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `API-008` | Portable API support custody | target | missing |  | Native public-route evidence: `tests/connections/api-create.mjs` / “machine create credentials admit one atomic ticket and replay across rotation without granting other scopes” covers create/replay and identity fencing; customer/note attachment and status matrices; configurable requester holds and 429 headers; signed ordered events, retries and credential filtering; overlap, expiry, revocation, binding-change and deleted-workspace admission races; and owner-readable API erasure counts with pending-payload removal. `tests/journeys/connections-browser.mjs` / “at 1440px…” and “at 390px an owner creates and revokes a token…” exercise create-only, append-only, read-only and full machine credentials, one-time secrets, Settings metadata and a working operator source back-link. `tests/helpers/recovery/journey.mjs` / `verifyRestoredApi`, through `tests/journeys/restore.mjs` / “a populated packaged install restores…”, adds API metadata, revoked-token, digest and erasure-fence restore assertions; exact-candidate CI qualification is required. Additional deterministic evidence in the same API phase covers literal content-abuse holds across subject, body and source reference, no ticket/event/AI/outbox effect while held, reviewed release and native triage input; installation-admin workspace suspension with next-request 401 and atomic admission; and issuer erasure with retained machine history, redacted audit/export identity and revoked credentials without hashes. `tests/helpers/identity/roles-audit.mjs` / `rolesAuditJourney` qualifies both member-erasure route permissions. `tests/helpers/recovery/journey.mjs` / `eraseRecoveryIssuer` and `verifyRestoredApi`, through the populated restore journey, qualify issuer redaction and machine-event retention across export/restore. Owner transfer and installation review are required for owners and shared accounts respectively. Authority-model evidence: `tests/connections/api-create.mjs` / `apiInvariantSweeps` derives conversation-door coverage from the mounted router, crosses requester admission with every key spelling, checks one credential across rotation and policy changes, snapshots all foreign-workspace rows during erasure, and compares released tickets with direct creates. `tests/connections/migration.mjs` retains a populated legacy bearer grant across the credential backfill. The existing Settings browser journeys verify one credential card containing its rotated secrets at 1440 and 390. Repair scope: shared credential scope eligibility, isolate-cached schema-derived member-erasure scope with generated workspace deletes and reset/invite row separation; key-driven contact, sender-rule and digest-fence admission; indexed verified email/external/phone identity matching in create and release; reach-filtered credential replay/conflict references; operator-visible release collision IDs; and shared requester insertion. The existing scale sweep meters append, create and release doors with contacts, sender rules and both fence tables populated. API-002 remains missing pending exact-candidate verification and the independent gate. Remaining gaps: live AI content-abuse and complete triage/AI qualification, including “body text, subject and source fields can never instruct the agent or open an external effect.” Point 9 (consent-gated SMS/WhatsApp acknowledgment) is out of scope pending CHANNELS. No Handset or live delivery qualification. |
| `MOVE-IN-002` | Switch from every named incumbent | target | partial | `tests/journeys/upgrade.mjs`; `tests/reports/upgrade-attachments.mjs`; `tests/move-in/supplied-attachments.mjs`; `tests/move-in/door-mapping.mjs`; `tests/move-in/attachment-browser-flow.mjs`; `tests/journeys/move-in-admission.mjs`; `tests/move-in/door-readers.mjs`; `tests/move-in/helpscout-security.mjs`; `tests/journeys/move-in-capacity.mjs`; `tests/move-in/configuration-fields.mjs`; `tests/helpers/email/vendor-replies.mjs`; `tests/move-in/companies.mjs`; `tests/journeys/move-in-browser.mjs` | Implementation and acceptance and live qualification gaps: Attachment bytes for Zendesk, Intercom and Help Scout, metadata-only Freshdesk exports, larger or unsupported Freshdesk payloads, final delta and explicit channel repoint remain incomplete. Freshdesk byte admission requires explicit canonical base64 and digest, at most 48 KiB each and 20 per ticket, within existing record and upload bounds; private notes retain teammate-only access. No automatic URL retrieval or sends are introduced. Full custom fields and configuration and multiple-company fidelity remain incomplete: Zendesk maps the explicit default, Freshdesk the primary, Help Scout organizationId, and Intercom only a complete single-company relationship; omissions are explicit. Real vendor API and account ingestion and a new live message after cutover remain unobserved. Company and configuration browser qualification passed at 1440/390; export upload is already a supported alternative to API connection. |
| `MOVE-IN-003` | Replies to pre-migration mail land in the imported ticket | target | partial | `tests/helpers/email/vendor-replies.mjs`; `tests/journeys/email.mjs`; `tests/move-in/door-mapping.mjs` | Implementation/acceptance and live qualification gaps: Intercom has no invented subject-token scheme. Existing older imports without assignment snapshots remain unactivated. Live incumbent notification/export accounts and actual support-channel cutover are required for the outstanding real-mail qualification. |
| `MOVE-IN-004` | Bring configuration, not only history | target | partial | `tests/move-in/door-mapping.mjs`; `tests/move-in/configuration-fields.mjs`; `tests/journeys/move-in-browser.mjs` | Implementation/acceptance and live qualification gaps: The bounded Zendesk mapping does not establish full source equivalence: memberships/defaults, SLA policies, brands and full help-center structure remain incomplete, as do the other vendors’ configuration equivalents. Native automation journal/hour-boundary semantics are disclosed. Real vendor configuration/API sandbox equivalence remains unobserved. |
| `PORTAL-001` | Authenticated customer self-service | target | done | `src/modules/portal`; `src/modules/public-site/portal-pages.ts`; `src/modules/customers`; `tests/helpers/customer-portal-journey.mjs`; `tests/helpers/company-portal.mjs`; `tests/journeys/knowledge.mjs` |  |
| `FORMS-001` | Customer request forms with custom fields | target | partial | `src/modules/forms/settings.ts`; `src/modules/forms/definition.ts`; `src/modules/forms/validation.ts`; `src/modules/forms/challenge.ts`; `src/modules/forms/submit.ts`; `src/ui/native/pages/request-forms/RequestFormsSettings.jsx`; `tests/helpers/request-forms-journey.mjs`; `tests/helpers/self-service-fixture.mjs`; `tests/journeys/knowledge.mjs`; `tests/helpers/inbox/tickets-browser.mjs`; `tests/journeys/inbox-browser.mjs`; `tests/helpers/account-lookup-journey.mjs`; `tests/helpers/account-lookup-browser.mjs` | Implementation and acceptance gaps: Order lookup remains incomplete. Native account lookup uses a verified current customer identity and current explicit membership in an unmerged account in the same workspace. An authorized owner or admin deliberately publishes the customer-facing account field by including it on a published form; only eligible account identifiers and labels are disclosed. Eligibility is independent of company-wide portal ticket visibility. Identity, membership, eligibility, publication and field permissions are checked at offer and admission, including guarded writes; forged, foreign, hidden, merged and revoked choices receive field-specific refusals. No membership is derived from domains. The quoted ct alternative is implemented; final ct approval remains pending. Future order lookup must inherit the same current-authority checks. Live qualification gap: Real Turnstile hostname and site-key verification and mail-provider delivery and verification links remain unobserved; simulated challenge and mail responses are fixture evidence only. Live Turnstile and mail delivery receipts are absent; FORMS_TURNSTILE_SECRET_KEY is not provisioned. Historical form and field versions and their values are retained, but do not qualify live providers. |
| `KNOWLEDGE-002` | Governed private and multilingual knowledge | target | partial | `src/modules/knowledge/access.ts`; `src/modules/knowledge/experience.ts`; `src/modules/knowledge/experience-routes.ts`; `src/modules/knowledge/help-auth.ts`; `src/modules/knowledge/public-sources.ts`; `src/modules/public-site/help-center.tsx`; `tests/journeys/knowledge.mjs` | Implementation/acceptance gaps: Explicit account/company-entitled collections and permission-aware restricted agent retrieval remain incomplete; per-brand domain publishing and agent-proposed cited changes are absent. Existing email-domain gates do not satisfy the account-only acceptance. Live qualification gap: Custom-domain/DNS publishing, real customer mail authentication and account/company entitlement from a real account system remain unobserved; local audience fixtures do not qualify them. |
| `KNOWLEDGE-003` | Branded help center, article feedback and knowledge in the ticket | target | partial | `src/modules/knowledge/feedback.ts`; `src/modules/knowledge/analytics-routes.ts`; `src/ui/native/pages/knowledge/KnowledgeExperience.jsx`; `src/ui/dashboard/components/ArticlePicker.jsx`; `src/modules/public-site/help-center.tsx`; `src/modules/public-site/request-pages.ts`; `tests/journeys/knowledge.mjs`; `tests/journeys/public.mjs` | Implementation/acceptance gaps: Per-brand custom domains and ticket-after-reading attribution remain incomplete; request-form template acceptance is unproved. Live qualification gap: Real brand-domain/DNS/TLS publishing and customer mail delivery of inserted links remain unobserved; local host/template fixtures do not qualify domains or receipt. |
| `BRANDS-001` | Multi-brand support operations | target | done | `tests/journeys/inbox.mjs`; `tests/journeys/reports.mjs`; `tests/reports/figures.mjs`; `tests/journeys/inbox-browser.mjs` |  |
| `ACCESS-001` | Enterprise identity and custom permissions | target | partial | `src/modules/access/`; `src/platform/auth.ts`; `src/modules/integrations/inbound-authority.ts`; `src/edition/delegation/common.ts`; `src/modules/tickets/model.ts`; `tests/journeys/identity.mjs`; `tests/helpers/inbox/ticket-lifecycle.mjs` | Implementation/acceptance gaps: `knowledge.read` and optional per-role `knowledgeArticleIds` select internal articles independently of edit/publication. `tests/helpers/identity/roles-audit.mjs`, rolesAuditJourney (registered in `tests/journeys/identity.mjs`), asserts selected native lists/search/history/translations and connected-grant evidence, refusal outside the current role selection, no edit/publication, next-request permission/selection revocation and security-log access/refusal/revocation entries. Migration 251 persists the role selection; omitted selections retain workspace-wide compatibility, while an empty selection reads no articles. Internal source/dataset management remains separately gated; published help keeps audience gates. Exact-SHA Verify remains required. SSO (SAML/OIDC), SCIM and brand/team permissions remain absent. Live qualification gap: Real Google Workspace, Microsoft Entra ID or Okta SSO/SCIM provisioning/deprovisioning remains unobserved; native-role and connected-grant fixtures do not qualify an identity provider. |
| `IDENTITY-003` | Two-factor authentication for native accounts | target | done | `src/modules/identity/two-factor/`; `src/platform/auth.ts`; `src/edition/delegation/consent.ts`; `tests/journeys/identity.mjs`; `tests/journeys/identity-browser.mjs`; `tests/journeys/delegation-browser.mjs` |  |
| `MOBILE-001` | Support from a phone | target | partial | `src/ui/dashboard`; `src/modules/widget`; `tests/journeys/inbox-browser.mjs`; `tests/journeys/reports-browser.mjs` | Implementation/acceptance gaps: Native iOS/Android apps, mobile push and protected offline work are absent. Live qualification gap: Real iOS/Android devices, push-provider delivery/deep links and offline/revocation/cache behavior are unobserved; 1440/390 browser fixtures do not qualify native mobile behavior. |
| `OUTCOMES-002` | CSAT across support channels | target | partial | `tests/helpers/csat-journey.mjs`; `tests/helpers/customer-portal-journey.mjs`; `tests/reports/ratings.mjs`; `tests/journeys/reports-browser.mjs` | Implementation/acceptance and live qualification gaps: Native permitted messaging-channel transports, identity/consent/window/template rules and survey dispatch/response remain incomplete. Live mail and messaging-provider delivery receipts remain pending. Browser qualification passed at 1440/390. |
| `REPORTS-002` | Workload, service and agent outcomes | target | partial | `tests/reports/team-journey.mjs`; `tests/reports/figures.mjs`; `tests/reports/ratings.mjs`; `tests/journeys/reports-browser.mjs` | Implementation/acceptance and live qualification gaps: Handle time by agent, form and intent is asserted by `tests/reports/team-journey.mjs`, teamReportsJourney, using independent historical form/intent cohorts, duration/session counts and unattributed work reconciled with the total; exact-SHA Verify remains required. Native procedure-version attribution/execution and the complete procedure-attributed cohort remain missing. AI containment and independently observed recovery remain unproved; customer confirmation is labeled separately. Real scheduled-mail receipt and production channel cohorts remain unobserved. Browser qualification passed at 1440/390. |
| `AGENT-001` | A production support agent with clean handoff | target | partial | `src/modules/ai-support/service.ts`; `src/modules/knowledge`; `src/edition/delegation/routes.ts`; `tests/journeys/first-run.mjs`; `tests/journeys/delegation.mjs` | Implementation/acceptance gaps: Full multichannel, business-action and production-quality coverage is incomplete. Live qualification gap: Representative real-model channel evaluations, restricted retrieval/actions, mid-tool handoff and production-quality outcomes remain unobserved; fixture answers and local handoff do not establish a production support agent. Answering by a live model on an independently installed website/domain remains unobserved; P3 uses a provider-edge fake. |
| `PROCEDURE-001` | Natural-language procedures and release simulation | target | partial | `tests/helpers/ai/procedures.mjs`; `tests/journeys/ai.mjs`; `tests/helpers/ai/procedures-browser.mjs`; `tests/journeys/ai-browser.mjs` | Implementation and acceptance gaps: Controlled production rollout, conversation attribution, revocation and rollback remain absent. Synthetic sandbox tools mirror read-only retrieval names against an isolated fixed publication; integration with real knowledge versions and live data requirements remains unimplemented. Historical examples are not admitted. Initial mode approved with ct riders (27 October): owner or admin with settings permission only, explicit synthetic-only confirmation, no historical customer text transfer and no real actions. This initial mode does not complete the clause or replace contracted historical replay, versioned operational context or controlled production release; all three remain gaps. Live qualification gap: Real-model tool execution in an approved bounded cohort with version-linked conversation results and rollback remains unobserved; synthetic model-edge fixtures do not qualify production procedures. |
| `AGENT-002` | Inspectable quality and resolution economics | target | partial | `tests/journeys/ai.mjs`; `tests/helpers/ai/answers.mjs`; `tests/helpers/ai/assistance.mjs`; `tests/helpers/ai/lifecycle.mjs`; `tests/journeys/ai-browser.mjs`; `tests/helpers/ai/suggestions-browser.mjs`; `src/edition/ai/training-trace.ts`; `tests/journeys/first-run.mjs`; `tests/reports/figures.mjs` | Implementation gaps: Procedure report drill-down, joined negative CSAT and reopened outcomes, procedure evaluation coverage, known-denominator rates and reconciled USD cost estimates remain incomplete. The trace shows the latest 50 executions; approval describes the recorded automatic assistant policy or explicit operator request, not a separate per-tool human consent receipt. Provider cost remains unavailable without reconciled price evidence. Live qualification gap: Actual production traces, tool and procedure outcomes and costs reconciled to real usage and prices remain unobserved; network-edge fixtures establish no live economics. |
| `FEEDBACK-001` | Source-linked feedback and release follow-up | target | missing |  | No implementation located. No Penny/Vector feedback and shipped-feature support follow-up implementation located. |
| `ERASURE-001` | Customer erasure with coherent history | target | done | `src/modules/management/contact-erasure.ts`; `src/modules/management/contact-erasure/providers.ts`; `tests/journeys/erasure.mjs`; `tests/journeys/erasure-browser.mjs` |  |
| `AUDIT-001` | Security and accountable actions | target | done | `src/modules/audit/`; `migrations/180_account_security.sql`; `tests/journeys/identity.mjs`; `tests/journeys/erasure.mjs`; `tests/journeys/identity-browser.mjs` |  |
| `PORTABILITY-001` | Complete customer-owned portable support data | target | done | `tests/helpers/installer/fresh-install.mjs`; `tests/journeys/installer-nightly.mjs`; `tests/helpers/rer-archive.mjs`; `tests/helpers/rer-data.mjs`; `tests/helpers/business-portable.mjs`; `tests/helpers/campaigns-portable.mjs`; `tests/helpers/installer/readme-restore.mjs`; `tests/helpers/unfinished-portable.mjs`; `tests/helpers/training-portable.mjs`; `tests/helpers/platform-archive.mjs`; `tests/helpers/installer/hosted-export.mjs` |  |
| `ASSURANCE-001` | Qualified regulated support deployments | target | missing |  | No implementation located. No regulated-deployment agreement/control qualification flow or compliance acceptance located. |
| `PUSH-001` | Reproduce, repair and prove customer recovery | push-further | partial | `src/modules/local-computer/results.ts`; `src/edition/delegation/routes.ts`; `tests/journeys/delegation.mjs`; `tests/helpers/delegation-journey/case.mjs` | Implementation/acceptance gaps: Sustained customer recovery verification, later recurrence and reopening remain incomplete. Live qualification gap: Repair and independent observation of an authorized real customer product/workspace remain unobserved; edge-fixture readback and sent reports do not establish live customer recovery. |
| `PUSH-002` | Promises survive every handoff | push-further | missing |  | No implementation located: obligation records with owner and due time, reminders and follow-up drafts are absent (durable messages and notes in `src/modules/conversations/admission.ts` are not obligations). |
| `PUSH-003` | Learn from reopenings under human control | push-further | missing |  | No implementation located: version-joined diagnosis of reopened cases, proposals and controlled rollout are absent (evaluation runs in `src/modules/training-runs/runner.ts` are generic). |
| `PUSH-004` | Turn verified edge cases into reviewed knowledge | push-further | missing |  | No implementation located: gap clustering from unanswered cases, sourced draft articles and recovery measurement are absent (article authoring in `src/modules/knowledge/authoring.ts` is manual). |
| `SURFACE-001` | Complete support job registry | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
| `SURFACE-002` | Support records and handoff events | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
| `SURFACE-003` | Internal work and outside exposure | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
| `SURFACE-004` | Refunds and binding promises | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
| `SURFACE-005` | Support authority and irreversible data | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
| `SURFACE-006` | Provider steps and running services | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
| `SURFACE-007` | A seeded support week through MCP | target | missing |  | The unified specialist registry and this support-specific conformance journey are not implemented. |
