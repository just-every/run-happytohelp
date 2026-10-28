# HappyToHelp operations

## Run it on your computer

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

Dev uses its local address for the chat widget and generates a private owner
password. Wait for `RER_READY`, then open the `RER_OPEN` address to enter as the
real local owner and reach **Setup**. No private answers, email service or AI
account are needed. Use `rer dev --stop` from the checkout to stop the managed app.

The checkout pins **`@runeditrun/rer` 0.2.77** in `package.json` and
`pnpm-lock.yaml`. The launcher you run (npx or a global install) may have a different
version; inside the checkout it provisions the tools and delegates to the pinned
local package. Updating the launcher does not change the project's pin.
For scripted setup, prepare [private answers](docs/INSTALLER.md#private-setup-answers),
then run `rer setup --owner-email you@example.com --answers .seed/local-answers.json`.
Setup reruns preserve owner, data and private settings; conflicting saved email
or origin is refused. See [contributor setup](README.md#contributor-setup) for
working directly with pnpm.

### Find your way around

The inbox, knowledge, customer context and workspace settings use the same native
actor/project authority. Setup, the first page under Settings, runs its own checks and records
observed provider and widget behavior; saved defaults do not pass it. Every new
workspace starts with a starter assistant, a reply-by-email mailbox (when
`INBOUND_EMAIL_TOKEN` exists) and the installation sender. Workspace creation starts
with the widget snippet, and Advanced holds secrets/verification examples.

See [Local command reference](RUN-LOCALLY.md) for loopback ports, production
preview, explicit stop and idle shutdown. An occupied explicit port refuses;
rer never chooses another silently. Saved remote mail is preserved: use a
separate checkout for a local development trial.

For a visitor-to-inbox-to-reply check, follow
[Try the customer widget locally](docs/INSTALLER.md#try-the-customer-widget-locally).
The external customer page needs its own exact **Widget website origin** under
**Settings → Widget → Settings**. The HappyToHelp app origin always remains
allowed; saving an external website origin does not change the app or script address.

## Local data and backups

Canonical D1/R2/KV/DO state is `.wrangler/state`. Private generated settings are
`.dev.vars` and its declared recovery copy `.dev.vars.previous` (0600);
installer drafts/logs are `.seed/installer` and CLI bookkeeping is `.rer/local`.
Secret directories are 0700. Never commit these, answers or private archives.
Ambiguous prior state, symlinks and unsafe placement require explicit recovery;
rer never silently moves or removes it.

Stop dev before export, import or reset:

```sh
rer export --output exports/support.rer
rer reset --yes
rer import --input exports/support.rer --yes
rer setup --owner-email you@example.com --answers .seed/local-answers.json
```

Export creates a new owner-only archive with integrity and explicit exclusions.
It includes supported domain rows, native identities/password hashes and FILES
objects. Sessions, one-use links, private configuration,
provider/integration credentials, outbound execution queues and local-computer
pairing/grants/jobs are excluded. Signed visitor verification is reconfigured.
Archives contain sensitive data and must be protected as backups.

Two-factor factors, roles and the security log travel with the archive: passkeys
as public keys, recovery codes as hashes, and authenticator-app keys encrypted
under `INTEGRATION_ENCRYPTION_KEY`. Restore with the same key and authenticator
apps keep working; with a different key, sign in with a passkey or recovery code
(or use [owner recovery](docs/account-security.md#owner-recovery)) and set the app
up again. Sessions and their step-up proofs are not exported.

Import validates integrity and resource coverage before atomic restore into an
empty destination. It preserves native owners; setup does not claim a new owner
over them. Re-enter private configuration and external integration credentials.
Restore sends no mail, model request or connection notification. Remote transfer
is unsupported and refuses with exit 4.

Import also reads the data download of a Managed installation (a `.zip`)
directly. Keep it private first, then restore it the same way:

```sh
chmod 600 exports/managed-data.zip
rer import --input exports/managed-data.zip --yes
```

Its database is checked in a private sandbox, and every table must be one this
release knows; conversation search is rebuilt after restore. A damaged or
cut-off download, a table this release cannot place, or a destination that
already holds data is refused before anything changes.

Archives carry Durable Object storage too. Export reads every stored record of
every `ConversationSocket` instance into the archived `durable_object_snapshots`
table with its schema (`happytohelp.durable-objects/1`) and a SHA-256 digest, and
the receipt names them. This release's socket keeps no records (messages live in
D1), so the snapshot proves an empty store. Import checks the schema and digest
before anything is restored and refuses records it cannot put back, rather than
dropping them. Exporting a restored copy reproduces the original content hash.
Full Base-data equivalence (resizable ArrayBuffer preservation) remains held.

Reset prints its inventory and requires explicit confirmation. It removes only
local state, owners/sessions, `.rer/local`, `.seed/installer` and declared
private settings/recovery copies. Source, dependencies, lockfiles, manifest,
export archives and `.rer/deploy` receipts survive. Active operations refuse.
A second reset succeeds with an empty inventory, and subsequent setup creates
an empty installation. Keep answers outside `.seed/installer` if needed after reset.

### Hosted D1 and R2 backups

Use this checkout's supported SQL export helper:

```sh
node scripts/export-d1.mjs --database <prefix>-db --config wrangler.jsonc --remote --output private-backup.sql
```

Arrange a maintenance window before starting: stop application traffic,
scheduled jobs, queue consumers and other writers until the helper has finished
rebuilding search and you have copied R2 objects with their metadata. There is
no built-in hosted pause switch, and the helper cannot stop remote writers.
It temporarily drops the derived conversation search table to satisfy D1's
virtual-table export restriction; message rows and triggers remain in place.
Plain `wrangler d1 export` is unsuitable for this database. Keep the SQL,
configuration and encryption key private.

[Back up your data](docs/INDEPENDENT-RELEASE.md#back-up-your-data) gives the
complete procedure, interruption recovery and restore checks. For a local SQL
backup, stop dev/preview and use `--local`; `rer export` above remains the local
portable archive command.

## Portable archive from a hosted installation

`rer export --target remote --output exports/hosted-support.rer` produces the same
versioned D1/R2 archive that local `rer import` validates. First stop the source
application, queue and cron writers. Set `H2H_EXPORT_WRITERS_STOPPED=yes` only
once they are stopped; the exporter cannot stop them for you. Supply the owning
account's `CLOUDFLARE_API_TOKEN` privately. Select the actual deployed resources
with `H2H_EXPORT_CONFIG`, an owned regular 0600 JSON/JSONC file containing
`account_id`, the `d1_databases` entry bound as `DB` (including `database_id`)
and the `r2_buckets` entry bound as `FILES` (including `bucket_name`). Resource
identities must come from that installation, never from this checkout's local
placeholder configuration. No application vars or secrets are loaded from it.

D1 queries and R2 reads use Cloudflare's API directly. The exporter temporarily
spools one object at a time in its private output directory, then removes it.

The command refuses missing or incompatible migration history, existing outputs,
changed attachment inventory and changed erasure fences. It checks the complete
archive before publishing a new 0600 file. Base writes and removes transfer
bookkeeping and snapshot copies in the source D1 database; it does not change
product rows, send mail, run jobs or write R2 objects. Restore remains a separate
explicit command into a clean local installation and keeps actions inactive.
Current ConversationSocket business state is reconstructible from D1; live
sockets, presence and alarms are excluded. Nonempty unsupported Durable Object
snapshots refuse. Keep the archive private and re-enter excluded credentials
and connector authority on the receiving installation. Local remote-binding
fixtures establish the command boundary, not a live hosted-provider receipt.

## Deploy to your Cloudflare account

Use the real `deploy.json` declaration with Base deploy-kit. The command derives
resource names and the application origin from the project/environment and the
owner's account. Configure private `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` in the process environment; never pass or print token
values. The token needs the declared Workers, D1, R2 and Queues capabilities.
Enable R2 before provisioning. Commit source before a real deployment.

### What you need first

These are the deploy-kit owner-account instructions that rer's deploy message
points to.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open the
   account you will deploy to, then **Manage Account → Account API Tokens →
   Create Token → Create Custom Token**.
2. Add the four account permissions below, keep **Account Resources** on that
   one account, create the token and copy it.
3. Copy the **Account ID** (see [Find your account ID](#find-your-account-id)).
4. Put both in a private file only you can read, and pass it to rer:

   ```sh
   umask 077
   cat > ~/happytohelp-deploy.env <<'EOF_ENV'
   CLOUDFLARE_ACCOUNT_ID=paste-the-account-id
   CLOUDFLARE_API_TOKEN=paste-the-token
   EOF_ENV
   rer deploy --environment production --env-file ~/happytohelp-deploy.env
   ```

   The same file holds the mail and owner values described below.

Use an account-owned API token pinned to the intended account, with account
permissions **Workers Scripts: Edit**, **D1: Edit**, **Workers R2 Storage: Edit**
and **Queues: Edit**. This declaration does not need KV or zone permissions.
An account-owned token does not need or support **User Details** or
**Memberships** for this flow. Keep the token in private environment input.
The account also needs an enabled R2 service and a workers.dev subdomain.

### Find your account ID

Copy the intended account ID from the Cloudflare dashboard and explicitly set
`CLOUDFLARE_ACCOUNT_ID` in the same private environment as
`CLOUDFLARE_API_TOKEN`. Rer uses this pinned account directly: no user discovery
or `wrangler whoami` is required. Check that the dashboard account, token scope
and supplied ID agree before deploying.

For a **user-owned** token only, optional user/account discovery with
`pnpm exec wrangler whoami` may require User Details and Memberships read
permissions. That discovery is a convenience for choosing an account; it is
not a prerequisite for an account-owned token or a reason to broaden its scope.

The declaration names DB, FILES, CONVERSATIONS, JOBS, its dead-letter queue and
scheduled recovery. Declared secret bindings include `OWNER_EMAIL`,
`H2H_SETUP_TOKEN`, `INTEGRATION_ENCRYPTION_KEY`, `INBOUND_EMAIL_TOKEN`,
`EMAIL_PROVIDER`, `EMAIL_FROM` and `EMAIL_API_KEY`. Before a deployment dry run
or real deployment, supply the mail provider (`resend`, `sendgrid` or `cloudflare`),
verified sender address and sending token in private environment variables or an
owned 0600 `--env-file`. Provider and
sender are stored as secret bindings too, so the deployment declaration contains
no account-specific values. Rer supplies the owner email (`OWNER_EMAIL`) from real local setup, or from the environment
when you set it. Deploy refuses the local placeholder `owner@run-happytohelp.test`
and other reserved trial domains because they cannot receive sign-in mail. Supply
a real mailbox privately in `OWNER_EMAIL` or an owned 0600 `--env-file` for both
dry run and deployment. Rer generates missing setup/encryption secrets. It also deploys
the generated `INBOUND_EMAIL_TOKEN` for reply-mailbox authentication. Existing
Worker secrets are retained; use `rer deploy --set-secret NAME` to change one
deliberately. Rer keeps the values it generates (`INBOUND_EMAIL_TOKEN`,
`INTEGRATION_ENCRYPTION_KEY`, `H2H_OWNER_RECOVERY_KEY`) in the private 0600 file
`.rer/deploy/<environment>.secrets.env` beside `.rer/deploy/<environment>.json`.
Back up both with the installation; to deploy from another checkout, copy both
there. Without the secrets file, a redeploy still keeps every secret the live
Worker already holds and sends only ones it lacks.

The declaration maps native `EMAIL_PROVIDER`, `EMAIL_FROM` and `EMAIL_API_KEY`
inputs to rer's shared `MAIL_PROVIDER`, `MAIL_FROM` and `MAIL_PROVIDER_API_KEY`
preflight bindings as well as HappyToHelp's native bindings. The deploy adapter
resolves the setup choice `MAIL_PROVIDER=direct` to the selected native provider
before preflight. Cloudflare also uses `EMAIL_ACCOUNT_ID`; the adapter supplies
its native token to the shared `MAIL_API_KEY` binding. Managed deployments use
their assigned `MAIL_*` inputs, independently of native credentials. Real
deployment requires the selected transport's mail inputs. NATIVE-001 requires a **zero-outbound dry-run** that explicitly
reports no outbound requests and needs no provider credentials. A separate,
explicitly started **read-only provider preflight** requires owner consent and
the owner's scoped Cloudflare token. Its own acceptance permits only three GETs
for an existing Worker: the account's Workers subdomain and the Worker's settings
and secret names, with no mail or mutations. Neither step is a mock of the other.

The candidate implements the zero-outbound dry-run: it validates and builds without
provider credentials, sends no mail and changes no resources. Its report leaves
remote resources, credential validity and existing secret bindings unchecked.
The separately started owner-consented preflight and remote provisioning still
need implementation or qualification, respectively.

Cloudflare Email Sending additionally needs `EMAIL_ACCOUNT_ID`. Add
`{"binding":"EMAIL_ACCOUNT_ID","environment":"EMAIL_ACCOUNT_ID"}` to the
declaration's `secrets` array, plus
`{"binding":"MAIL_ACCOUNT_ID","environment":"EMAIL_ACCOUNT_ID"}`, and supply that account ID privately before deploying
with Cloudflare mail. It is not required for Resend or SendGrid; rer 0.2.77 requires
every declared secret not marked `optional` on a new Worker.

Preserve existing keys and owner data. Configure other optional mail/model inputs
through the supported runtime declaration and native workspace settings. Local
development needs no mail account: its development transport suppresses email
without storing it or sending externally. Deployment requires a real sender.

```sh
rer deploy --dry-run
rer deploy --environment production
```

Default environment is production. Dry run validates the declaration and real
build locally without provider requests or credentials. Real deploy
builds, provisions, applies migrations, publishes and checks health in the owner
account. It is an external change requiring owner authorization. Release produces
source/artifacts with its existing `--repo` and `--output` arguments and never
pushes or deploys.
Inspect `rer describe` and per-command `--help` for other flags.

### If setup fails at the R2 step

Enable R2 in the account, confirm permissions and inspect the deploy-kit failure
before resuming. Preserve existing resources and uncertain provider outcomes;
never automatically replay ambiguous work or switch resource targets to hide it.

### Claim your new installation

There is nothing to claim by hand. After a healthy deploy, `rer deploy` claims the
owner named by `OWNER_EMAIL` on the hosted app with the one-time `H2H_SETUP_TOKEN`
and then removes the token. It prints the address and a line such as
*Claimed the hosted owner (the OWNER_EMAIL already set on the Worker)*. Open that
address and **sign in by email** as the owner: the sign-in message goes through your
configured mail sender, so the mail variables above must be right before you deploy.
Sign-in opens **Setup**. The owner's name is derived from that actual email, and a
`workers.dev` website defaults to **My workspace** regardless of the owner email.
An explicitly chosen native workspace name takes precedence. You can set the
business website and name in Project settings. Running `rer deploy` again preserves the existing owner and workspace.

`rer signin --environment production` directs you to this deployment's `/login`
page and exits 4 because HappyToHelp uses native accounts. It does not issue or
print a sign-in link. On that page choose **Email me a sign-in link**, then open
the message in the owner's mailbox. A password set in the native app also works.

If sign-in mail fails after the owner was claimed, repair the sender using the
same Cloudflare credentials and checkout that deployed it. Supply the correct
private `EMAIL_PROVIDER`, `EMAIL_FROM` and `EMAIL_API_KEY` values in an owned
0600 environment file, then run each needed update separately:

```sh
rer deploy --environment production --env-file private-mail.env --set-secret EMAIL_PROVIDER
rer deploy --environment production --env-file private-mail.env --set-secret EMAIL_FROM
rer deploy --environment production --env-file private-mail.env --set-secret EMAIL_API_KEY
```

Return to `/login` and request a new email link for the original owner. Changing
`OWNER_EMAIL` after claiming does not rename the native account. If the claimed
email was mistyped, an account owner with D1 edit access can first back up the
installation, then correct that user's `users.email` in the deployment's recorded
D1 database using Cloudflare's D1 console. Select the user by their existing email
and verify their `memberships.role` is `owner` before changing exactly that row;
preserve the user id, memberships and all other data. Then request a fresh link
to the corrected mailbox. This is account-admin recovery, not a public setup bypass.

The native `/setup` form with the private setup token is **recovery only**: use it
if the deploy could not claim the owner (for example the claim step was interrupted
before it removed the token). Keep the token out of URLs, logs and recordings. Claim
closes permanently and never bypasses tenant authority. See
[First-run setup](docs/SETUP-WORKFLOW.md).

### Remove a deployment

`rer deploy --environment NAME --remove --yes` removes the Worker, D1 database,
R2 bucket and queues that this environment's deploy record says rer created.
It removes uploaded attachments and other objects in the owned bucket, detaches
owned queue consumers and deletes the resources in one pass, then reads back that
each is gone. It touches nothing else. Run it again and it finds nothing to do.
Export what you need first: removal deletes the installation's data.

### What `/health` does and does not tell you

Health means the native Worker can reach D1 and R2. It does not qualify queues,
sockets, email delivery, provider access, custom domains, compliance or product
acceptance. Confirm those through their public flows on the intended installation.

### Finish a disposable hosted proof

Before provisioning, save a complete account inventory and a private owned
resource list for the authorized disposable run. Record the exact planned
Worker name, DB database name/ID, FILES bucket name, JOBS queue name/ID,
JOBS_DEAD_LETTER queue name/ID, and the derived CONVERSATIONS Durable Object
namespace name/ID for class `ConversationSocket` after upload. Get identities
from the deployment receipt and provider readback, rather than guessing names
from a prefix. Refuse collisions with pre-existing resources. Record the
Worker's schedules and queue consumers too. Retain this inventory and all
observations outside product source; never include tokens or customer content
in public evidence.

After observations are complete, stop the journey and any other producers.
Run the normal removal command for the disposable environment:

```sh
rer deploy --environment NAME --remove --yes
```

The command removes the recorded resources, including uploaded attachments.
Compare complete post-removal Worker, D1, R2, Queue and Durable Object namespace
inventories with the saved inventory. Confirm the owned names and IDs are absent,
including the derived namespace, and account for unrelated resources without
changing them. Keep removal output and readback outside product source. Incomplete
inventories are not teardown proof. Removal is destructive and applies only to
the explicitly authorized disposable installation; it is not an upgrade procedure.

## Optional features and their settings

Runtime allowlists live in `scripts/deployment/environment.mjs`; native secrets
remain private. Local settings changes need an explicit restart. For online
changes update the real declaration and private inputs, then use rer deploy.
Do not rotate encryption keys without migrating encrypted stored connections.

### Which settings matter for a small team

Most single-team installations only need a few rows of the table below:

- **AI replies:** one provider key, then an assistant chosen in the dashboard
  (see [Set up AI replies](README.md#set-up-ai-replies)).
- **Email, sending and receiving:** for invitations, password recovery and email
  conversations.
- **Customer widget:** set in the dashboard; nothing to configure here.

The rest are for specific needs. In the table, *Ensemble* is the AI library
HappyToHelp uses for replies; *training and evaluation* runs appear in the
dashboard as **Evaluation runs**; and *lead research* drafts outreach emails for
platform administrators (see [the integrations guide](src/modules/integrations/README.md#lead-outreach)).
*Project* is the name the configuration and API use for a workspace.

| Feature | Variables and other configuration | Secrets |
| --- | --- | --- |
| Owner access and sign-up | `APP_ORIGIN` (deployment derives it), `REGISTRATION_ENABLED`, optional `H2H_SETUP_OWNER_EMAIL` | `H2H_SETUP_TOKEN` (used once by `rer deploy` to claim the owner; `/setup` recovery only); optional `TURNSTILE_SECRET` |
| AI replies, assist, profiles and monitoring (Ensemble) | The installer's `AI_PROVIDER` answer (`openai`, `anthropic`, `google`, `deepseek`, `xai`, `openrouter` or `later`, the default) chooses which key to store at setup; models are selected in workspace and AI configuration (the dashboard's **AI** page); `CONTEXT_MODEL` for widget-triggered context work. Every new workspace's starter assistant answers visitors by itself once any provider key is installed, within `AI_DAILY_CEILINGS`; with none, new conversations stay with the team | Selected `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`/`GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `XAI_API_KEY`, `OPENROUTER_API_KEY`; the key is optional at setup and never stored with `later` |
| Knowledge crawl and semantic search | `APIFY_CRAWLER_ACTOR_ID` (`apify~website-content-crawler`), `QDRANT_URL`, `KNOWLEDGE_EMBEDDING_MODEL` | `APIFY_TOKEN`, `QDRANT_API_KEY`, `OPENAI_API_KEY`. Website sources need none of these: without the two Apify values HappyToHelp reads up to 40 pages of a public site itself ([Website knowledge](docs/website-knowledge.md)). Keyword search needs none of these providers. |
| Help center import from another provider (Intercom, Freshdesk or Zendesk) | Platform/subdomain and destination workspace chosen for each import | `INTERCOM_TOKEN`, `FRESHDESK_TOKEN`, `ZENDESK_TOKEN`/`ZENDESK_EMAIL` for the selected provider |
| Email, sending and receiving | `EMAIL_PROVIDER` (`resend`, `cloudflare` or `sendgrid`), `EMAIL_ACCOUNT_ID` for Cloudflare, optional `INBOUND_EMAIL_DOMAIN` (the domain new workspaces' reply mailboxes are created under; default `in.` plus the workspace's website host), workspace email settings; built-in inbound endpoints | `EMAIL_API_KEY`, `EMAIL_FROM` (the installation sender every new workspace uses until its own domain is verified), `INBOUND_EMAIL_TOKEN` (generated by local setup and deployed for inbound authentication; with it every new workspace gets a reply-by-email mailbox; provider domain routing and a webhook still need configuration) |
| Lead research and reviewed outreach | `LEAD_MODEL`; each lead is saved and reviewed before sending | `OPENAI_API_KEY`, selected email configuration |
| GitHub | `GITHUB_CLIENT_ID`, optionally `GITHUB_PROJECT_ID` for one fixed credential | `GITHUB_CLIENT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`; optional `GITHUB_TOKEN` or JSON `GITHUB_TOKENS` map keyed by project ID |
| Brand image generation | Explicit `BRAND_IMAGE_MODEL`, `BRAND_IMAGE_SIZE`, `BRAND_IMAGE_QUALITY` | `OPENAI_API_KEY` |
| Signed-in website preview | `PREVIEW_ORIGIN` (separate custom domain); an owner or admin creates a scoped grant for a workspace | None; preview grants enforce scope, expiry and request limits |
| Customer widget | The workspace's widget key and exact allowed origin; installed on the website the owner chooses | None; never expose an operator token |
| Public request limits and daily AI ceilings | Optional JSON `RATE_LIMITS` and `AI_DAILY_CEILINGS` overriding any subset of the defaults (see [Limit public traffic and AI spending](#limit-public-traffic-and-ai-spending)) | None |
| Training and evaluation | Explicit model and budget per run; `TRAINING_PRICE_CEILINGS` bounds raw provider usage; local-only `ENABLE_SYNTHETIC_EVALUATION=true` to admit synthetic test cases | The selected model provider's credential |

### Sign-up and password recovery

Self-service sign-up (`/register`) and password recovery need the email
settings. Without them, `/register` shows that sign-up is closed, and
`/forgot-password` tells the visitor that the workspace owner must reset the
password. An owner with two-factor sign-in on can issue a teammate a one-hour
reset link with `POST /api/identity/password-reset` (`{"userId":…}`); it needs the
owner's own second factor within 15 minutes and is recorded in the security log.

`REGISTRATION_ENABLED=true` turns on self-service sign-up at `/register`, where
anyone can create an account and their own workspaces on your installation. It
is off unless you set it, and it also needs email and `APP_ORIGIN`. An
installation for your own team doesn't need it: invite teammates from
**Settings → Agents** instead. If you do turn it on, read the warning in
[Cap daily AI work](#cap-daily-ai-work) first.

### Notes on individual features

**Email.** Email setup, including the Cloudflare Email Sending prerequisites and SendGrid
Inbound Parse, is covered in [the integrations guide](src/modules/integrations/README.md).
Configure inbound email webhooks with the actual deployed URLs and the matching
`INBOUND_EMAIL_TOKEN`. The generated token authenticates inbound requests; it
cannot configure your provider's domain, mail forwarding or webhook. A provisioned
reply mailbox starts receiving only after you configure that routing.

A customer who types an email in the widget can receive operator replies there,
even while online and without a signed identity. Outbound sending needs a configured
sender, not an inbound token or reply mailbox. **Unverified** means the customer's
identity has not been signed by your server; it does not block replies to their
entered email address. For each reply, **Sent to email provider** means the provider
accepted the send; it does not confirm delivery to the customer's inbox. A provider
failure or unknown outcome remains visible and is not automatically replayed.
The local development transport reports `development`: it suppresses visitor and
teammate email, stores no messages and sends no external email.

**Import an existing help center.** Open Knowledge → Import. The form chooses the
provider and subdomain; the credentials come from the server secrets in the
table above.

**Website preview.** Preview must use a hostname separate from the application's origin. Never run
untrusted proxied pages under the origin where owners sign in.

**GitHub and stored connections.** `INTEGRATION_ENCRYPTION_KEY` is private installation configuration. Rer setup generates it; deployment reads it privately. Do not rotate it without migrating the encrypted stored connections. Configure
GitHub OAuth redirects with the actual deployed URLs.

**Work on a local computer.** Handing support work to a local computer additionally needs the local agent
(packaged separately from the Worker), a fresh device pairing and an explicit
delegated grant (see [the local agent guide](local-agent/README.md)). It never
runs as a Worker subprocess.

## Limit public traffic and AI spending

The widget key and allowed origin are public, and a client outside a browser can
send any `Origin`. So HappyToHelp limits visitor, registration and
workspace-creation requests with counters stored in D1 (the `abuse_counters`
table). You do not need a Cloudflare rate-limit binding. Full tables are in
[Limits and AI ceilings](docs/PUBLIC-LIMITS.md). In the setting names below,
`Project` means a workspace.

### What happens when a limit is reached

A refused request gets HTTP 429 with a `Retry-After` header and this body:

```
{"error": "<visitor-readable message>", "code": "rate_limited", "limit": "<name>", "retryAfter": <seconds>}
```

The widget shows the message and never resends the refused message on its own.
Signed-in workspace members are not limited on conversation, message or upload
routes.

### Change the request limits

`RATE_LIMITS` is a JSON object that overrides any subset of these defaults. Each
value must be a positive integer.

| Limit | Default |
| --- | --- |
| `widgetSessionsPerIpHour` | 30 |
| `widgetSessionsPerProjectHour` | 5000 |
| `conversationsPerContactHour` | 10 |
| `conversationsPerIpHour` | 30 |
| `conversationsPerProjectHour` | 5000 |
| `messagesPerConversationMinute` | 15 |
| `messagesPerContactHour` | 120 |
| `widgetEventsPerContactMinute` | 120 |
| `uploadsPerContactDay` | 30 |
| `uploadBytesPerContactDay` | 100000000 |
| `uploadsPerProjectDay` | 5000 |
| `uploadBytesPerProjectDay` | 5000000000 |
| `registrationsPerIpDay` | 5 |
| `projectsPerIpDay` | 10 |
| `projectsPerAccountDay` | 10 |

Visitors behind one shared address (an office network or a mobile carrier) share
the per-address session and conversation limits. For audiences like that, raise
`widgetSessionsPerIpHour` and `conversationsPerIpHour`.

The `…PerProject…` ceilings cap what many changing client addresses can create
in one workspace: widget sessions (and the visitor contacts they create), new
conversations, and attachment count and bytes. The widget opens a session and a
conversation for each new visitor, so the hourly ceilings are the number of new
visitors a workspace can take per UTC hour; raise them if your site gets more.
Past a per-workspace ceiling, new visitors in that workspace see "This chat is
very busy right now" (or that attachments are unavailable) until the window
resets. Returning visitors keep their sessions and conversations, and other
workspaces are unaffected.

### Cap daily AI work

`AI_DAILY_CEILINGS` caps the automatic AI work that visitors can cause, per UTC
day. Values must be positive numbers; `spendUsdPerProject` may be fractional.

| Ceiling | Default | What it caps |
| --- | --- | --- |
| `repliesPerProject` | 200 | Automatic replies in one workspace |
| `spendUsdPerProject` | 10 | Estimated AI spend in one workspace, in US dollars |
| `repliesPerInstallation` | 2000 | Automatic replies across all workspaces in the installation |
| `contextRunsPerProject` | 500 | Context runs in one workspace |

Past a ceiling:

- Visitor messages are still saved and delivered to operators, but no automatic
  reply is generated until 00:00 UTC. The transcript shows
  **Automatic AI reply skipped**, and the skipped reply is never replayed.
- A visitor who explicitly asks the widget for a reply gets HTTP 429, with
  `Retry-After` set to the seconds until 00:00 UTC and a generic "assistant is
  not available" message. Only operators see which ceiling was reached and the
  workspace's spend.

The spend figure is an estimate based on the cost the provider reports for
completed rounds, so replies already in progress can overshoot it. Set spending
limits with your AI provider too. Workspace members can read the day's usage,
ceilings and reset time with
`GET /api/dashboard/projects/:projectId/ai-usage`.

Invalid values are rejected at deployment and make requests fail visibly at
runtime; they never silently remove a limit.

> [!WARNING]
> **Before you set `REGISTRATION_ENABLED=true`:** every self-registered
> workspace uses the installation's provider keys, so total automatic AI spend
> can reach the per-workspace ceiling times the number of workspaces. Only
> `repliesPerInstallation` caps the total. `registrationsPerIpDay`,
> `projectsPerIpDay` and `projectsPerAccountDay` only slow new sign-ups; they do
> not stop a sign-up campaign spread across many addresses. Before enabling
> registration, set `TURNSTILE_SECRET`, set `repliesPerInstallation` to a daily
> amount you are willing to pay, and set spending limits with your providers.

## Contact erasure

Use this when a customer asks you to remove their personal data. In
HappyToHelp, a *contact* is the record of a customer who has talked to you.
Owners and admins can erase a contact's personal data; operators cannot.

**From the dashboard:** open Contacts, select the contact, choose
**Erase personal data…** and type `ERASE` to confirm.

**From the API:**
`POST /api/management/projects/:projectId/contacts/:contactId/erase`

Erasure removes:

- the contact's name, email, identifier and metadata;
- its widget sessions;
- the content of messages in its conversations;
- attachments and their R2 objects;
- customer context and internal notes;
- AI and delegated-work text;
- imported bucket summaries;
- its address in the email delivery log;
- inbound email evidence (only the classifier's reasons remain);
- legacy import copies.

Conversations and message rows (ID, author role, revision, time) remain with
their content removed. A `contact_erasures` record, which does not identify the
contact, notes who erased it, when, and how much was removed. Running an
erasure again is safe and finishes one that was interrupted.

Keep in mind:

- The contact **Delete** button only hides and blocks a contact; it does not
  erase anything.
- Erase contacts **before** deleting a workspace. Deleting a workspace removes
  every membership, after which nobody can erase through the product.
- Erasure cannot reach data already sent to AI, email, GitHub or embedding
  providers or to paired computers, or D1 Time Travel backups (up to 30 days).

See [Personal data](docs/PRIVACY.md) for the full list of what is stored, sent
and erased.

## How automatic email is handled

Email that a machine generated is added to the conversation transcript but is
never answered automatically. This covers:

- out-of-office and other autoresponder replies;
- bounces and delivery reports;
- mailing-list mail;
- senders such as `no-reply` or `mailer-daemon`;
- subjects that start with an autoresponder prefix.

Such a message is labelled **automatic** in the dashboard. It requests no AI
reply and sends no operator or contact notification, both when it first arrives
and when the scheduler replays pending work. The classification is recorded
before the message is added and survives recovery and redelivery. Its reasons
appear in the message's `origin`, and owners and admins can read the stored
evidence with `GET /api/management/projects/:projectId/inbound-emails/:messageId`
(see [Inbound email recovery](docs/INBOUND-EMAIL-RECOVERY.md)).

- **Mail with no envelope sender is added as automatic**, under its `From`
  header. Customer identity always comes from the `From` header (verified by
  DKIM, DMARC or aligned SPF, otherwise labelled **unverified sender**; a
  possible forgery of a widget-verified customer, or mail the provider reported
  as failing, or with no usable From, gets its own **Unverified sender**
  conversation; an address only typed into the widget receives only answers sent
  through its notification's reply address), never
  from the envelope, so forwarding and bounce-address rewrites do not create
  contacts. See [Receive email](src/modules/integrations/README.md#receive-email).
- **If you use your own email gateway**, have it forward the optional
  `envelopeFrom`, `subject` and `headers` (an object) fields when it posts to
  `POST /api/integrations/email/inbound`. Without them, automatic mail arriving
  through the gateway may be treated as customer mail.
- **Outgoing notifications** sent through Resend or SendGrid carry
  `Auto-Submitted` (`auto-replied` for AI replies, `auto-generated` otherwise)
  and `X-Auto-Response-Suppress: All`, so other systems do not auto-reply to
  them. Cloudflare Email Sending does not carry these headers yet, because its
  allowed custom headers have not been verified.

This behavior is checked with local D1, provider fixtures and a locally built
Worker. No live mail loop has been exercised. The full rules are in
[Email and integrations](src/modules/integrations/README.md#out-of-office-replies-bounces-and-other-automatic-mail).

## Stop work on a paired computer

You can hand a conversation to the local agent on a paired computer. That work
runs only in the local agent on that computer, which is packaged separately and
never runs inside the Worker.

In short: revoking a computer (or the permission it works under, called a
*grant*) stops HappyToHelp from accepting more from it straight away, and you can
delegate the conversation again at once. But HappyToHelp can't see whether a run
already going on that computer actually stopped, so check the computer yourself.

The details, for reference:

- **What revoking affects.** Revoking a device also revokes the other devices
  under the same grant, and revoking a grant revokes every device it backs.
  Queued work is cancelled. Started work becomes `revoked`, with
  `delivery_state` `authority_revoked`, or `membership_lost` when a heartbeat
  finds that the operator has left the workspace. Work on other devices,
  including devices revoked earlier, is not touched, and the conversation can be
  delegated again straight away.
- **What you see.** The dashboard shows such work as
  **Authority revoked · local outcome unconfirmed**, or
  **Workspace access ended · local outcome unconfirmed** after membership loss.
  Check the paired computer yourself; only the device can report that it
  cancelled the work.
- **If the local agent reconnects.** A local agent that reconnects with the
  claim ID of a job that has since finished or been revoked gets no assignment
  (`data: null`), then claims fresh work under a new claim ID.
- **Follow-up effects after authority is lost.** If authority is lost before a
  completed report's follow-up effects (an internal note or a legacy reply) have
  run, the effect is `blocked` and the job records `delivery_state`
  `authorization_lost`; the report stays completed and is never reopened. A reply
  that fails delivery gets a `needs_review` receipt and `delivery_state`
  `review`, and the report is reopened for input only when no replacement
  delegation holds the conversation.
- **Retries.** The once-a-minute schedule retries each pending result effect on
  its own. A failing one is logged
  (`Local result effect recovery failed for job …`), stays pending for the next
  run, and does not stop the scheduled recoveries after it.
- **Imported delegations.** An import from the original HappyToHelp application
  (see [Import data from the original HappyToHelp service](#import-data-from-the-original-happytohelp-service))
  brings started delegations in as `revoked` with `delivery_state`
  `authority_revoked`, completed at the export time unless the export records a
  completion time, and queued ones as `cancelled` and `held`.

See [the local agent guide](local-agent/README.md) for pairing and revoking a
computer.


## Upgrade an existing installation

Back up the selected database, private FILES objects and configuration before
upgrading. Keep applied migration names and bytes immutable. Read RELEASE.json
for the revision's additive migration order and buyer recovery obligations.
Update source while preserving owner customizations and private settings, then
use the rer setup/build path locally or authorized rer deploy remotely before
serving updated code. Never reset as an upgrade mechanism.

Test restoration in separate resources before switching traffic. Retain private
Move in originals and journals, erasure fences, rating cycles/history, unknown
provenance, encrypted credentials/keys and uncertain delivery state together.
Imports and replay must not restore erased identities or send external work.
See [Updates and recovery](docs/INDEPENDENT-RELEASE.md).

### Upgrading from 0.3.x

0.3 ran on Node.js 26.8.1 or newer through `node scripts/install.mjs`,
`pnpm run setup -- --local` and Vite on port 5173. 0.4 runs on Node.js
**22.20.0** through `rer`; `pnpm run setup` and `pnpm run dev`
now call rer. Owners, passwords, members, pending invitations, workspaces,
appearance, contacts, conversations, attachments, articles and categories carry
over unchanged.

On your computer:

1. Stop the app with Ctrl+C in the installer or `pnpm run dev -- --foreground` terminal.
2. Back up local state and private settings outside the checkout:

   ```sh
   cp -a .wrangler/state ../happytohelp-0.3-state
   cp -p .dev.vars ../happytohelp-0.3.dev.vars
   ```

   Skip the second line if you have no `.dev.vars`. Keep both copies private.
3. Update to current public main and keep your own commits, for example
   `git fetch origin main && git merge origin/main`. Resolve conflicts only in files
   you changed.
4. Switch to Node.js 22.20.0 and run `pnpm install --frozen-lockfile`.
5. If `.dev.vars` sets `EMAIL_PROVIDER` to a real provider, setup refuses to
   replace it. Local development suppresses email without storage or sending.
   Move the `EMAIL_*` lines into your private backup and
   configure provider mail on your deployed installation instead.
6. Create `.seed/local-answers.json` as in
   [private setup answers](docs/INSTALLER.md#private-setup-answers), with your
   existing workspace name, widget website origin, colour, owner name and owner
   password. Then run setup with your existing owner email:

   ```sh
   rer setup --owner-email you@example.com --answers .seed/local-answers.json
   rer dev --foreground
   ```

   Setup applies `0110_move_in.sql` to `119_local_portability.sql` to the local
   database, reports **Existing owner and workspace preserved**, and adds this
   release's local settings after the lines already in `.dev.vars`, which stay
   unchanged. A different owner email is refused.
7. Open the address dev prints, normally `http://127.0.0.1:8787` rather than port
   5173. Open `RER_OPEN` for automatic local owner entry; your existing native
   password remains valid. Sessions from the old address do not carry over.
   Pending invitation and password-reset links point at the old address; use **Copy link** on a pending invitation to
   issue a fresh one.

On Cloudflare, back up the D1 database, every R2 object with its metadata and
your Worker secrets, including `INTEGRATION_ENCRYPTION_KEY`, as in
[Back up your data](docs/INDEPENDENT-RELEASE.md#back-up-your-data). Then run
`rer deploy --dry-run` and
`rer deploy --environment production`, which applies the
migrations before publishing. This release's upgrade evidence covers local
installations; a hosted upgrade is not part of it.

To go back, stop 0.4, check out your 0.3 commit and restore both copies:
replace `.wrangler/state` with `../happytohelp-0.3-state` and `.dev.vars` with
`../happytohelp-0.3.dev.vars`. Never run 0.3 against a database migrated by 0.4.
The local state copy and rer archives include Durable Object storage; a raw
D1/R2 backup does not.

From 0.4 on, Move in keeps private import originals in R2 and their journals in
D1. Back up and restore them together, with the encryption key, so resume and
undo can verify original bytes.

## Import data from the original HappyToHelp service

This open-source project is a new edition of the original HappyToHelp
application. If you have an export of your data from that original service, you
can bring it into a local installation. If you are starting fresh, you can skip
this section.

1. Plan the import without writing anything:

   ```sh
   node scripts/import-legacy.mjs --file /absolute/export.json
   ```

2. Import into the migrated local D1/R2 state by adding `--apply` (and,
   optionally, `--persist-to .wrangler/state`, which is the default):

   ```sh
   node scripts/import-legacy.mjs --file /absolute/export.json --apply
   ```

The importer runs locally only and never reads a production database. Use a
consistent export with exact IDs, decimal money and the original object
bytes/hashes kept; see `src/modules/legacy-import/README.md`.

**How imports behave:**

- Imports resume using the export file's SHA and a receipt for each row; they
  are not atomic across the whole database.
- Running the same export again skips rows already committed, and conflicting
  rows or objects stop the import without overwriting anything.
- Inspect `legacy_import_rows`, the run records and `legacy_import_holds`.
  Rows kept only as an archive do not mean the matching feature is live.
- Historical financial rows remain read-only records, and ambiguous generation,
  training or provider work needs reconciling before any new provider attempt.
- No imported session, password token or device grant is trusted as authority.

## Measure local usage and costs

These docs don't give a typical monthly bill, because hosted costs haven't been
measured. What there is: a meter you can run on your own computer to see how
much work typical conversations cause.

The [local usage guide](docs/usage/README.md) describes the opt-in meter and its
synthetic test input. It runs three visitor messages, two owner replies, a 1 MiB
upload/download and a socket reconnect/replay against the locally built Worker.
Run it on the exact build you are evaluating when you need current
measurements.

What the measurements cannot tell you:

- Local wall time, SQLite size and partial D1 metadata do not establish hosted
  CPU, total row usage, Durable Object duration/storage or billing.
- Missing values stay unknown, including AI usage when no configured provider
  ran.

The summary reports setup, static assets, scheduled recovery and individual
conversation workloads separately. Its dated price assumptions and 30-day
retention scenario are examples, not current quotes, total bills or automatic
expiry in the product. Get actual hosted metrics and current provider prices
before you budget.

`pnpm run test:usage` prepares generated migrations and runs the saved usage
summary regression plus real local request-limit checks. These keep the
429/`Retry-After` refusals and the workspace and installation daily AI ceilings
working without calling a provider. Configured limits are guards, not measured
capacity.


## What has and has not been verified

Results belong to the exact source tested. Local native/browser and fixture
checks do not establish hosted installation or real model/mail/Slack acceptance.
Timed activation, hosted operating costs and paid execution remain unqualified.
Accessibility is **FAIL / confirmed owner HOLD** and full portable-storage
fidelity (Base-data equivalence) remains held. rer archives carry Durable Object
storage with a digest; a raw D1/R2 backup does not.
[HANDOVER.md](HANDOVER.md#acceptance-boundaries) records current limits.

## For developers and maintainers

### Check that everything works

```sh
rer check --profile first-party
rer verify
```

Verify runs the real build, typecheck, selected module tests, native runtime,
command journey, workflow checks and source checks. Internal `verify:app` is a
nonrecursive adapter target. Locally run only touched tests and `pnpm run typecheck`;
full verification/browser runs belong on the designated remote runner and CI.
Refresh the source lock with `pnpm run source:lock` and check it with
`pnpm run source:check`. Inspect the source graph with `pnpm run source:inspect`.

### Change the database schema

Add an immutable migration in its owning module. `scripts/migrations.mjs` collects
selected migrations for the real build/setup/transfer paths. Prove upgrade and
prior-data custody through native D1/R2 flows; never edit applied SQL.

### Local owner entry and email

`rer dev` uses a local-only native identity wrapper. After `RER_READY`, open the
private `RER_OPEN` address to enter as the real owner. It exchanges a per-checkout
fragment key for a gate cookie before issuing a native dev session. The key and
session are required together, and neither the wrapper nor its bindings belongs
in deployed output. Native passwords, prior accounts, tenant checks and roles
are retained. Preview serves production output and uses native password sign-in.

Trusted local setup selects the development email transport. Visitor and teammate
mail is validated and suppressed with status `development`, without storage,
a viewer or external sending. Production requires its configured provider;
missing credentials and uncertain sends remain explicit failures. Native hosted
magic links require a single-use confirmation POST; scanner GETs do not consume
them. Keep entry URLs, message contents, cookies and sign-in tokens private.

### Security headers

Preserve the native CSP, scoped preview origin, frame protections, content-type
and cache policies, and origin/permission checks. Provider and customer content
is untrusted. Keep secrets out of assets, build metadata and source archives.

### License, source tools and reproducible builds

Keep asset provenance and third-party notices with selected source. The
[authoring guide](docs/AUTHORING.md) describes exact Base copies and source graph
checks. Reproducible artifact and prior-data checks have their own public paths;
a source lock is not product or provider acceptance.

### Operating description before installation

The operating declaration is available in `OPERATIONS.json`. The current pinned global `rer` launcher bootstraps the checkout’s locked dependencies before it dispatches `rer describe`, including in a fresh clone. NATIVE-001’s before-dependency inspection point remains blocked on a Base launcher change. Published rer 0.2.79 has the same ordering. A successful description after bootstrap does not establish dependency-free inspection.

## Managed conversation mail v1

The application declares `mail.providers: ["rer"]` and `H2H_RER_MAIL_VERSION=1`. Managed routing is assigned by the platform through `MAIL_PROVIDER`, `MAIL_FROM`, `MAIL_RELAY_URL`, `RER_MAILBOX_ID`, `RER_MAIL_ADDRESS` and `RER_MAIL_CONTROL_URL`. Keep `MAIL_API_KEY`, `RER_MAIL_INGRESS_KEY`, `INBOUND_EMAIL_TOKEN` and the existing `INTEGRATION_ENCRYPTION_KEY` private. They are application authority/data keys; no provider credential is requested from a Managed customer. Native and Assisted direct-provider configuration still uses `EMAIL_*`.

Migration 249 retains mailbox bindings, an idempotent control outbox, encrypted MIME object references and redacted command/thread receipts. Provisioning seeds the reserved default in the workspace transaction and binds it after commit. The native queue/schedule retries control work with bounded backoff, surfaces conflicts, refreshes route status and retires deleted workspaces. A new installation cannot choose a mailbox owned by another installation; platform enforcement and live qualification remain required.

The frozen transport signs `POST`, the ingress path, canonical metadata and the exact MIME bytes with HMAC-SHA256. Metadata includes protocol version, delivery/mailbox/workspace identities, generation, envelope, provider verdict, timestamp and body SHA-256. The app rejects stale, tampered or foreign requests and stores content before acknowledgment. Retrying a delivery keeps its identity. Never route this through the bearer JSON gateway as a substitute for sender authentication.

HTTP 202 records provider acceptance only. Native outbound commands never replay failed, sending or uncertain attempts. One refusal is held instead: a conversation notification (a scheduled reply’s included) or a problem reply refused at authenticate with `mail_credential_revoked` or `mail_credential_required` (a `MAIL_API_KEY` rotation before the rebuilt release serves traffic) has no relay send row, so it stays pending and the conversation outbox resends the same command, with the same `messageKey`, using the key the running release holds. About an hour after the first refusal it fails as an unavailable authority. The scheduled reply or problem attempt then records the resend’s or the failure’s outcome. Other mail is not held. An authorized reconciliation reads `send/:messageKey`; it never posts another send. During disconnect/leave, platform revocation remains responsible for its durable authority boundary. Hosted complete export and the real-mail gate remain pending; this change does not promote PORTABILITY-001 or MAIL-001. See [support email](docs/email.md#managed-email).
