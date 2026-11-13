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

## Release 0.4.24

Deploy version 0.4.24, tagged **`v0.4.24`** once published. v0.4.23 is the upgrade baseline; upgrades are qualified from v0.4.23, v0.4.22 and v0.4.21. The pinned installer remains rer 0.2.112.

- **Delta import lease lapses:** every lease-guarded batch now reports a lost workspace lease, including run initialization, replay bookkeeping and completion. A lapse stops the import; already committed progress stays journaled and replay can complete without duplicating it. Unrelated batch failures retain their original error. This fixes the slow-tier legacy-export failure that prevented v0.4.23 from being pinned by the platform.
- **First-owner legacy adoption:** Move in now uses importer v2 for new original HappyToHelp packages. The original native installation owner reviews the setup and source workspace IDs and explicitly approves the exact package fingerprint with a recent sign-in proof. Bounded preflight then creates the source ID as a separate historical workspace; the setup workspace, native accounts and Business link stay intact. Only the approving owner gains membership. Missing original-owner binding refuses adoption; an older installation cannot infer that authority from matching account details. Imported AI profiles remain disabled and system workflows stay draft. Historical source people, matching email addresses and old roles grant no sign-in, membership or assignment authority. An existing destination without this package's adoption provenance conflicts. Upload alone starts no import; Stop and Resume retain committed history.
- **Private source custody and erasure:** v2 registers source originals and scratch privately with bounded retention: upload, paused, stopped and completed-source windows are at most 24 hours, with progress bounded by seven days from first admission. Polling does not extend retention. Contact erasure or workspace deletion fences the whole package across its setup, source and destination scopes, including before start; cleanup continues without the importing session or an active workspace. Failed cleanup remains pending, closure of the same fingerprint is terminal, and erasure blocks fresh packages in that scope. Canonical history for other contacts remains. Results distinguish historical verification from current source availability; source originals confer no download entitlement.
- **Historical readers and old synthetic packages:** imported note buckets, assignment attribution and macro creator snapshots display as history; historical people stay out of native member and assignment lists. Existing v1 artifacts remain synthetic and cannot become v2 adoption by updating the Worker. Bounded old-prefix discovery and cleanup seeding register coordinates before purging source and scratch; native erasure stays pending until discovery, seeding and purge finish. The original installation owner can explicitly close a known v1 package through the protected cleanup API. Missing or unreadable inventory is pending cleanup. New native setup records a private counts-only installation baseline; an older installation keeps an unavailable baseline rather than inventing one. Installation-wide diagnostics remain restricted to the original owner.
- **Fresh hosted installs and retained delivery:** native setup and ordinary support remain active. The importer runner and adoption are inert until a legacy package is imported through the approved flow; installing these tables starts no import, sends no mail and grants no historical user access. This release retains v0.4.23's corrected mail declaration and rer 0.2.112, including native off / own / rer mail choices and explicit MAIL_PROVIDER=none/disabled taking precedence. It does not newly introduce those mail changes. Real customer remote importer use still requires separate combined ordering, restart and browser qualification plus signed migration-before-Worker delivery. Hosted live-provider qualification and importer follow-up refinements remain separate; this release does not authorize a production import or cutover.
- **Migrations:** four since v0.4.23, applied once in filename order BEFORE the new Worker serves HTTP or queue traffic: `328_legacy_workspace_adoption.sql`, `329_legacy_package_custody.sql`, `331_legacy_cleanup_seeding.sql`, then `332_legacy_cleanup_inventory_lazy.sql`. Stop the old Worker and back up D1, R2, Durable Object state and private settings first. 328 adds adoption, mapping and actor-origin tables plus a nullable note bucket column; 329 adds private custody, key-ledger and scope-fence tables/indexes; 331 adds cleanup columns, seed/inventory/baseline tables and an index, and inserts an inventory marker. These are additive schema changes. 332 is a conditional data cleanup, not additive-only: it deletes just the unstarted empty inventory marker when no package custody or import run exists, preserving existing cursors and package/run inventory. No source history, account or permission is rewritten. There is no 330 file (reserved for platform recovery); 326 is also absent. The complete inventory is 195 migration files. Upgrade order is v0.4.23 -> v0.4.24; v0.4.22 first applies 327 and v0.4.21 first applies 324 and 325, retaining their published buyer steps.

Update from v0.4.23 without resetting; v0.4.22 and v0.4.21 are also upgrade baselines. Back up D1, R2, Durable Object state and private settings, then stop the old Worker. Use Node 22.20.0, pnpm 10.12.4 and pinned rer 0.2.112. Retain native owners, permissions, support history, files, erasure fences and every applied migration identity. Apply 328_legacy_workspace_adoption.sql, 329_legacy_package_custody.sql, 331_legacy_cleanup_seeding.sql and 332_legacy_cleanup_inventory_lazy.sql once in that order BEFORE the new Worker serves HTTP or queue traffic. A v0.4.22 installation first applies 327_legacy_import_worker.sql; a v0.4.21 installation first applies 324_scheduler_outbox_reads.sql, then 325_knowledge_documents_version_url.sql, then 327, with their published buyer steps. Earlier installations first apply every other missing published migration in filename order. There is no migration 326 or 330 in this release. Run `rer deploy --dry-run` against the retained installation before any separately authorized deployment. V1 source is cleanup-only and must never be relabeled v2; missing or incomplete cleanup remains pending. No reset, mail activation, recovery adoption, production import, cutover or production deployment is part of this preparation.

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

The [install and run guide](docs/INSTALLER.md) covers
installation, local sign-in and stopping the app, step by step.
The [Run HappyToHelp page](https://happytohelp.com/run) has the quick-start command.

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

For a new installation, acquire **`v0.4.24` once published**,
after installing `rer` as shown above:

```sh
git clone --branch v0.4.24 https://github.com/just-every/run-happytohelp
cd run-happytohelp
```

Start with a local build and validation:

```sh
rer deploy --dry-run
```

This needs no provider credentials, makes no Cloudflare requests, sends no mail
and changes nothing remotely. It validates the deployment declaration and builds
the application locally. The completion report lists any inputs needed for a
real deploy; remote resources, credential validity, target secrets and remote
readiness remain unchecked.

For a real deployment, read
[deployment prerequisites](OPERATIONS.md#deploy-to-your-cloudflare-account).
When rer says **See the deploy-kit owner-account instructions**, it means
[What you need first](OPERATIONS.md#what-you-need-first): how to make the
Cloudflare API token and find the account ID. Configure the real declaration
and private account credentials, then:

```sh
rer deploy --environment production
```

The contract also requires a separately started **read-only provider preflight**
with explicit owner consent and the owner's scoped Cloudflare token. For an
existing Worker, that preflight permits only the account's Workers subdomain and
the Worker's settings and secret names (three GETs), with no mail or mutations.
That separate preflight is not yet implemented or live-qualified; the local dry
run does not perform it or prove remote readiness.

For a new installation with outbound email, also supply real `EMAIL_PROVIDER`,
`EMAIL_FROM`, `EMAIL_API_KEY` and `OWNER_EMAIL` inputs in an owned 0600 `--env-file`;
the owner email must receive sign-in mail. Existing installations retain held
secrets. The seven optional mailbox settings can stay unset. Remote provisioning
remains separately unqualified.

```sh
rer deploy --environment production --env-file ~/happytohelp-production.env
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
For a real deployment, supply `OWNER_EMAIL` privately in your environment or an
owned 0600 `--env-file`. The local dry run can list missing production inputs
without requiring them.
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
