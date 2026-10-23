# Install HappyToHelp

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

## Contributor setup

For source work, select Node **22.20.0** and pnpm **10.12.4**:

```sh
pnpm install --frozen-lockfile
pnpm exec rer describe --json
pnpm exec rer check --profile first-party
```

This installs frozen dependencies without creating an owner or starting the app.
The following private-answer path is also available for scripted setup or to
choose your own website and password.

## Private setup answers

Create `.seed` with mode 0700 and `.seed/local-answers.json` with mode 0600 using
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
yourself or deploy it as an installation secret.

`INBOUND_EMAIL_DOMAIN` is an optional variable for hosted installations: the domain
that workspace reply mailboxes are created under (for example `in.example.com`).
Without it, mailboxes default to `in.` followed by the workspace's website host. The
delivery packaging declares the domain as a public variable and the generated
token as a deploy secret. Rer supplies the token to the hosted installation and
retains an existing secret; older archives still import. A Workers deployment
hostname does not become your workspace name: a `workers.dev` website defaults
to **My workspace** regardless of owner email. An explicitly chosen native workspace
name takes precedence; you can change it in Project settings.

## Run it locally

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
   The widget has no email field by default. To collect an address for emailed
   operator replies, enable **Required contact details → Require email** on this
   same settings page and save. Visitors then enter their email before sending.
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

Stop dev, then run `rer verify`. Export before destructive reset
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
the other. The zero-outbound dry-run is implemented in this candidate. The separately started preflight still needs implementation and live qualification.

`rer deploy --dry-run` validates the input shape and builds locally. It makes no
provider requests, sends no mail and makes no deployment. Cloudflare credentials
are not required. Remote resources, credential validity and existing secret
bindings remain unchecked until a real deployment. `rer deploy --environment
production` requires owner authorization and the private credentials/declaration
in Operations. Local development still needs no email account.
Stop `rer dev` first (`rer dev --stop`): while it runs it owns the checkout's local
state, and `rer deploy`, including `--dry-run`, refuses with "An active local
operation owns the state".
`rer describe` lists the remaining commands and real flags.
All new verbs accept `--help`, `--cwd PATH`, `--non-interactive` and `--json`;
release has its own preserved parser. No command implies provider acceptance.

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
