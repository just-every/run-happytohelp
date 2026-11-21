# Install HappyToHelp

Start the free local app with this single copy-and-run command. You do not need
Node.js or npm installed first; the installer brings its own. Git is required.

```sh
curl -fsSL https://runeditrun.com/install.sh | sh -s -- dev just-every/run-happytohelp
```

That clones HappyToHelp into `run-happytohelp`, provisions the checkout's own pinned
Node and pnpm, installs dependencies, sets up a local owner and starts the app.
To start it again later, run `cd run-happytohelp && rer dev`.

Normal setup and launch install the app's dependencies and build its local assets;
they do not download Chromium. Dev uses its local
address for the chat widget and generates a private owner password. Continue in
the app, or open the private `RER_OPEN` link to reach **Setup** as the owner.
No private answers, email service or AI account are needed. Use `rer dev --stop`
from the checkout to stop the managed app.

## Expert / contributor alternatives

If you already have **Node.js 22 or later** (with npm) and Git, check with
`node --version`, then start the same app with:

```sh
npx -y @runeditrun/rer dev just-every/run-happytohelp
```

To set it up without starting it, use
`npx -y @runeditrun/rer setup just-every/run-happytohelp`.

### Contributor checkout

For source work, install Node **22.20.0** and pnpm **10.12.4** in your
development environment. From the repository checkout root, install the locked
dependencies and run the repository scripts:

```sh
pnpm install --frozen-lockfile
pnpm run describe --json
pnpm run check --profile first-party
```

This installs frozen dependencies without creating an owner or starting the app.

## Private setup answers

For scripted setup of a fresh checkout, create `.seed` with mode 0700 and
`.seed/local-answers.json` with mode 0600 using
your editor. Keep the file inside the checkout. Use your own values. Explicit
`rer setup` requires the website, owner email and owner password:

```json
{
  "WIDGET_ORIGIN": "https://example.com",
  "OWNER_PASSWORD": "Enter your own password of at least 12 characters"
}
```

The email comes from `--owner-email` below. An `OWNER_EMAIL` in the file must
agree with that flag. These answers are optional; a missing one is not sent and
the workspace derives it:

| Answer | Left out |
| --- | --- |
| `WORKSPACE_NAME` | named from the website or company email domain, otherwise `My workspace`; change it in Project settings |
| `PRIMARY_COLOR` | a colour is chosen for you; change it in Widget settings |
| `OWNER_NAME` | taken from the first part of the owner email |
| `AI_PROVIDER` | `later`: no AI key is stored and no provider is contacted |

To store an AI key now, set `AI_PROVIDER` to `openai`, `anthropic`, `google`,
`deepseek`, `xai` or `openrouter` and add one key answer for that provider:
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_API_KEY`, `DEEPSEEK_API_KEY`,
`XAI_API_KEY` or `OPENROUTER_API_KEY`. The key lands in the private `.dev.vars`
under that name and nowhere else; a key for a provider other than the chosen one
is refused. Setup does not contact the provider.

`rer-setup.json` owns field names and conditional requirements. Secrets belong in
the private answer file, never command arguments, logs or source. Native password
identity is retained. Local setup selects rer dev v2 mail and refuses to
overwrite a saved remote provider.

## Generated and optional settings

Automatic `rer dev` setup uses the selected local origin as `WIDGET_ORIGIN` and
generates `OWNER_PASSWORD` when unanswered. The password is stored only in the
checkout's private `.dev.vars`, never printed. Supplied private answers and saved
settings take precedence; an `OWNER_PASSWORD` environment value is used when no
password was saved or answered. These local defaults do not relax explicit setup
or hosted owner password requirements.

Setup generates three private secrets in `.dev.vars`: `H2H_SETUP_TOKEN`,
`INTEGRATION_ENCRYPTION_KEY` and `INBOUND_EMAIL_TOKEN`. None is printed in
command output or logs. `INBOUND_EMAIL_TOKEN` is the bearer value your email
provider's inbound routing presents when it forwards replies to
`/api/integrations/email/inbound`. Deployment supplies the generated token to the
hosted Worker. A token and a provisioned mailbox do not route email by themselves:
configure your provider's inbound domain, forwarding and webhook for the deployed
endpoint, with the matching bearer token. Cloudflare secrets cannot be read back,
so keep a private copy from `.dev.vars` before configuring the provider.

Rerunning setup keeps an existing `.dev.vars` as it is. The one exception: a
checkout set up before `INBOUND_EMAIL_TOKEN` existed gains that single generated
line on its next setup, and no existing value is changed or rotated. New answers,
such as an AI key, are not applied to an existing `.dev.vars`; add the key there
yourself or deploy it as an installation secret. After editing `.dev.vars`,
[restart your local copy](getting-started.md#restart-after-changing-a-local-setting)
so it reads the new value.

`INBOUND_EMAIL_DOMAIN` is an optional variable for hosted installations: the domain
that workspace reply mailboxes are created under (for example `in.example.com`).
Without it, mailboxes default to `in.` followed by the workspace's website host. The
delivery packaging declares the domain as a public variable and the generated
token as a deploy secret. Rer supplies the token to the hosted installation and
retains an existing secret; older archives still import. A Workers deployment
hostname does not become your workspace name: a `workers.dev` website defaults
to **My workspace** regardless of owner email. An explicitly chosen native workspace
name takes precedence; you can change it in Project settings.

## Run a scripted setup

```sh
rer setup --owner-email you@example.com --answers .seed/local-answers.json
rer dev --foreground
```

Setup builds, applies local migrations, prepares private settings and the first
owner and stops its temporary runtime. Creating the owner provisions the
workspace; local email is suppressed without storage or external sending. Reruns
preserve the same owner, data and exact existing private settings. Conflicting
saved email or origin is refused; preserve data before any recovery or reset.

Dev reports `RER_READY` after real health checks. Open `RER_OPEN` to enter as
the local owner. Native password sign-in remains available. Use `rer dev --stop`
to stop the managed app, or `rer dev --foreground` to keep it in the terminal and
stop with Ctrl+C.

Choose an explicit loopback port with `--port 8788`, using the same saved origin
for setup. See [Local command reference](../RUN-LOCALLY.md) for preview and
bounded serving. Sign-in takes you to the workspace Setup page described in
[First-run setup](SETUP-WORKFLOW.md).

## Try the customer widget locally

Use a real page to send a customer message, then reply from your workspace inbox:

1. In **Settings → Widget → Code**, copy the installation snippet. It already
   points at this HappyToHelp app and contains the workspace's public widget key.
2. Create an `index.html` in a separate test folder with a normal HTML document
   and paste the snippet before `</body>`. Serve that folder with your website's
   development server. For example, if Python 3 is installed, run this from the
   test folder. It picks a port nothing else is using and prints the page's
   address:

   ```sh
   PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
   echo "Test page: http://127.0.0.1:$PORT"
   python3 -m http.server "$PORT" --bind 127.0.0.1
   ```

3. In **Settings → Widget → Settings**, set **Widget website origin** to the
   address it printed, such as `http://127.0.0.1:52817`, and save. Use the actual origin if your server differs:
   scheme, hostname and optional port, without a path. `localhost` and `127.0.0.1`
   are different hosts, and different ports are different origins.
   Fresh installs ask widget visitors for an email before sending a message.
   To turn this off, open **Settings → Widget → Settings → Required contact
   details** and disable **Require email**, then save. An explicitly saved choice
   is retained.
4. Open that address in another browser profile or private window. Open
   the widget and send a message. In your signed-in app,
   open **Inbox**, choose the conversation and reply. Check the reply in the
   visitor's widget. Local visitor and teammate email is suppressed without
   storage or sending.

The website origin is where your customer page runs. The app origin is the
`RER_READY` address serving HappyToHelp, its API and `widget.js`; keep that app
address in the copied snippet. Saving a website origin replaces the previously
allowed external website, while the app's own origin always remains allowed.
An online website needs an online HappyToHelp installation reachable by its visitors.

**Unverified** on the contact means the website has not signed the visitor's
identity with the optional server secret. It does not prevent an operator reply
from being emailed to the address the visitor entered. Local mail uses rer dev v2
and is suppressed without storage or external sending. On a hosted installation
with sending configured, **Email sent to provider · delivery not confirmed** on a reply records provider acceptance,
not confirmed inbox delivery. Inbound mail routing is configured separately.

## Verify, reset and move data

Stop dev, then run `rer verify`. Verification downloads the Chromium and headless
shell pinned by the checkout's Playwright into your user cache the first time
they are needed. To install them before running a browser journey directly, such
as `pnpm run test:docs-browser`, run this from the checkout:

```sh
pnpm exec playwright install chromium
```

This command downloads Playwright's Chromium into your user cache if it is not
already installed. On Linux, `pnpm exec playwright install --with-deps chromium`
also installs the system libraries the browser needs.

Export before destructive reset
if you need the data. Reset requires `rer reset --yes` after
reviewing its printed inventory. Export/import use `--output FILE` and
`--input FILE --yes`; import requires an empty destination. Native owners survive
restore. Re-enter private configuration before setup/dev. See
[Operations](../OPERATIONS.md#local-data-and-backups).

## Deploy and inspect

NATIVE-001 requires two independent steps: a **zero-outbound dry-run** that
explicitly reports no outbound requests and needs no provider credentials, then a
separately started **read-only provider preflight** with owner consent and the
owner's scoped Cloudflare token. The preflight has its own acceptance: only the
account's Workers subdomain and the Worker's settings and secret names (three
GETs for an existing Worker), no mail and no mutations. Neither step is a mock of
the other. Both commands are implemented; live provider qualification remains
**UNMET-EXTERNAL** and needs the owner’s scoped token and authorization.

From the installed checkout, run the credential-free local check:

```sh
rer deploy --dry-run
```

It validates the input shape and builds locally. It makes no provider requests,
sends no mail and makes no deployment. No Cloudflare credentials, mail provider,
verified sender, sending token or real `OWNER_EMAIL` are required. The completion
report explicitly says no Cloudflare requests were made and nothing was changed
remotely; missing production inputs are listed as needed for a real deploy.
Remote resources, credential validity and existing secret bindings remain unchecked
by the dry run. The separate command below can inspect an existing Worker. `rer deploy --environment
production` requires owner authorization and the private credentials/declaration
in Operations. Local development still needs no email account.
Stop `rer dev` first (`rer dev --stop`): while it runs it owns the checkout's local
state, and `rer deploy`, including `--dry-run`, refuses with "An active local
operation owns the state".
`rer describe` lists the remaining commands and real flags.
All new verbs accept `--help`, `--cwd PATH`, `--non-interactive` and `--json`;
release has its own preserved parser. No command implies provider acceptance.

### Read-only provider preflight

From the installed checkout, explicitly start this separate command for an
**existing** Worker. It does not build, deploy, send mail or repair anything.
It never runs as part of `rer deploy --dry-run` or any setup/build command.

1. In the Cloudflare account that owns the Worker, create a custom API token with
   **Account → Workers Scripts → Read**, restricted to **that one account**.
   This is the minimum permission set for all three reads. Do not add Edit,
   D1, R2, Queues, zone, user or membership permissions for this command.
2. Copy that account's ID and the existing Worker's exact name from the dashboard.
   Replace `YOUR_ACCOUNT_ID` and `YOUR_EXISTING_WORKER` below and review both.
   The explicit `--consent-read-only` flag authorizes reads of those named targets;
   omitting it refuses before any request. A token alone is not consent.
3. Supply the token only in the process environment as `CLOUDFLARE_API_TOKEN`.
   For example, in Bash, read it without terminal echo or a history entry:

   ```sh
   read -r -s -p 'Scoped Cloudflare read token: ' CLOUDFLARE_API_TOKEN
   printf '\n'
   export CLOUDFLARE_API_TOKEN
   pnpm -s run preflight:provider --account-id YOUR_ACCOUNT_ID --worker YOUR_EXISTING_WORKER --consent-read-only
   unset CLOUDFLARE_API_TOKEN
   ```

The command does not open credential files, use `--env-file`, discover accounts,
request token verification, or contact the Worker itself. It uses the token only
in the Authorization header. It does not print or save the token, binding values
or raw provider errors. Keep the environment private and do not enable shell
tracing around credential entry. Use `pnpm -s` to suppress pnpm’s argument echo
and trailing lifecycle error; plain `pnpm run` can echo a credential mistakenly
pasted into an argument before the command refuses it. The command itself
refuses credential-bearing identifiers and redacts its own output at either door.

For an existing readable Worker it makes exactly these three HTTPS GETs, in order,
on `https://api.cloudflare.com/client/v4`, with no body, retries or redirects:

| Read | Path | Cloudflare API documentation |
| --- | --- | --- |
| Account Workers subdomain | `/accounts/{account_id}/workers/subdomain` | [Get a Workers Subdomain](https://developers.cloudflare.com/api/resources/workers/subresources/subdomains/methods/get/) |
| Worker settings and binding names/types | `/accounts/{account_id}/workers/scripts/{script_name}/settings` | [Get Worker Script and Version Settings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/get/) |
| Worker secret names | `/accounts/{account_id}/workers/scripts/{script_name}/secrets` | [List secrets bound to a Worker script](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/secrets/methods/list/) |

The summary compares compatibility date/flags, declared resource binding
names/types, public setting binding presence and required/optional secret NAMES
with `deploy.json`. Optional absent names are informational. Owner-claim token
fields are taken from `rer-setup.json` and treated as lifecycle-optional: an
absent token is reported as "absent, spent after owner claim" without failing
the preflight. Its absence alone does not prove a claim occurred. Every other
required secret name remains required. A missing required name or setting gives
exit 9; the report never reads secret values or proves that a value works.
Schedules, queue consumer configuration, resource contents, health, sending and
edit permissions remain unchecked. This is an inspection, not a deployment
readiness certificate.

Every run ends with `No mail was sent and nothing was changed.` It stops on the
first failed read, without retrying or following a redirect. Exit codes are:

| Exit | Meaning |
| --- | --- |
| 0 | Help, or completed reads with no required difference |
| 2 | Invalid arguments or unreadable edition declaration/setup manifest |
| 3 | Missing explicit read-only consent |
| 4 | Missing or whitespace-only environment token |
| 5 | HTTP 401/403: check token validity, account scope and Workers Scripts: Read |
| 6 | HTTP 404: account subdomain or Worker missing |
| 7 | Network failure or timeout |
| 8 | Other HTTP, protocol, response-shape or unexpected failure |
| 9 | Missing or mismatched declared settings or required secret names |
| 10 | A target identifier contains the environment token |

A 401/403 cannot by itself distinguish an invalid token from a missing scope.
A missing Worker is never created.

**Live qualification: UNMET-EXTERNAL.** The command is covered with a fake at the
network edge. It has not been qualified against a real Cloudflare account;
that requires the owner's scoped token and explicit consent in a separate run.
Remote provisioning remains separately unqualified.

_Preflight guidance: Run Edit Run fleet, 17 November 2026._

### Outbound email off

Set `MAIL_PROVIDER=none` with a real `OWNER_EMAIL` in the private `--env-file` (or
environment) to deploy an installation that sends nothing. It is the only input:
supplying `EMAIL_*`, `MAIL_*`, `MAILGUN_*` or mailbox settings with it is refused.
`none` is never assumed from a missing value; leave `MAIL_PROVIDER` out and a
deploy still needs a mail provider. The owner then signs in with
`node scripts/hosted-signin.mjs`, described under Sign in without mail in
Operations. Turning mail on later is one `rer deploy --set-secret` of the provider
inputs, described in the email guide.

### Custom application origin

Attach your hostname to the deployed Worker in your Cloudflare account, then add
`H2H_PUBLIC_ORIGIN=https://support.example.com` to the same private 0600 env file
you use for `rer deploy --environment production --env-file <file>`. Supply an
exact HTTPS origin with no trailing slash, credentials, path, query or fragment.
Keep this input on every redeploy; omitting it selects the default workers.dev
address again. Invalid input is refused before build or provider writes.

The seed writes a private generated deploy declaration in `.rer`, using rer's
supported `vars` declaration to set `APP_ORIGIN`. The tracked declaration and
resource names stay the same. This origin governs sign-in, invitation and
notification links, widget URLs, file links, help citations and OAuth callbacks.
Register `https://support.example.com/api/management/github/callback` with your
GitHub OAuth app if you enable that integration. Browser entry on workers.dev
redirects to the public address; health and API endpoints remain available for
rer. Cookies are host-only, so sign in again on the custom hostname. Customer
website origins remain a separate setting under **Settings → Widget**.
