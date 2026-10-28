# Support contract mechanisms

The following retained protocol details accompany the capability clauses.

## NATIVE-001

A clean owner can inspect the
operating description before installing dependencies, install locked source,
prepare local or selected remote bindings/migrations, build, verify and deploy
through `rer`. Local setup exits with no app running; dev
prints a private `RER_OPEN` address that enters as the real local owner through
the rer dev v2 boundary, preserving native sessions, roles and passwords.
Reset is explicitly confirmed and local;
export/import preserve supported native data with documented exclusions.
Deployment dry-run makes zero outbound requests and explicitly reports that fact. A separately and explicitly started read-only provider preflight uses the owner's scoped Cloudflare token with owner consent to read the account's Workers subdomain and the Worker's settings and secret names (three GETs for an existing Worker); it sends no mail and changes no resources. Dry-run and preflight are independent steps, neither a mock of the other. The delivered runtime requires no original checkout or PHP service.

## IDENTITY-002

Preserve native password sign-in, first-owner setup, the accepted owner
experience and prior account/workspace data with the maintained Base command mechanisms. Retain this edition's authentication and native owner setup. Existing tenant and permission checks
continue to govern every session. A second factor for these native accounts is required by IDENTITY-003; it adds to native passwords and never replaces them.

## IDENTITY-001

Owner setup, registration, login/recovery,
project switching, membership and widget admission establish native identity.
Every private read/write enforces the current actor/project/role; blocked or
deleted projects and revoked credentials lose access. Provider configuration
never substitutes for user authority. The public widget key and origin are not
a secret: visitor, registration and project-creation requests are bounded by
D1-backed limits (`RATE_LIMITS`) and refused with HTTP 429 and `Retry-After`.

## FIRST-RUN-001

First-run setup is one screen: the
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

## LOCAL-MAIL-001

Trusted local development configuration
uses the rer dev v2 development transport: it validates and suppresses visitor
and teammate mail, reports `development`, stores no messages and exposes no mail viewer.
It sends no external email and never claims delivery. The local
owner enters automatically through the dev boundary; native password identity,
ordinary hosted email-link confirmation and prior stored data are retained.
Production has no local dev surface. Missing credentials or failed remote
delivery never select a local substitute.

## CONVERSATION-001

Customer, operator, generation,
import and administrative writers preserve stable message/command identity,
revision/frontier, attachment ownership and final-reply admission atomically.
Competing or repeated writes cannot admit two incompatible final replies.
Owner/admin contact erasure removes message content while keeping identity,
revision and frontier, so erased transcripts stay coherent.

## DELIVERY-001

Persist before broadcast;
reconnect/outbox replay and socket authorization recover committed messages
after reload, disconnection or process wake. Provisional AI deltas never become
durable final answers until guarded admission succeeds.

## UI-001

Reuse the original React dashboard,
transcripts/drafts/suggestions, settings and Shadow DOM widget; preserve useful
desktop/mobile flows, attachment display, collector/privacy controls and errors.
Native routing and transport use the configured application origin.

## MOVE-IN-001

Current workspace owner/admin
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

## OUTCOMES-001

Current original visitor
sessions may rate a closed resolution with thumbs up/down and an optional
comment up to 1,000 characters. Changes retain history; reopened cycles cannot
receive the previous resolution's rating. Operators retain access to each past
resolution's latest feedback after reopening; visitor eligibility and report
denominators remain tied to the current cycle. Erasure removes rating comments.
Confirmed operator-sent drafts establish assisted outcomes, otherwise confirmed
human replies establish human outcomes. AI requires a complete visible answer
history without a person handoff; missing evidence remains unknown. Status,
assignment and cancellation transitions recheck current authority atomically.

## REPORTS-001

Native conversations created in
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

## CONNECTIONS-001

Owner/admin tokens have explicit
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

## ACTIVATION-001

An owner sees the durable,
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

## AI-001

Retain Ensemble model selection,
context/tools, streamed events, normalization, raw per-round provider usage,
attribution, bounded suggestions and reply lifecycle. Missing providers fail
explicitly when AI is asked for, and a default assistant whose provider has no
key is simply not assigned to new conversations; uncertain provider attempts
remain uncertain and are not replayed automatically. Usage is diagnostic/provider accounting data, not an active
payment, balance or debit system. Visitor-caused automatic AI work is capped per
UTC day per project and installation (`AI_DAILY_CEILINGS`); a skipped reply is
recorded as terminal and never replayed.

## KNOWLEDGE-001

Dataset ingestion/crawl, retained
corpus, lexical/selected semantic retrieval, citations and article/category
authoring maintain project scope and publication state. A failed refresh cannot
replace the last usable published corpus. Public pages exclude drafts/deleted
projects and preserve original canonical article/search routes.

## CONTEXT-001

Profiles, monitoring, insights
and context packets preserve evidence attribution, source bounds, consent and
project ownership. Provider output must satisfy the selected schemas before
becoming usable customer context.

## DELEGATION-001

Pairing, devices/grants,
revocation, tool context and work/result states preserve investigation, resolve
and advance-authorized resolve-and-reply distinctions. Revocation withdraws
authority and never asserts that a local process stopped: started work becomes
terminal with an unconfirmed outcome, and only the device may report cancellation.
Local processes remain in the optional connector, never an implicit Worker capability.

## TRAINING-001

Training and evaluation preserve run/case
state, model/budget selection, raw provider usage and cancellation/recovery.
Synthetic data admission is explicitly local/test-only. Historical pending
attempts require reconciliation; a fixture pass is not live-provider quality
acceptance.

## INTEGRATION-001

Email/inbound mail, GitHub,
branding and knowledge imports use configured native adapters, tenant-scoped
credentials, durable identity and ambiguous-outcome handling. Website previews
use a separate origin, scoped expiring grants and public-network restrictions.
Machine-generated inbound mail never triggers autonomous AI replies,
notifications or outbound email; its classification is recorded before
admission and survives recovery and redelivery. The `email:` message local-id
prefix is reserved for inbound claims and refused by the message API.
Shopify, Stripe and CRM support actions are required by COMMERCE-001, BILLING-001 and CRM-001. HappyToHelp never holds funds or becomes a payment processor; historical imported balances remain custody records, not executable authority.

## PUBLIC-001

The approved
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
press Send.”) on filled aqua number discs;

## PUBLIC-002

“Not just better. Free.” (100% free and
open source, free as in code and free as in cost, MIT licensed, “No seats. No
plans. No fees.”, each promise after a line icon in a pale aqua circle, with the MIT license drawn as an ink card
over a wordless code editor, “free of charge” and the rights highlighted in aqua);

## PUBLIC-003

“The rest of your support desk” (chat widget, shared inbox, help center, suggested
replies, as frameless ink cards numbered on filled aqua discs); “Try it beside what you have” (install, bring the
help center from Zendesk, Intercom or Freshdesk, add the chat widget, on filled aqua discs, beside the finished
import in its window); “Ready when you are.”, a big closing headline with an aqua pen line drawn under it;
and the footer, signed with the header's lockup.

## PUBLIC-004

Below the hero the drawings carry the hero's language: each
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
changing layout, leaving every drawing in its final state and every stroke fully drawn.

## PUBLIC-005

`/docs` renders, at build
time, the Markdown files listed in `docs/site.json`, in the homepage's paper,
ink and Outfit, with section navigation, page contents and GitHub links for
everything unpublished; an unknown page gets the branded 404. Every build
renders the current files, and an unlisted Markdown file fails verification. Dynamic published
help centers retain project scope, canonical links, search and draft/deleted denial. The customer widget
remains available through owner-configured installation; broader marketing
routes, pricing, legal, referrer, waitlist and public auto-widget behavior
are outside this edition.

## MIGRATION-001

Explicit legacy artifacts preserve IDs,
exact historical financial values, transcripts, object hashes, publication and
permissions through resumable guarded D1/R2 import. Historical financial SQL,
imported rows and reconciliation holds remain immutable archive custody; they
never become active payments, balances or provider work. The one exception is an
explicit owner/admin contact erasure: it takes precedence over archive custody for
that contact's personal data and redacts the imported rows and their verbatim
archive copies (row digests are kept, so replaying the bundle does not restore
them), leaving a `contact_erasures` audit tombstone. Old credentials do not
become trusted native authority.

## SOURCE-001

The edition selects maintained
source with inspect/check/lock/release commands. Shared capabilities include
substantial implementation, migrations and meaningful tests; a second consumer
preserves its own policy. Release selects the licensed tree and
retains asset provenance/licensing obligations. Original work is preserved.

## DESK-001

A visitor starts website live chat, identifies themselves under the workspace policy, sends files and returns to their history. Humans see one durable shared inbox with customer history, scoped retained-history search with words, quoted phrases and literal customer-identity matching, open/closed/mine/unassigned/AI/tag filters and saved replies that insert into the composer without silently sending. Ticket status follows the STATUS-001 lifecycle and saved replies extend to MACRO-001 action macros. Replies, attachment downloads and errors are visible on both sides; privacy/collector controls remain effective.

## WIDGET-001

The messenger shows team availability from business-hour schedules (SLA-001) and live agent presence. When no human or permitted AI assistant is available it says so with the expected reply time, captures the visitor's email (or, where consented, SMS/WhatsApp under CHANNELS-001) so the answer reaches them, and creates the ticket instead of leaving the visitor waiting. Leads configure proactive messages triggered by page URL, time on page, scroll depth, exit intent, visitor attributes, returning visit or cart value, with audience, brand, frequency caps and quiet hours. Each proactive message shows a clear sender identity and an easy dismiss, respects consent and collector settings, and never starts a conversation that sends personal data on the visitor's behalf. Impressions, opens, dismissals and resulting conversations and resolutions are reported. This clause backs the homepage hero's "Before they ask".

## MAIL-001

Connect inbound forwarding, an IMAP/SMTP mailbox, Gmail/Google Workspace or Microsoft 365/Outlook using scoped credentials/OAuth. New mail creates tickets and replies thread by stable Message-ID/In-Reply-To/References with deliberate handling of changed subject, aliases and multiple recipients. Operators manage CC/BCC, attachments, signatures and branded sender/reply addresses. Duplicate/redelivered mail, bounces, spam and auto-responders cannot create loops or send twice, and mail classified as spam or failing sender checks goes to the reviewable Suspended view of MAIL-002; reconnect/backfill has a visible cursor and errors, and removal stops new intake without deleting history.

## MAIL-002

Inbound mail that is spam-scored, fails DMARC/SPF/DKIM or alignment, comes from a blocked sender or domain, forges a verified customer's address, exceeds size limits or is a detected mail loop is never silently dropped. It lands in a Suspended view with its reason, authentication results, headers and safely previewed attachments, and creates no ticket, AI work, acknowledgment or notification. Permitted operators recover a false positive into a normal ticket that threads correctly (into the existing ticket when its references match) without retroactively triggering acknowledgments or AI unless they choose to; delete true spam; and block or allow a sender or domain. Recovery, deletion and list changes are audited. Suspended mail is kept for a stated retention period (default 14 days) and then explicitly deleted with an audit record; the view shows counts and the oldest age so nothing ages out unseen. Allow/block lists and suspension reasons are reportable.

## OUTBOUND-001

From the inbox an operator creates a ticket for an existing or new contact: search by name, email or phone or create the contact inline under CUSTOMER-001 identity rules; choose brand, sender address, channel, form, fields, assignee and group; and make the first comment public or an internal note. A public first comment is sent as an outbound email, or, where the customer consented, as an approved SMS/WhatsApp template under CHANNELS-001. The customer is recorded as requester and the operator as submitter, and the customer's reply threads into the same ticket. Logging a phone call or walk-in creates a ticket without contacting the customer. Proactive service notices to several customers (for example a delayed order) create one ticket per requester with a preview, consent checks and rate limits, never send twice on retry and remain distinct from marketing campaigns, which belong to Mango.

## CHANNELS-001

Connect US SMS through Twilio and WhatsApp Business, Instagram Direct and Facebook Messenger through authorized Meta business accounts. Inbound messages, supported media, delivery states and channel identity enter the shared inbox; replies return in the original channel. Respect consent, opt-out, A2P 10DLC registration, approved WhatsApp templates and channel reply windows; an expired window becomes an actionable blocker with an approved continuation, never silent loss or unauthorized cross-channel contact.

## CHANNELS-002

Slack Connect and Microsoft Teams customer channels become authorized support intake, with thread replies, attachments, requester/account mapping and internal/private separation. The team can acknowledge, assign and hand off from Slack/Teams while the canonical support record retains the thread and current status. Installed-channel permissions, edited/deleted events, duplicates and disconnected channels have explicit behavior; Slack notifications alone do not satisfy this clause.

## VOICE-001

Connect Aircall and Twilio Voice numbers for inbound/outbound customer support, business-hours routing, IVR, queues, transfers, voicemail and missed-call follow-up. Calls, consented recordings/transcripts and summaries attach to the customer conversation. The same governed AI procedures can serve voice, email and chat, with immediate human transfer and visible failed transfers; disclose automated agents and obtain recording consent under the configured US jurisdiction.

## QUEUE-001

Support leads define teams, membership, skills, capacity, availability and routing rules by channel, brand, language, account, tag or priority. Route to a named owner, team, round-robin or capacity-aware queue; explain which rule won, prevent starvation and preserve fair state across restarts. Manual takeover, absent/offline assignees, reassignment and unassigned overflow always leave a visible responsible queue.

## TRIAGE-001

Each new ticket and customer message is classified for intent (from a lead-editable taxonomy with US commerce and SaaS defaults), sentiment and language, with a confidence score and the quoted evidence, by the configured model within AI-001 budgets. The predictions become ticket fields that QUEUE-001 routing, SLA-001 priority, AUTOMATION-001/002 conditions, views, AGENT-001 procedure selection and reports can use. A low-confidence prediction routes to the default queue instead of guessing. Operators correct a prediction and the correction is recorded as a label; leads see accuracy per intent against those labels before enabling a prediction for routing. With no model key there is no prediction, shown as unavailable and never invented.

## QUEUE-002

Operators manage workspace-scoped tags, typed/validated custom issue fields (including values customers submit through FORMS-001) and priorities, and statuses from the STATUS-001 lifecycle; saved views can filter and sort on them. Leads select tickets and bulk assign, tag, change priority/status or apply a permitted MACRO-001 macro with a preview, per-record authority checks and a complete partial-failure result. Bulk actions cannot publish replies or reveal another workspace accidentally.

## QUEUE-003

Internal notes and @mentions notify only permitted teammates; followers (internal CCs, distinct from customer CCs and never shown to the customer) receive updates under NOTIFY-001; viewing, typing and unsent-draft indicators warn of collisions before send. Guarded send still refuses stale replies. Operators save personal/shared work views and reusable replies/macros with scoped permissions; private notes and drafts never appear in customer channels, forwarding or public history.

## MACRO-001

Operators apply a personal, group or shared macro that in one action sets the reply text (public or internal note), status, priority, tags (add or remove), assignee and group, followers, custom fields and attachments. Reply text supports placeholders for the requester's name, first name and email, ticket ID, subject and link, assignee, brand, organization, and custom ticket and contact fields, with explicit fallbacks (for example first name, else "there"). Applying a macro previews every change and puts the rendered text in the composer for editing; nothing is sent until the operator sends. A placeholder that cannot be resolved is flagged and blocks sending instead of reaching the customer as a literal. Macros are versioned, permission-scoped by role, group and brand, searchable, usage-reported and applicable in bulk (QUEUE-002). AI may recommend a macro but never applies one silently.

## QUEUE-004

Snooze a ticket until an exact timezone-aware time or a dependency; incoming customer replies wake it immediately. Schedule outbound service replies, see/cancel/edit them before send and prevent stale queued replies after a customer response or reassignment. Each follow-up has a responsible owner, due time, stop condition and visible pending/failed/uncertain outcome; restarts cannot lose it or resend an ambiguous attempt.

## STATUS-001

Every ticket has one status from a lifecycle the lead can extend: New, Open, Pending (waiting on the customer), On-hold (waiting on an internal team or third party), Solved and Closed, plus workspace custom statuses that each map to one of those categories. A customer reply to a Pending or On-hold ticket returns it to Open and wakes its owner. On-hold and every internal status label are never shown to the customer, who sees an open request in the widget, portal and email. A customer reply to a Solved ticket reopens it. After a lead-configured period (default 4 days) a durable time-based automation (AUTOMATION-002) moves Solved to Closed, and Closed is final: a customer reply to a Closed ticket creates a new follow-up ticket linked to it that carries the requester, CCs, tags and fields. Status filters, sorts, views, bulk edits (QUEUE-002), SLA pausing (SLA-001), resolution cycles (OUTCOMES-001) and reports all use this lifecycle, and every change records its actor, time and source (person, rule, automation or customer reply).

## SLA-001

Leads configure first/next response and resolution SLAs by priority, customer plan, channel and brand, using US IANA timezones, weekly hours and holiday calendars. Show due times and pause reasons in the queue; Pending pauses customer-wait clocks and On-hold follows the policy's stated choice under the STATUS-001 lifecycle, and reopen restarts the next-response clock. Durable approaching-breach, breach and unattended-ticket alerts escalate to named backups through inbox/email/Slack/Teams and persist until acknowledged or resolved.

## AUTOMATION-001

Leads version event-triggered condition/action rules (on ticket create and update) for routing, tagging, priority/status, reminders, customer updates and refund-exception escalation; actions include notifying the requester and CCs, the assignee, the group or followers (NOTIFY-001), adding an internal note and calling a signed webhook. Time-based conditions are AUTOMATION-002. Preview the effect against historical tickets in a workflow sandbox without real sends, then publish explicitly. Ordered/conflicting rules, loop prevention, owner, due time and stop condition are inspectable. Background execution persists decisions and failure/uncertainty across handoffs and restart; operators pause, cancel or reconcile work without blind retries.

## AUTOMATION-002

Leads define automations that run at least hourly over New, Open, Pending, On-hold and Solved tickets. Conditions include hours since created, updated, assigned, requester update, agent update, Pending, On-hold, Solved and SLA due, in calendar or business hours (SLA-001 schedules), combined with status, priority, tag, form, field, brand, channel and group. Actions set status, priority, tags, fields and assignee or group, add an internal note and send a templated customer or teammate notification (NOTIFY-001). An automation must include a condition its own action nullifies, or it fires at most once per ticket, so it cannot repeat; publishing one that could loop is refused. Runs are durable across restart, never replay an uncertain send, and record which automation changed what. Ready templates cover the common cases: nudge the customer after 48 business hours in Pending, auto-solve after 96, and close Solved after N days.

## NOTIFY-001

Default, editable triggers send the requester and CCs one "request received" acknowledgment for a new ticket (per channel and brand, with the ticket reference and expected reply time), a notification when a public reply is added, and a solved notice. Machine-generated mail, suspended mail (MAIL-002), imports and merges never trigger them, and each ticket receives at most one acknowledgment even under redelivery. Teammates are notified by inbox, email, push (MOBILE-001) and Slack/Teams: the assignee on assignment and on customer update, the group on unassigned group tickets, followers on update and mentioned teammates on mention, each according to personal preferences and current permission to the ticket, workspace and brand. Templates use MACRO-001 placeholders with a visible failure for a missing value. Every notification carries loop-suppression headers and records its delivery outcome; an uncertain send is never replayed.

## CONVERSATION-002

Merge duplicate tickets with an explicit surviving thread, source links, attribution, attachments, notes, SLA/outcome treatment and reversible history where safe. Forward selected customer-visible content to an external partner and thread their reply back while clearly distinguishing an external participant from a teammate. Customer identity, private notes and channel restrictions are previewed; merges cannot cross tenants or silently erase evidence.

## CONVERSATION-003

An operator marks a ticket as a Problem and links Incident tickets that report the same issue, manually, from search or from a TRIAGE-001 or agent suggestion a person confirms. The problem lists its incidents with customers and counts. Solving the problem can, with a previewed public reply that uses MACRO-001 placeholders per requester, solve or update every linked incident in its own channel, each reply going only to that incident's requester, with per-ticket outcomes and consent and reply-window checks. Incidents keep their own SLA, history and CSAT; unlinking is audited. A problem can link an ESCALATION-001 engineering issue so that one shipped fix updates every affected customer.

## CUSTOMER-001

Maintain contacts, verified linked channel identities, companies/accounts, account members, custom attributes, consent/preferences and all interaction history. Link/unlink or merge identities with preview and source provenance; email text alone never grants access. Show current business-system context with last sync time, permission and unavailable/stale state, plus account-level open work and relationship history. Import contacts and companies from CSV outside a vendor migration with column mapping, validation, duplicate matching by email or external ID, a dry-run preview and whole-import undo; such imports send nothing.

## COMMERCE-001

Connect Shopify stores with merchant-granted scopes; show customer orders, fulfillment, delivery, return and refund state in the conversation. Authorized agents/humans can perform permitted return, cancellation and full/partial refund actions with USD amounts, tax/shipping implications and a reason. Preview the exact order/action, require the configured approval and limit, use provider idempotency and verify provider state before telling the customer it succeeded.

## BILLING-001

Connect Stripe for customer/payment/invoice/subscription context and permitted refunds, credits and subscription cancellation, pause or plan changes. Show USD totals, tax/proration/effective-date consequences and linked provider records before approval; separate read, prepare, approve and execute scopes and spending limits. Reconcile actual provider state after timeout and report what changed in the original conversation. No raw card data or customer funds enter HappyToHelp.

## CRM-001

Connect Orbit, HubSpot and Salesforce independently; map contacts, companies/accounts, support entitlements, plan and owner to support records with source IDs and sync freshness. Read relevant CRM context and write only explicitly scoped support outcomes/approved field changes. Conflicts, identity mismatch and revoked grants are surfaced; the CRM remains the sales/account system of record.

## ESCALATION-001

Create or link GitHub Issues, Linear and Jira issues and Slack/Teams handoffs from a conversation, choosing exactly what context/attachments to share. Persist reciprocal links, assignee, status and dependency; signed provider updates return to the support thread, wake its owner and draft a customer update when a fix ships. Issue closure alone never proves customer recovery; operators approve customer publication or grant an explicit bounded policy.

## API-001

Expose a documented versioned HappyToHelp API and signed outbound webhooks for conversations, contacts, articles and support events with scoped authorization, pagination, stable cursors, idempotency and revocation. Provide Zapier actions/triggers and managed MCP tools with the same tenant/action boundaries. Offer Help Scout Inbox API/webhook read synchronization for staged migration/coexistence, with cursors and deduplication; it is separate from native API authority. Connection health, scopes, event attempts and manual reconciliation are visible. Creating and appending support requests from another product or agent with credentials bound to a source product is covered by API-002, API-003, API-004, API-005, API-006, API-007, API-008.

## API-002

A named source-product credential binds ticket creation and appending to explicit scopes, mailbox, brand and source identity. Its lifecycle preserves the connection-token model and atomic admission. The protocol, overlap bounds and Settings fields are specified in [the machine support-request protocol](docs/contract/machine-api.md).

## API-003

Create a support request from a source product with exact verified requester matching, unverified new identities, a fixed source label and an operator back-link. Source-reference and key replay protect one ticket across credential rotation; conflicts reveal no other identity. The full request and replay contract is in [the protocol](docs/contract/machine-api.md).

## API-004

Append customer messages or private notes within the credential’s conversations, retaining solved, closed and merged lifecycle behavior. Bounded upload references and verified remote attachments admit either the complete ticket and bytes or nothing, under [the attachment protocol](docs/contract/machine-api.md).

## API-005

Treat source-product requests as untrusted customer input, with the same triage, routing and AI policy as other requests. Suspended abuse and requester holds cause no ticket or external effect; acknowledgments depend on consent and channel rules. Capacity and business-policy limits, exhaustion and stable refusal meanings are defined in [the protocol](docs/contract/machine-api.md).

## API-006

Machine-created requests carry source-product and credential provenance into filtered signed support events and ticket history. Revocation retains machine attribution; issuer erasure redacts personal attribution without losing events. Event fields and audit records are specified in [the protocol](docs/contract/machine-api.md).

## API-007

Machine-request erasure covers ticket content, replay bodies, pending events and files, with tombstones that prevent resurrection. Portable archives retain source provenance and digest-only replay records, while all restored credentials and actions remain inert. Exact portable fields and fences are specified in [the protocol](docs/contract/machine-api.md).

## API-008

The on-site API guide covers machine-request operations, scopes, bindings and refusal meanings through usable examples that keep credentials private.

## MOVE-IN-002

Provide guided one-click connection or export upload for Zendesk, Intercom, Help Scout and Freshdesk, covering contacts/companies, conversations/messages/attachments/private notes, tags/custom fields, ownership, timestamps and articles/categories/publication. Preview supported mappings and every unsupported field/rule/brand/permission; no silent truncation. Resume with source IDs, deduplicate a second run, perform an inert final delta cutover and explicitly repoint channels. Preserve links and counts; imports never activate automations or expose formerly private knowledge. Imported tickets keep their email threading keys so post-cutover replies land in them (MOVE-IN-003), and configuration moves in under MOVE-IN-004.

## MOVE-IN-003

Imported tickets keep their email threading keys: every source Message-ID and In-Reply-To/References chain, the source ticket number and each vendor's reply token (Zendesk encoded IDs in `[XXXX-XXXX]` brackets and ticket-number subject tags, Help Scout conversation numbers and reply addresses, Freshdesk `[#ticket]` subjects and reply-to addresses, Intercom conversation reply addresses). After channel cutover, a customer reply to a notification the old system sent is matched by those keys in that priority and lands in the imported conversation with its migrated requester, owner, group and status, reopening it under STATUS-001 when Solved and creating a linked follow-up when Closed. A key that matches more than one record, or a record belonging to a different customer identity, goes to review instead of the wrong ticket; an unmatched reply creates a new ticket marked as a possible pre-migration reply. Keys are imported inertly and are covered by repeat/undo equality and erasure.

## MOVE-IN-004

Move in maps each incumbent's configuration into native equivalents: macros with their actions and placeholders (MACRO-001), views, groups and memberships, business-hour schedules and holidays, SLA policies, request forms and custom fields (FORMS-001), triggers and automations, brands and help-center structure. A per-item preview shows what translates exactly, what translates with a stated change and what is unsupported, with the reason. Translated rules arrive inactive as drafts; an admin reviews, simulates them in the AUTOMATION-001 sandbox and activates them, and nothing sends, routes or breaches during import. Placeholders translate to native placeholders or are flagged.

## PORTAL-001

A customer securely signs in to a branded portal to search permitted knowledge, create tickets with attachments through FORMS-001 request forms (which anonymous visitors may also submit where the lead allows), review/reply/reopen their own requests and manage notification preferences. Company-wide ticket visibility is an explicit entitlement, never inferred from an email domain. Identity recovery, revoked membership and inaccessible/deleted requests fail safely across web and mobile.

## FORMS-001

Leads build several request forms (for example Order problem, Refund, Technical) from typed custom ticket fields (text, number, decimal, date, drop-down, multi-select, checkbox, pattern-validated text and lookups to an order or account), with required and conditional fields, customer-facing labels, descriptions and locale translations, and offer them in the help center, portal, widget and API. Anonymous visitors may submit where the lead allows, with email verification, rate limits and bot protection; signed-in customers' identity and organization are prefilled. Submissions are validated on the server and refused with the failing field named; accepted values are stored as typed ticket fields with the chosen form and are usable by QUEUE-001 routing, SLA-001 policies, AUTOMATION-001/002 conditions, views and reports. Agents see and edit the same fields under field-level permissions; forms and fields are versioned so old tickets keep their values.

## KNOWLEDGE-002

Support public and authenticated private help centers, multiple languages/locales, version history, editorial review, redirects and brand/domain publishing. Source refreshes and translated drafts preserve permissions and previous published versions; restricted knowledge is never exposed to public search, an unauthorized agent answer or another account. Agents may propose cited changes, while named editors control publication.

## KNOWLEDGE-003

Leads brand each help center with logo, colors, fonts, custom domain, navigation and editable page templates (home, category, section, article, search and request form), previewed before publication with readable contrast enforced. Each article offers "Was this helpful?" votes with an optional comment. Leads see per-article views and votes, search terms with and without results, click-through and tickets created after reading, by brand and locale. From a ticket an operator searches the help center, previews an article and inserts its link or text into the reply in one action, limited to knowledge that customer may see, and can flag an article as outdated or propose a new one (PUSH-004).

## BRANDS-001

A business can manage distinct brands, mailboxes, widget identities, domains, help centers, signatures, channels and policies with deliberate shared teams and reporting. Route and report by brand without mixing customer identities, private knowledge or sender credentials. Cross-brand administration and customer handoffs require explicit access and a visible explanation.

## ACCESS-001

Retain native owner/password access while optionally connecting Google Workspace, Microsoft Entra ID or Okta using SAML/OIDC SSO and SCIM provisioning. Define custom roles and field/tool/brand/team permissions for operators, admins, reviewers and agents; separate integration installation, refund approval, knowledge publication and destructive access. Collaborator (light-agent) seats can view permitted tickets, add internal notes and follow tickets but cannot reply publicly, change fields or read restricted knowledge. Deprovisioning/revocation promptly ends sessions, pending tool authority and customer-data access, with tested owner recovery. RULED interim default and target (ct, 23 October 2026 10:46Z): `knowledge.edit` gates internal knowledge management and connected-application article reads; `knowledge.publish` still gates publication. Published help keeps its audience gates, so a reader never gains internal articles through it. A separate knowledge-read permission is required for read-only access to selected internal knowledge without edit or publish authority.

## IDENTITY-003

Native password accounts enroll a second factor: a TOTP authenticator app or WebAuthn security keys and passkeys, with ten single-use recovery codes shown once. An owner can require two-factor sign-in for every teammate or by role; affected users must enroll at their next sign-in before reaching any data, and existing sessions without the factor end. A sign-in without the factor, with a wrong or replayed TOTP code (one use per time step) or with a used recovery code is refused, rate-limited and audited. Owner-assisted reset of a teammate's factor requires the owner's own recent factor, notifies the teammate and is audited; an owner who loses every factor recovers through the documented installation-level owner recovery through `rer`, never by email alone. Refund and billing approval (COMMERCE-001, BILLING-001), integration and credential installation, exports, erasure, role changes and the two-factor policy itself require a recent second-factor step-up. API access uses scoped tokens (CONNECTIONS-001), never a password alone. SSO users follow their identity provider's MFA (ACCESS-001). This adds to the retained native password identity (IDENTITY-002) and never replaces it.

## MOBILE-001

Provide responsive operator/customer web flows and native iOS/Android operator apps for shared queues, push notifications, assignment, notes, attachments, knowledge, approval and reply. Show offline state and protect cached customer data; drafts may persist safely, but reconnect must revalidate role/frontier and scheduled effects. Deep links return to the correct permitted workspace and push payloads omit sensitive content by default.

## OUTCOMES-002

Offer configurable post-resolution satisfaction surveys via widget, portal, email and permitted messaging channels with rating scale, optional comment, locale, send timing and opt-out. Associate one latest response with the exact resolution cycle and channel; preserve previous-cycle history and reconcile signed response links without requiring a widget session. Leads inspect low-score follow-up and customer recovery without auto-closing complaints.

## REPORTS-002

Leads explore team/agent workload, backlog age, incoming volume, response/resolution time, SLA compliance, reopened requests, CSAT and AI containment/handoff/resolution by channel, brand, account, tag and procedure version. Publish inspectable numerators, denominators, timezone and exclusion rules; distinguish bot closure from verified resolution and include failures/unknowns. Operators record time spent per ticket (a timer while the ticket is open, with manual adjustment) and leads report handle time by agent, form and intent. Export complete formula-safe records and schedule permission-scoped reports; no sampling or silent truncation.

## AGENT-001

The AI agent answers using approved help-center content, permitted past conversations and fresh connected customer/product state, with citations, retrieval permissions and clear AI disclosure across chat/email/voice. Execute only enabled procedures/tools; distinguish advice, prepared action, approved execution and observed success. A customer can request a person; uncertain, low-evidence or disallowed actions transfer promptly with transcript, sources, attempted actions, failures and the next responsible human. The agent stops replying after handoff until explicitly resumed.

## PROCEDURE-001

Support leads author versioned natural-language operating procedures tied to intents, knowledge versions, live data requirements, tools, approval gates, budgets and human escalation. Simulate paths, adversarial cases, provider errors, handoffs and permissions against redacted historical examples in an isolated workflow sandbox with no real actions. Per-procedure evaluations must pass declared outcomes before an authorized staged release; compare versions, stop/rollback a rollout and keep old cases reproducible.

## AGENT-002

Operators inspect a redacted per-conversation/tool-call trace with source/version, requested scope, human approval, timings, provider outcome and verified result. Leads explore procedure-level evaluation coverage, resolution/reopen/handoff rates, failure clusters and provider costs/usage without treating attempted actions as success. Human labels and later customer outcomes can correct attribution; provider usage remains accounting evidence, not a customer balance or invented monetary saving.

## FEEDBACK-001

Capture product feedback from a support conversation with the customer/account and supporting quote, link or create its request in Penny, and link engineering delivery in Vector or the buyer's issue tracker. Subscribe the affected requester to an approved service update when a linked feature/fix ships, respecting preference, channel policy and unresolved recovery. Penny owns aggregation, prioritization, roadmap/changelog and requester closure; HappyToHelp retains the support history and responsibility for the customer response.

## ERASURE-001

Owner/admin contact erasure removes personal content from native/imported transcripts, notes, context, feedback, stored files and archive copies while retaining nonpersonal identity/frontier and an opaque erasure tombstone. Erasure fences APIs, pending events, source re-import and stale restore from resurrecting the identity. Provide completion/failed counts for all stores and separately request deletion from connected providers under their capabilities; do not claim already sent messages or offline archive bytes were recalled.

## AUDIT-001

Encrypt configured provider credentials under installation custody, never return secrets in ordinary reads/logs/exports and enforce tenant, role, origin and public rate limits at every door. Keep an inspectable, exportable append-only audit of authentication/permission changes, imports/exports/erasure, assignments, procedure changes, approvals and external actions with actor, purpose, source, time and outcome; redact erased actors without losing the event. Configure retention/legal holds with visible effects and never silently delete evidence to improve reports.

## PORTABILITY-001

Export versioned machine-readable conversations, attachments, contacts/companies, knowledge/versions, settings, rules/procedures/evaluations, outcomes and audit with a schema, integrity digest and explicit exclusions. Validate a bounded archive before atomic inactive restore to a clean installation; do not transfer sessions, provider secrets or connector authority and do not replay imported actions. Include D1, R2 and Durable Object business state or a lossless reconstruction; retain erasure fences and receiving-owner identity. This target replaces the current documented incomplete-storage boundary without pretending the held Base-data equivalence is done.

## ASSURANCE-001

US-first support uses USD, US provider contracts, IANA calendars and channel/recording consent controls. A regulated buyer can qualify an isolated deployment with required DPA/BAA, approved subprocessors/model data handling, access controls, audit, retention, incident response and validated deletion/export; health-data support is gated on those agreements and technical acceptance. The work remains a product obligation, with a named partner/provider path, rather than a claim that self-hosting alone supplies compliance.

## PUSH-001

Given the conversation, authorized live product state and an explicitly paired repair workspace, the agent reproduces the customer's failure, records its observation, prepares or performs only the permitted fix, and verifies with a distinct post-change read or user journey. Environment, operations, data, spending and time limits are granted by a named person; production changes and reply publication have separate authority. Reconcile started/uncertain work, gather customer-scoped recovery evidence, report in the original thread and reopen/escalate if recovery fails or the customer reports recurrence. A successful command or closed engineering issue never proves recovery.

## PUSH-002

The agent extracts explicit commitments, quoted evidence and dependencies from messages and linked issues into durable obligations with a responsible person, due time, current evidence and stop condition. Chase missing evidence internally, detect stale dependencies and draft an honest customer update before a promise expires. Humans accept material due-date or promise changes; no fabricated progress, invented commitment or unapproved customer message is allowed.

## PUSH-003

The agent joins reopened requests, complaints, CSAT, procedure/tool versions and connected business outcomes to identify failed resolution paths. Propose a concrete procedure/policy change with cited cases, replay evaluation and expected effect; a human approves changed permissions/tools, spending limits and bounded rollout. Track actual post-release recovery and regression, stop/rollback on deterioration and preserve original procedure versions and dissenting evidence.

## PUSH-004

The agent identifies unanswered or repeatedly reopened topics from permitted conversations, support searches and procedure failures, clusters the gap and drafts a sourced article/update from verified resolutions. Strip personal data, obey private/brand/locale boundaries and include the evidence and proposed scope. A named editor reviews publication/translation and the agent measures whether later customers recover, proposing corrections when they do not.

## Import equality cache boundary

The platform admission index's `move_in_contact_keys.email_digest` remains lazy derived memoization. Exact business equality preserves its project/contact links and validates each populated digest against the native email; NULL-to-correct-digest does not alter business state. Contacts, native email, identity and all source/business links remain in the equality comparison.
