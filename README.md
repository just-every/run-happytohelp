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

## Release 0.4.12

Deploy version 0.4.12, the latest tagged release **`v0.4.12`**, using the commands below.
No breaking change. No migrations.

- **Hono security patch:** the Worker runtime dependency Hono moves from 4.13.7 to 4.13.11, which fixes Hono's static path decoding vulnerability.
- **H5/H10/H11 app pass:** stylesheets only. Selected navigation and the open inbox row show selection with a wash or a complete hairline ring, never a border on one side of a rounded rectangle; the active rail item has an accessible aqua highlight; the in-app Setup page uses up to 1100px; small app text is raised one step.
- **AUTOMATION-002/QUEUE-002 proof:** tests and documentation only. Journeys prove time-based automations, including the seeded rule that closes solved tickets after four days, and structured queue work. QUEUE-002 reads done. AUTOMATION-002 reads partial: the last-agent-update time (`src/modules/workflows/time-rules.ts`, `src/modules/workflows/rule-model.ts`) also counts the workspace's system away reply, so an automation timed from the last agent update can act on a ticket no teammate answered.
- **Platform migration-ledger guard with rer 0.2.77:** export and leave backups now work on Platform-applied installs without re-running their database migrations. Incomplete or conflicting migration history (a `rer_migrations` ledger that is missing rows, sits beside a second ledger or does not match the migration files) is refused with exit 4 before data changes, and an empty legacy `d1_migrations` is never dropped automatically; native installs retain their usual migration path. The installer pins rer 0.2.77, including migration-ledger checks and the narrowed GitHub-reference rule; restore journeys run in their own CI shard.

Update from v0.4.11, or any earlier line, to v0.4.12 without resetting. Back up D1, R2, Durable Object state and private settings first. Install frozen dependencies with Node 22.20.0, pnpm 10.12.4 and pinned @runeditrun/rer 0.2.77. Retain private settings, owners, imported support history, permissions, files, erasure fences and migration history; never delete, reorder or edit ledger rows. Run rer deploy --dry-run against the retained installation first. v0.4.12 adds no migration, so a v0.4.11 installation's migration ledger stays unchanged and nothing is applied. An earlier installation applies its missing published migrations once, in order and by file name, through pinned rer before the updated Worker serves traffic. Held secrets inherit and the seven Google, Microsoft and IMAP mailbox settings stay optional. Escalation connections keep no provider credentials in exports; retain human Send and unconfirmed recovery. No breaking change.

**Recovery note (Platform-applied installs):** if an export made with v0.4.11 or earlier failed, it may have left an empty `d1_migrations` table beside the complete `rer_migrations` ledger. v0.4.12 refuses that state as multiple migration histories (exit 4) before any write and never drops either table. Do not delete or edit either table by hand. Recovery is a separate, verified operator procedure for that one installation, taken only after a fresh snapshot and with an explicit source scope; this release performs no cleanup. Native installs, whose history is `d1_migrations` alone, are unaffected.

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

For a new installation, acquire the latest tagged release **`v0.4.12`**,
after installing `rer` as shown above:

```sh
git clone --branch v0.4.12 https://github.com/just-every/run-happytohelp
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
