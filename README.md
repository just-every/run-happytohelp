<p align="center">
  <a href="https://justevery.com/#vol-happytohelp">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/banner-dark.webp">
      <source media="(prefers-color-scheme: light)" srcset=".github/assets/banner-light.webp">
      <img src=".github/assets/banner-light.webp" width="100%" alt="HappyToHelp: Customer Support, Solved. 100% free, open source alternative to Zendesk, Intercom, Help Scout and Freshdesk.">
    </picture>
  </a>
</p>

<p align="center"><a href="https://justevery.com">Part of Just Every</a> · <a href="LICENSE">MIT licensed</a></p>

<p align="center">
  <a href="https://justevery.com/#vol-happytohelp"><img src=".github/assets/media/preview.gif" width="800" alt="HappyToHelp: the agent reviews Codex's suggested reply, presses Send, and the customer replies that it worked"></a>
</p>
<p align="center"><a href="https://justevery.com/#vol-happytohelp"><b>Watch the full demo</b></a> · 56 seconds</p>

<p align="center">
  <img src=".github/assets/media/flow.webp" width="800" alt="Three steps: the task sent to Theo's MacBook, Resolve completed with the fix, and the customer's widget showing the reply and her thanks">
</p>

<p align="center">
  <img src=".github/assets/media/screen-1.webp" width="800" alt="HappyToHelp inbox: Codex's internal note on the fix, the reply sent to Olivia Bennett, and her answer It worked! Thank you so much, with the local agent panel beside it"><br>
  <sub>Your agent's fix, your reply and the customer's thanks, in one conversation.</sub>
</p>

<p align="center">
  <img src=".github/assets/media/screen-2.webp" width="800" alt="HappyToHelp's Move in page: a Zendesk export uploaded and ready for review, with Approve and import"><br>
  <sub>Move in from Zendesk: imports keep source details and never message your customers.</sub>
</p>

# HappyToHelp

HappyToHelp is an open-source support workspace with a customer chat widget,
shared inbox, AI-assisted replies, help centers, customer context and optional
work delegated to your own Codex or Claude. It works with human replies without
an AI provider. The editable React application runs on Cloudflare Workers with
Hono, D1, R2, Queues and Durable Objects.

## Release 0.4.13

Deploy version 0.4.13, the latest tagged release **`v0.4.13`**, using the commands below.
No breaking change. Twenty-six migrations.

- **Setup manifest binding:** rer-project.json now declares `setup` {`rer-setup.json`, sha256 of that file}, so a Platform install of this release reads the setup manifest at the approved commit; the drift-guard script added with it is removed again and the binding stays.
- **App pass (H6 to H20, UI-001):** inbox views in the rail, ticket actions in the reply card's "+" start menu, the right panel as the ticket's record and the system UI face in place of Inter (H6/H7/H8/H9/H12/H13/H14); the assigned agent's initial at 13px (H11); condensed inbox rows (H16); daily work in the left menu and configuration under Settings (H18); one shared tooltip on every icon-only control (H19); a one-step local trial in Setup (H20); comfortable, scoped Settings click and focus targets with one focus ring, and reply attachment upload failures shown with recoverable drafts kept (UI-001); the installer theme kept to rer's grammar.
- **Widget:** presence-based away: with no teammate online the widget shows the away message, which is not a teammate's reply for automations or outcomes (WIDGET-001, migrations 240 and 241); opening hours from applicable SLA calendars with away replies and the reply estimate kept; proactive widget campaigns with consented attribution, a daily-cap fence and consent-revocation cleanup (migration 243).
- **Workflows, forms and SLAs:** request forms and typed answers in routing and SLA policies, On-hold policy choices, signed workflow webhooks executed once, field history and current field permissions; account lookup fields (FORMS-001, migration 259); SLA Slack escalations with explicit destination consent and durable outcomes (migration 257_sla_slack); reviewed Zendesk first-response SLA policies imported as inactive.
- **Customers and identity:** operator-reviewed identity links (CUSTOMER-001, migration 242) with "possibly the same customer" links on the customer page and ticket, and kept link and unlink history (migration 252); inherited workspace and inbox names are refused.
- **Mail:** Managed conversation mail v1 with route observation (migrations 249 and 250), authentication holds and settled held scheduled replies; mailbox protocol and operator ticket doors, proven form CCs, requester notice batches with preview, rate limits and durable notice commands (migration 255); bounded inbound receipt and API hold lookups (migration 256).
- **Move-in and portability:** reviewed Zendesk, Freshdesk and Help Scout configuration as native drafts, preserved imported ticket lifecycle (246), signed survey response surfaces and widget survey cycles (244, 245), causal AI handoff receipts (247), optional customer recovery (248), complete native restore and hosted archive export coverage; explicitly supplied Freshdesk attachment bytes (MOVE-IN-002, migration 257_move_in_attachment_bytes); the move-in journeys folded within the test budget.
- **Knowledge:** internal knowledge reads limited to each role's selected articles (migration 251), with the compatibility and selection-revocation repair.
- **API and connections:** the machine support request API with credential entities, shared admission, quotas and erasure inventory (API-002, migrations 253 and 254); the read-only HubSpot customer context API, its owner and admin connection interface and stable HubSpot panels (CRM-001, migration 257_hubspot_context), with operator first-message sends recovered through the queue; Teams escalation handoffs from a ticket (ESCALATION-001, partial, migration 258_teams_escalations).
- **Procedures, agents, feedback and reports:** immutable procedure versions with isolated synthetic simulation (PROCEDURE-001, migration 258_procedure_versions), saved procedure comparison and revision lineage and more readable saved procedures; redacted conversation execution traces joined to their resolution cycles (AGENT-002); human-confirmed incident suggestions (CONV-003); conservative native AI containment reports (REPORTS-002); source-linked feedback with signed release updates and a Penny handoff (FEEDBACK-001), and regulated-deployment qualification records (ASSURANCE-001) (migrations 260, 261 and 262).
- **Dependencies:** Zod 3.24.2 to 4.6.6 with public validation responses preserved, postal-mime 3.0.0 to 4.0.8, the undici override 7.29.1 to 7.30.1 and Vite 8.2.2 to 8.2.4; react-tooltip and zod-to-json-schema are removed.
- **Tests, CI and documentation:** duplicate browser journeys run once with a phone smoke, within the test budget; Verify in eight balanced shards with reusable proven runs, rerun artifacts, 30-minute browser jobs and timer-polled plugin-frame waits; contract re-judgements and text rulings, the API-002 clause, SOURCE-001 status, the no-Node installation guide and AGENTS.md landing and conflict-resolution guidance.

**Migrations from v0.4.12:**

- `240_operator_presence.sql`
- `241_away_reply_not_a_reply.sql`
- `242_customer_identity_links.sql`
- `243_widget_campaigns.sql`
- `244_csat_response_surface.sql`
- `245_widget_survey_cycles.sql`
- `246_imported_ticket_lifecycle.sql`
- `247_ai_handoff_receipts.sql`
- `248_customer_recovery.sql`
- `249_rer_conversation_mail.sql`
- `250_rer_mail_route_observation.sql`
- `251_knowledge_read_selection.sql`
- `252_customer_identity_link_history.sql`
- `253_api_requests.sql`
- `254_api_erasure_inventory.sql`
- `255_outbound_notice_commands.sql`
- `256_inbound_lookup_indexes.sql`
- `257_hubspot_context.sql`
- `257_move_in_attachment_bytes.sql`
- `257_sla_slack.sql`
- `258_procedure_versions.sql`
- `258_teams_escalations.sql`
- `259_account_lookup_fields.sql`
- `260_feedback.sql`
- `261_assurance.sql`
- `262_feedback_penny.sql`

Update from v0.4.12, or any earlier line, to v0.4.13 without resetting. Back up D1, R2, Durable Object state and private settings first. Install frozen dependencies with Node 22.20.0, pnpm 10.12.4 and pinned @runeditrun/rer 0.2.77. Retain private settings, owners, imported support history, permissions, files, erasure fences and migration history; never delete, reorder or edit ledger rows. Run rer deploy --dry-run against the retained installation first. Apply the following twenty-six migrations once, in listed order and by file name, through pinned rer before the updated Worker serves traffic: 240_operator_presence.sql, 241_away_reply_not_a_reply.sql, 242_customer_identity_links.sql, 243_widget_campaigns.sql, 244_csat_response_surface.sql, 245_widget_survey_cycles.sql, 246_imported_ticket_lifecycle.sql, 247_ai_handoff_receipts.sql, 248_customer_recovery.sql, 249_rer_conversation_mail.sql, 250_rer_mail_route_observation.sql, 251_knowledge_read_selection.sql, 252_customer_identity_link_history.sql, 253_api_requests.sql, 254_api_erasure_inventory.sql, 255_outbound_notice_commands.sql, 256_inbound_lookup_indexes.sql, 257_hubspot_context.sql, 257_move_in_attachment_bytes.sql, 257_sla_slack.sql, 258_procedure_versions.sql, 258_teams_escalations.sql, 259_account_lookup_fields.sql, 260_feedback.sql, 261_assurance.sql, 262_feedback_penny.sql. An earlier installation also applies its other missing published migrations by name through pinned rer. Held secrets inherit; the seven Google, Microsoft and IMAP mailbox settings stay optional, and the new Managed email inputs are optional and unused by a native installation, whose MAIL_PROVIDER stays direct. Connection credentials for Slack, Teams, HubSpot and Penny never enter exports; reconnect them after a restore. Escalation connections keep no provider credentials in exports; retain human Send and unconfirmed recovery. The v0.4.12 recovery note for Platform-applied installs still applies. No breaking change.

See [RELEASE.json](RELEASE.json), [Updates and recovery](docs/INDEPENDENT-RELEASE.md) and [the changelog](CHANGELOG.md).

Version 0.4.0 adds Move in for reviewed support-history imports, resolution
feedback with workspace-calendar Reports, Connections with scoped API tokens,
signed webhook events and Slack delivery, and the `rer` local
path. Native passwords, owners and data
are kept. Before the updated Worker serves traffic, back up and apply the ten
additive migrations `0110_move_in.sql` to `119_local_portability.sql` in order;
an existing 0.3 installation follows [Upgrading from 0.3.x](OPERATIONS.md#upgrading-from-03x).
[The changelog](CHANGELOG.md) lists every change. Known limits:

- Accessibility is on a confirmed owner **HOLD**; no WCAG conformance is claimed.
- `rer export` archives cover D1, R2 and **Durable Object** storage (with a
  digest); full Base-data equivalence is not yet established.
- Hosted operating costs are **unmeasured**; timed activation and paid-provider
  execution are not qualified.
- Imports and connections are qualified with **synthetic fixtures** only, without
  real vendor exports or live Slack.
- No hosted installation, compliance or FedRAMP qualification is claimed.
- The hosted service at **app.happytohelp.com** is separate legacy production and
  is not part of this release.

## Run it on your computer

The [install and run guide](https://happytohelp.com/docs/install) covers
installation, local sign-in and stopping the app, step by step.

Start it with one line. You need **Node.js 22 or later** (with npm) and Git; check
with `node --version`.

```sh
npx -y @runeditrun/rer dev just-every/run-happytohelp
```

That clones HappyToHelp into `run-happytohelp`, provisions the checkout's own pinned
Node and pnpm, installs dependencies, sets up a local owner and starts the app. To
set it up without starting it, use `npx -y @runeditrun/rer setup just-every/run-happytohelp`.
Without Node, `curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp`
brings its own. To start it again later, run `cd run-happytohelp && rer dev`.

The install also downloads Chromium (about 280 MB, into your user cache) the
first time: `rer verify` and the browser checks run in it. Dev uses its local
address for the chat widget and generates a private owner password. Wait for `RER_READY`, then open the `RER_OPEN` address to enter as the
real local owner and reach **Setup**. No private answers, email service or AI
account are needed. Use `rer dev --stop` from the checkout to stop the managed app.

Already running 0.3? Keep your checkout and data, and follow
[Upgrading from 0.3.x](OPERATIONS.md#upgrading-from-03x) instead.
See [Install](docs/INSTALLER.md) for private setup answers and
[Local command reference](RUN-LOCALLY.md) for ports, preview and idle shutdown.

To try the customer flow, [install the widget on a local page](docs/INSTALLER.md#try-the-customer-widget-locally),
send a visitor message and reply from **Inbox**. Set that page's exact origin in
**Settings → Widget → Settings**; the app's own origin remains allowed. A visitor's
entered email can receive operator replies even when their identity is labelled
**Unverified**. Local visitor and teammate mail is suppressed without storage or
external sending. With a hosted sender,
**Email sent to provider · delivery not confirmed** on a reply means acceptance, not confirmed inbox delivery.

## Choose how to run it

Local dev is a loopback trial on your computer. An online installation in your
own Cloudflare account lets the widget on your website reach the workspace.
Both use the same rer commands. An independently managed project may select its
own operating contract; this seed's CLI is not a platform admission requirement.

## Deploy to your own Cloudflare account

For a new installation, acquire the latest tagged release **`v0.4.13`**,
after installing `rer` as shown above:

```sh
git clone --branch v0.4.13 https://github.com/just-every/run-happytohelp
cd run-happytohelp
```

Read [deployment prerequisites](OPERATIONS.md#deploy-to-your-cloudflare-account).
When rer says **See the deploy-kit owner-account instructions**, it means
[What you need first](OPERATIONS.md#what-you-need-first): how to make the
Cloudflare API token and find the account ID. Configure the real declaration
and private account credentials, then:

```sh
rer deploy --dry-run
rer deploy --environment production
```

The contract requires two independent steps: a **zero-outbound dry-run** that
explicitly reports no outbound requests, and a separately started **read-only
provider preflight** with owner consent and the owner's scoped Cloudflare token.
The preflight has its own acceptance: only the account's Workers subdomain and
the Worker's settings and secret names (three GETs for an existing Worker), no
mail and no mutations. Neither step is a mock of the other.

That split is not yet built or proved. Today's `rer deploy --dry-run` still needs
the Cloudflare credentials described in the prerequisites and performs those
read-only GETs; it refuses without credentials and when required secrets are
neither held nor supplied. It builds locally, sends no mail and changes no
resources. For a new installation also supply real `EMAIL_PROVIDER`, `EMAIL_FROM`,
`EMAIL_API_KEY` and `OWNER_EMAIL` inputs in an owned 0600 `--env-file`; the owner
email must receive sign-in mail. Existing installations retain held secrets.
The seven optional mailbox settings can stay unset. Live preflight and remote
provisioning remain separately unqualified.

```sh
rer deploy --dry-run --env-file ~/happytohelp-production.env
```

Deployment
provisions declared resources, applies migrations, publishes and checks health
through Base deploy-kit. After a healthy deploy, `rer deploy` claims the owner named
by `OWNER_EMAIL` (a real setup owner, or the value you supply privately) with a one-time
token it then removes. Open your Worker's address and sign in by email as that
owner to reach **Setup**. The owner's name is derived from their email. A Workers
hostname does not name your business: a `workers.dev` website defaults to
**My workspace** regardless of owner email. An explicitly chosen native workspace
name takes precedence; you can change it in Project settings.
Deploy refuses the local placeholder `owner@run-happytohelp.test`: it has no mailbox.
Supply a real `OWNER_EMAIL` privately in your environment or an owned 0600
`--env-file` for both dry run and deployment.
`rer signin --environment production` directs you to this installation's `/login`
page. HappyToHelp uses its native email/password sign-in; the command cannot mint
an owner link. If mail fails, follow the working mail recovery in
[operations](OPERATIONS.md#claim-your-new-installation).
`rer deploy --environment NAME --remove --yes`
removes that environment's created Worker, D1, R2 and queues in one pass,
including uploaded attachments in its R2 bucket, and reads back that each is gone.
Export anything you need before removal. Hosted installation and real provider
execution are not qualified by this release.

## What you need and what it costs

HappyToHelp is MIT licensed with no seats or subscription fees. Your Cloudflare,
email and optional AI providers bill your own accounts. Enable R2 and the account
capabilities required by the declaration before deployment. An email sender must
be verified. Local development needs no external mail or AI credential.

Configure optional model keys, the Apify crawler (for website sources larger than
the built-in reader's 40 pages; see [Website knowledge](docs/website-knowledge.md)),
Qdrant search, GitHub and email only when you need them. See [Optional features and their settings](OPERATIONS.md#optional-features-and-their-settings)
and [Measure local usage and costs](OPERATIONS.md#measure-local-usage-and-costs).
The optional [local agent](local-agent/README.md) runs on the computer doing the
support work and has its own runtime prerequisites.

## After you install

Your workspace is already set up when you first sign in. It has a starter
assistant for visitors, a reply-by-email mailbox when the installation holds an
`INBOUND_EMAIL_TOKEN`, and mail that leaves from the installation's own sender
until your sending domain is verified. The inbound token authenticates incoming
mail; configure your email provider's domain routing and webhook before replies
can arrive. Creating the workspace may send you one welcome email. Use **Setup**,
the first entry in **Settings** (its row there counts what still needs you; an empty inbox links to it): **Needs you** lists what cannot be done for you (the widget on your website, an AI key and, with a hosted
email provider, your sending domain's DNS records), and **What we've set** lists
the rest. Anything under **Needs you** can be skipped for now and picked up later
from **Skipped**. The system runs its own checks while Setup is open, and what it
confirms is counted ("N of M confirmed", without what you skipped): mail to you,
sender DNS, inbound mail, model access, spend ceilings, widget origin and an
authenticated widget visit. Saved settings alone do not complete them. Add the widget through **Settings →
Widget**, set its exact [website origin](docs/SETUP-WORKFLOW.md#the-widget-website-origin),
publish useful articles and invite teammates through **Settings → Agents**. By default the widget does not ask
for an email. For visitors to receive replies by email, enable **Settings → Widget
→ Settings → Required contact details → Require email**. The visitor enters their
address before sending a message; operator replies can then use it on a hosted
installation with email sending configured.

## Set up AI replies

Your starter assistant answers visitors by itself, from the help articles you
publish and from what we read on your website, and within your daily limits, as soon as the installation has a key from
an AI provider. Until then, new conversations stay with your team and the AI page
and Setup say a key is missing.

1. **Get an API key** from OpenAI, Anthropic, Google, DeepSeek, xAI or
   OpenRouter. The provider bills you for what you use.
2. **Add the key to your installation** under the name for that provider:
   `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY` (or
   `GEMINI_API_KEY`), `DEEPSEEK_API_KEY`, `XAI_API_KEY` or
   `OPENROUTER_API_KEY`. The setup answers can store one at install time (see
   [Install](docs/INSTALLER.md#private-setup-answers)).
   - **On Cloudflare:** in the Cloudflare dashboard, open your Worker, go to
     **Settings → Variables and Secrets** and add the key as a secret. You can
     also set it in your terminal before you run `rer deploy --environment production` (see
     [Optional features and their settings](OPERATIONS.md#optional-features-and-their-settings)).
   - **On your own computer:** add a line such as `OPENAI_API_KEY=your-key` to
     a file named `.dev.vars` in the `run-happytohelp` folder, then restart the app.
3. **Setup notices the key.** While the starter assistant is untouched it uses a
   model of whichever provider's key is installed, and Setup confirms the key with
   the provider. To use a different assistant, open **Settings → AI**, add one
   (or choose **Customize** on an existing one), enter the **Model** it uses and
   keep it **Enabled**. Then, under **Responder defaults**, choose which assistant
   answers visitors.

Keep key values out of chat messages and the browser. To cap what visitors can
spend, see [Limits and AI ceilings](docs/PUBLIC-LIMITS.md).

## Try a demo inbox

When your workspace has no conversations yet, the inbox greets you with one
next action and a quiet **Try a demo inbox** link under it. The link creates a
separate, clearly labelled workspace called **Demo inbox · Northstar Outfitters**,
with:

- fictional customer conversations
- a drafting assistant you can edit
- three published FAQ articles

Creating the demo makes no AI, email or other provider calls. To see AI drafting,
open a demo conversation and press **Generate**. HappyToHelp then drafts
suggested replies for you to review, using your AI provider. The demo's
assistant uses OpenAI's `gpt-5.6-luna` model, so this needs `OPENAI_API_KEY`
unless you change the assistant's model (see
[Set up AI replies](#set-up-ai-replies)). Generate never sends a reply to a
customer.

When you are done, delete the demo workspace from its settings.

## Support history, feedback, Reports and connections

Owner/admin **Move in** reviews five kinds: conversations, contacts, tags, saved
replies and articles. Inspect per-kind plans, rejections, omissions, conflicts and
publication changes; approve, resume a stopped batch, follow report links, repeat
or undo through the same current role checks. Original source IDs, timestamps and
private notes remain attributed; published articles stay published and drafts stay
drafts. Apply and undo are inert: no mail, widget messages, model work, assignment
or connection notifications. [The moving-in guide](docs/moving-in.md) explains
formats, source custody and conflict-safe undo. Validation is **documented-format,
synthetic-only; realExport: not-supplied**. The 9 October owner ruling requires exact business-state equality on repeat and
undo. Platform counters/sequences, audit and import journals are excluded; business
notes, source links, identities and native contact content remain checked.

A resolved widget conversation asks **Did this answer your question?** with thumbs
up/down and an optional comment up to 1,000 characters. Only its owning visitor
session can rate its current closed cycle; widget action limits apply and changes
retain history. Native records
store AI, assisted, human or unknown provenance. A visitor message reopens the
conversation; another resolution gets its own record. Reports uses the workspace
timezone and 7/30/90-day or custom calendar ranges for volume, median/p90 first
response and resolution times, AI resolution and satisfaction counts/rates, daily
series and latest comments with conversation links. Conversation and summary CSV
exports guard formula-leading cells. Imports are excluded and Reports calls no
model. [The Reports guide](docs/reports.md) and
[workspace workflows](docs/WORKSPACE-WORKFLOWS.md) explain the denominators.

Settings offers seven explicit token scopes, optional expiry, one-time secret
display, hashed storage, revoke, last use and audit. [The API guide](docs/api.md)
contains thirteen Bearer-only operations. Webhooks support four signed events,
explicit test sends and safe attempt logs; public HTTPS destinations are checked
against SSRF. Slack has incoming-webhook and bot-plus-channel modes. Both have
recorded-response checks only; **live Slack: not-supplied**. Deliveries use ordinary platform HTTPS fetch with manual redirects. Every 3xx fails without following its Location. Requests are limited to 1 MiB, responses (including streams) to 64 KiB, and the entire request/response to 10 seconds. Public HTTPS destination syntax and literal IP validation remain enforced; this edition does not claim DNS pinning. Base HTTP 500 remains uncertain without automatic replay; 429 retains four bounded attempts with the same logical identity and exact body.

Installed owners land on the Setup page, where the system has already done what
it can and lists only what needs them; new workspaces lead with the widget
snippet, with secrets and verification controls under **Advanced**. Empty
inboxes offer widget installation, a link to Setup and a demo. Workspace
headers follow the selected workspace; visitors intentionally see the operator's
display name. Local development suppresses email without storing messages.



## Export conversations

In **Reports**, choose **Export workspace conversations (JSON)**. The `transcripts.json`
download includes every workspace conversation across all dates and imports, with
its messages, private notes and attachment names and metadata. Attachment bytes
remain in the workspace; use the portable backup for those. Exports ask for recent
confirmation: accounts without a second factor can choose **Email me a sign-in link**,
press **Sign in** from their mailbox in the same browser, then return and press
**Continue**. This also works for older email-claimed owners whose generated
password was never known. After mailbox confirmation, **Profile → Security** lets
you set a new password without the old one. Enrolled second factors remain required.
Reports and its analytics CSVs exclude empty widget conversations.

## Contributor setup

For work on the source, select Node **22.20.0** and pnpm **10.12.4**:

```sh
pnpm install --frozen-lockfile
pnpm exec rer describe --json
pnpm exec rer check --profile first-party
```

## Verify

```sh
rer verify
```

The complete target checks the contract, real build, typecheck, native runtime,
command journey, current workflows and selected Base copies. For a change, run
its touched tests plus `pnpm run typecheck`; CI is the full wall. Browser suites
and full verification run on the designated remote runner. Provider fixtures
prove local protocol behavior; hosted acceptance and paid-provider execution
require separate evidence. Preserve [the current holds](HANDOVER.md#acceptance-boundaries).

## Where to go next

Development lives in [just-every/run-happytohelp](https://github.com/just-every/run-happytohelp); the private repository is retained for research and evidence only.

- [Install](docs/INSTALLER.md): private answers and the rer journey.
- [First-run setup](docs/SETUP-WORKFLOW.md): one-screen first run and the Setup page.
- [Operations](OPERATIONS.md): configuration, data movement, deployment and recovery.
- [Updates and recovery](docs/INDEPENDENT-RELEASE.md): owner customizations and backups.
- [Product contract](CONTRACT.md) and [acceptance](ACCEPTANCE.md): requirements and proof.
- [Authoring](docs/AUTHORING.md): source selection and exact Base copies.

## License

[MIT](LICENSE). Third-party asset notices remain under [docs/licenses](docs/licenses).
