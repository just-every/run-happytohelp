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

## Release 0.4.22

Deploy version 0.4.22, tagged **`v0.4.22`** once published. v0.4.21 is the last published release; upgrades are qualified from v0.4.21 and v0.4.20. The pinned installer is rer 0.2.110.

- **Fixes — the every-minute scheduler, outbox delivery and message sends read only the work that is due:** on a large imported workspace with a growing outbox (every mail and chat message adds a row and none is ever removed), a backlog of workflow events waiting for a retry and tagged conversations, the scheduler's due-event pass and its refresh of rule and automation events, outbox delivery, a new conversation's live connection and each message's workflow and tag reads walked every outbox row, pending workflow event or tag link of the database: about 36,000 rows in a minute with nothing due, over a million once 20 events were due, and about 27,000 for each new chat's connection. They now search indexes of the undelivered outbox rows, the due and leased workflow events and each conversation's own tags, so this work reads about 15 rows in a minute with nothing due, under 50 for a message send and a handful for a new chat's connection, whatever the size of the outbox. The same events are claimed in the same order, the same messages are delivered in the same ticks, and every rule matches as before. One read is unchanged: the hourly pass of a time rule (such as closing solved tickets after four days) still reads the rule's whole status set, imported history included. The read of one conversation's pending workflow events and the bulk ticket workflow update read only the selected conversations' own events, in the same order as before, and the same rows are returned and updated.
- **Fixes — a re-crawled help site no longer makes conversations that cite its older pages walk the site:** deciding whether a cited page of an older crawl version is still current looks for a page of the published version at the same URL, and with no index holding that URL it read every page of the published version for each cited page whose URL is no longer published (about 2.6 million rows to open a conversation with 16 copied passages of 255 such pages on a large imported workspace). An index on a page's version and URL makes that lookup read only the pages at that URL. The decisions are unchanged. The same index would have made three lists that carry no explicit order come back in URL order instead of the order the pages were crawled: a dataset's pages list, which pages lexical search and the AI knowledge tool return among pages tied on score, and which 12 pages the customer-context catalog holds. They now state the crawl order (dataset, then the order its pages were stored) and read the same rows as before.
- **Fixes — opening a conversation no longer writes reference blocks:** until now every read of a conversation, thread or list also ran the copied-text check on the text it returned: it looked each passage of 12 or more words up in the knowledge index, refreshed that index when a help article had changed, and stored a reference block for each passage that matched a help article. On a large imported workspace that cost about 45 database statements and 27,000 rows read for one open, the stored blocks grew with reads alone, and the busy-database answer (503) showed up under load. A read now writes nothing and renders the references the stored text already holds, for each reader's current access, as before; the training-run artifact read and a live chat connection's replay of the messages it missed behave the same. Copied passages still become references when text is written (messages, notes, replies, saved replies, imports, pulls, mail), and the knowledge upgrade still does it for stored text. A Move in import step or a Zendesk pull step that lands articles now also brings the copied-text index current itself (up to 100 sources a step), which opening a conversation used to do as a side effect. What differs: text that was stored as plain words because it matched no help article when it was written, and matches one only now (an article published or edited later, for example a reply later turned into an article), is shown as stored to everyone who can read that conversation, instead of being replaced by "[Knowledge unavailable]" for a reader without access to that article; nothing stored changes. No migration.
- **rer 0.2.110 — the roster corner for a teammate erased by an older release is closed where HappyToHelp holds their hashed form, the managed-copy build issue REPORTS-001 is fixed, and the local key page changed:** the team adapter now names the older-release form of a roster address (`erased:` plus the SHA-256 of the lower-cased address, which v0.4.14 through v0.4.19 renamed an erased teammate's roster row to, and which v0.4.19 also stored as an inactive fence row at invite 0 for a teammate who was never on the roster), so a Business revision that lists a teammate erased by one of those releases by real address without a member id applies as retired (no fresh account, no invitation, no roster row) instead of the re-creation that the v0.4.20 and v0.4.21 notes describe as a known limit. What this does not cover: (1) a teammate erased before v0.4.14, which includes every teammate erased on production's v0.4.13 line, left no hashed form (the roster table first shipped in v0.4.14), so nothing recognises them from their address and a Business that lists them by address without a member id still creates a fresh account and an invitation; a Business that sends member ids fences them; (2) a teammate who was never on the roster and was erased by v0.4.19 is fenced only at invite 0, so a Business listing at invite 1 or higher admits them as a new person, as a larger invite number always does; (3) a person is recognised only under the address v0.4.19 stored for their roster row. The pin also fixes the managed-copy build (`rer check` no longer fails a managed copy of a published release for `.github/workflows` contract evidence it does not carry, REPORTS-001 on `.github/workflows/installer-journeys.yml`; proven on a synthetic managed copy with the platform's `rer-upstream.json`, not through a real platform build, and an install of an untagged commit keeps the check). The local key page (`/__dev/key`) now names the exact `rer dev` command to run, and the wording about the `/run` PATH changed; one known limit of that page: it tells a local owner who invited a teammate to run `rer dev --as <email>`, which HappyToHelp does not accept, because its local personas are the owner and signed-out only. Pins rer 0.2.110 and its Base copy. No migration.
- **Known limit — recovering an account that belongs to more than one workspace (still true in this release):** since v0.4.21 an owner changes a teammate's password or two-factor sign-in only where that workspace holds the account's sole membership. With outbound mail off (`MAIL_PROVIDER=none`), `/forgot-password` answers `503` for every account and sends nothing, so such an account cannot ask for a reset link by email, and the owner of either of its workspaces is refused with `409`; the deployer's hosted sign-in selects only an owner or an admin, so it does not help an operator-role teammate. An operator-role teammate in more than one workspace who has lost every second factor and recovery code has the same dead end with mail on or off, because `/forgot-password` changes only the password and an owner's two-factor reset is refused with `409` for such an account. The way out uses ordinary doors and keeps all support history (the removal drops the teammate's conversation follows and custom roles in that workspace, which its owner sets again): an owner of one of the account's workspaces removes it there (`DELETE /api/management/projects/<workspace id>/agents/<user id>`), the owner of the other workspace then issues the password-reset link or resets the two-factor sign-in, and the first workspace invites the teammate again. This release does not change the rule.
- **Correction to the v0.4.20 note on `rer deploy` and the mail secrets:** the v0.4.20 note said an offline `rer deploy --dry-run` lists the seven bound mail secret names and says the bound secrets were not read. That is what the dry-run prints with outbound mail off (`MAIL_PROVIDER=none`). Without any mail input (a new installation with `OWNER_EMAIL` only) it prints instead the production sign-in mail inputs a real deploy needs (`MAIL_PROVIDER`, `MAIL_FROM`, `EMAIL_API_KEY`) and still completes offline. Both shapes were run against this release's pinned rer 0.2.110: with `OWNER_EMAIL` only it printed that production sign-in mail line, and with `MAIL_PROVIDER=none` it printed "Outbound email is off (MAIL_PROVIDER=none) … The bound secrets were not read: if one of EMAIL_PROVIDER, EMAIL_FROM, EMAIL_API_KEY_NAME, MAILGUN_DOMAIN, MAILGUN_REGION, MAILGUN_SENDING_KEY, MAILGUN_WEBHOOK_SIGNING_KEY is bound on the Worker, outbound email is configured by it" (the seven names); both completed offline with exit 0, and neither needed Cloudflare credentials, although the README's deploy section still says the dry-run refuses without them.
- **Documentation — owner resets and the sole-workspace rule:** `OPERATIONS.md`, `docs/UI-PARITY.md` and `docs/account-security.md` now say what v0.4.21 enforces and left out: an owner's password-reset link and two-factor reset for a teammate work only while that owner's workspace holds the account's sole membership and the account does not administer the installation, otherwise the owner gets `409` until an owner of the other workspace removes the account there; with `MAIL_PROVIDER=none` `/forgot-password` answers `503` for such an account; hosted sign-in by the deployer works only for an owner or an admin. A regression test now covers the `409` and the reset that succeeds once the other workspace's owner removes the membership.
- **Migrations:** two since v0.4.21, applied once each, in this order, BEFORE the new Worker serves traffic: `324_scheduler_outbox_reads.sql`, then `325_knowledge_documents_version_url.sql`. Upgrade order is v0.4.21 -> v0.4.22: a v0.4.21 installation applies exactly these two (a v0.4.20 installation too, since v0.4.21 added none), and earlier installations first apply every missing published migration. Both are additive and index-only, with no row changes and nothing read, sent or queued: 324 creates seven indexes on conversation tags, the conversation outbox and workflow events (each builds in under a second on a large imported workspace), and 325 creates one index on `knowledge_documents (version_id, url)`. What an upgrading install should expect from 325: in the knowledge-index round, applying it to a real D1 database holding 3,154 documents read 7,721 rows, wrote 3,806 and took 109 ms; a far larger knowledge table (an installation that keeps many large crawl versions) was not measured, and the build cost grows with the number of documents, so back up D1 first and apply it before the Worker. After it, each crawled document writes one more row (6 written rows instead of 5 per document, 2,000 documents in 143 ms instead of 132 ms), and reads are unchanged.

Update from v0.4.21 without resetting. Back up D1, R2, Durable Object state and private settings first. Use Node 22.20.0, pnpm 10.12.4 and pinned rer 0.2.110. Retain native owners, permissions, support history, files, erasure fences and every applied migration identity. v0.4.22 adds two migrations, so upgrade in order from v0.4.21 to v0.4.22: a v0.4.21 installation applies exactly 324_scheduler_outbox_reads.sql, then 325_knowledge_documents_version_url.sql, once each, BEFORE the new Worker serves traffic. Earlier installations apply every missing published migration once, in filename order, BEFORE the new Worker serves traffic (a v0.4.20 installation applies exactly 324, then 325; a v0.4.19 or v0.4.18 installation applies exactly 322_contact_address_lookup.sql, 323_business_retired.sql, 324, then 325; v0.4.17 also needs 321_legacy_import_files.sql, then `node scripts/legacy-import/upgrade.mjs --project <legacy project id>` once per workspace imported from legacy, as the v0.4.18 notes describe; v0.4.16 also needs 320_legacy_import_work_repair.sql); retain each migration's buyer steps. Run `rer deploy --dry-run` against the retained installation before any separately authorized deployment. No reset, cutover or production deployment is part of this release. Live-provider qualification and owner cutover remain separate.

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

The [install and run guide](https://happytohelp.com/docs/getting-started) covers
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

For a new installation, acquire **`v0.4.22` once published**,
after installing `rer` as shown above:

```sh
git clone --branch v0.4.22 https://github.com/just-every/run-happytohelp
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
   answers visitors, and with **AI replies** whether its replies are sent
   automatically, kept as drafts for your team to send, or turned off.
   In draft, a reply your local computer agent prepares waits in its report for
   you to use and send, and a visitor who writes while your team is away gets
   your away message, as if no assistant were assigned. Such a visitor's
   conversation also appears in **Open** and **Unassigned**.

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
