# Run it on your computer

Use the [getting-started guide](docs/getting-started.md) to install the published release.
To start it again later, run `cd run-happytohelp && rer dev`.

Dev uses its local address for the chat widget and generates a private owner
password. Wait for `RER_READY`, then open the `RER_OPEN` address to enter as the
real local owner and reach **Setup**. No private answers, email service or AI
account are needed. Use `rer dev --stop` from the checkout to stop the managed app.

## Scripted setup and command reference

```sh
rer setup --owner-email you@example.com --answers .seed/local-answers.json
rer dev --foreground
```

Prepare private answers as described in [Install](docs/INSTALLER.md#private-setup-answers).
Setup builds, applies local migrations, prepares the real first owner and stops
its temporary app. Dev provides Vite assets and HMR and stays in the foreground
with `--foreground`. It prints `RER_READY URL` after real health checks and
`RER_OPEN` for entry as the local owner. Native password sign-in is retained.
JSON and non-interactive commands never open a browser or ask stdin questions.
Stop dev with Ctrl-C before:

```sh
rer verify
rer build
rer doctor
rer describe --json
rer check --profile first-party
```

Every new verb supports `--help`, `--cwd PATH`, `--non-interactive` and `--json`.
Setup also accepts `--owner-name`, `--port`, `--host` and a private JSON `--answers`
file using the installer model's names. Dev accepts `--port` and
`--host`. Explicit ports never
drift. Hosts are exactly 127.0.0.1, localhost or ::1. Setup rejects a conflicting
saved owner or origin and preserves existing data and exact private settings.

```sh
rer reset --yes
```

Review reset's printed inventory first. It removes only canonical local state,
installer state, CLI bookkeeping and declared generated settings. Source,
dependencies, exports and deployment receipts survive. Active operations,
symlinks and ambiguous legacy state cause a refusal. A second reset succeeds.
A subsequent setup creates a fresh owner without previous domain rows.

Stop dev, then use `rer export --output exports/installation.rer`.
The new private archive includes supported domain tables with an integrity hash
and explicit exclusions. After `rer reset --yes`, restore with
`rer import --input exports/installation.rer --yes`. Import validates the
archive and restores atomically into an empty destination. Run setup afterwards
to re-enter local configuration. Native identities/password hashes are retained;
sessions, one-use links, private settings and transient execution state
are excluded. Remote transfer exits 4.

Setup uses the shared manifest reader and browser installer model. Private
answers use the declared `rer-setup.json` field names.

```sh
rer deploy --dry-run
```

The current release validates the deployment configuration and builds locally.
The dry run needs no provider credentials, sends no mail and makes no remote
requests. Its report lists any inputs needed for a real deploy and leaves remote
resources, credential validity and existing secrets unchecked.

To inspect an existing Worker, run the separate
[read-only provider preflight](docs/INSTALLER.md#read-only-provider-preflight)
with explicit consent and the owner's scoped Cloudflare read token. It reads
the account's Workers subdomain and the Worker's settings and secret names in
three requests. It sends no mail and changes no resources. Live qualification
remains **UNMET-EXTERNAL** and remote provisioning is separately unqualified.

A real `rer deploy` requires the owner-account credentials and committed source
described in [Operations](OPERATIONS.md#deploy-to-your-cloudflare-account). A new
hosted installation needs a real `OWNER_EMAIL` that can receive sign-in mail.
Supply private email settings such as `EMAIL_PROVIDER`, `EMAIL_FROM` and
`EMAIL_API_KEY` when the hosted installation uses its own outbound email
provider. For an installation that does not send email, see
[Deploy with outbound email off](OPERATIONS.md#deploy-with-outbound-email-off).
Existing installations retain their saved secrets unless explicitly changed.
Deploy provisions resources, applies migrations and checks app health. The
default environment is production. Choose another with `--environment NAME`.
Release uses the unchanged Base producer and its existing required `--repo` and
`--output` arguments, plus explicit `--project`/`--repository` where applicable. It never pushes or deploys.

Exit codes: 0 success/help; 1 execution, health or check failure; 2 invocation or
syntax error; 3 missing input/tool/configuration; 4 safety or unsupported capability;
130/143 cancellation after owned cleanup. JSON is NDJSON with version 1, verb and
event; bounded commands finish with one result containing ok and exitCode.
Describe is one inspection object. Release retains its existing JSON receipt and
0/1/2 exits.

Independent projects may use OPERATIONS v2 with their own argv and inputs, without
packages, editions, pnpm, this stack, an installer or these pins. Execution uses
shell false, consumes wrapper flags before `--` and forwards its remaining argv
unchanged. Missing commands are refusals, with no inferred fallback. Declared
child exits are preserved. Check validates structure; doctor inspects the local
environment. Neither establishes remote or application acceptance.

## Fixed preview and bounded serving

After the pinned Node 22.20.0 / pnpm 10.12.4 frozen installation and ordinary
`rer setup`, inspect production output with:

```sh
rer preview
# In another terminal:
rer preview --stop
rer dev --idle-timeout 1800 --foreground
rer dev --stop
```

Use preview for fixed production output; use dev for live edits and HMR.
Preview reuses an intact build only when the actual public inputs and output
bytes match its nonsecret receipt. Neither mode resets the saved owner or
`.wrangler/state`. Dev prints the private `RER_OPEN` address for automatic owner
entry. Preview serves production output and prints its ready app address; sign in
with the existing native password. Preview has no automatic dev identity or
local email viewer. The same checkout has one
managed instance. A compatible duplicate prints its URL, while another mode
or explicit conflicting option refuses with exit 4 and its stop instruction.

Idle timeout precedence is `--idle-timeout`, `RER_SERVER_IDLE_SECONDS`, then
43200 seconds (12 hours). Positive integer seconds only. Application HTTP/assets
activity resets the timer, active streams prevent expiry, and internal probes
or HMR control traffic alone do not keep the app alive. Real application
WebSocket messages count. `--stop` is idempotent and cannot take start flags.

The OS user's `~/.rer/servers` registry (`RER_SERVERS_DIR` override) admits two
combined dev/preview instances by default (`RER_SERVER_LIMIT`, positive integer).
Starting instances count. At capacity, the oldest server with no active work
and at least 60 seconds idle is stopped; otherwise the command lists safe URLs
and stop instructions and refuses. Worktrees are distinct; symlink aliases are
one checkout. Stops clean up owned descendants before freeing capacity/state.

Heavy bounded work joins `~/.rer/jobs`; waiting commands report their live queue
position. Package mode has no queue status command. Labels identify project,
initiating command/phase and checkout. Nested jobs share only validated live
membership. Original `CI=true` skips admission and permits heavy-command
`--no-queue`; ordinary calls and `CI=false` queue. Help/check/describe/doctor,
stop and reset inspection remain light. Use `rer install` for dependencies and `rer deploy` for deployment.

## Contributor setup

For source work, select Node 22.20.0 and pnpm 10.12.4, then run
`pnpm install --frozen-lockfile`. See [contributor setup](README.md#contributor-setup).
