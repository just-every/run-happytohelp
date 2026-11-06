# Seed command contract 1

This HappyToHelp-maintained contract derives from Run Edit Run Base
`export/SEED-COMMAND-CONTRACT.md` at revision
`2de0b38c2ff5990dcfd7c177ad223a98b2aadf14`, adapted for the exact
`@runeditrun/rer` 0.2.42 package pin and the 16 October local-development decision. It is locally owned documentation, not a byte-exact
Base copy. The application runtime copies retain their existing reviewed pins.
HappyToHelp retains its native homepage and password sign-in.

## Commands and flags

Run from the project root, or use `--cwd PATH`. Every new verb accepts `--help`, `--cwd PATH`, `--non-interactive` and `--json`. Help exits before tools, configuration, adapters or effects run. Unknown flags, missing flag values and invalid values fail before effects. A single `--` separator is accepted for package-script forwarding. Flags belong only to the verbs listed below; there is no catch-all pass-through in the first-party profile.

| Required verb | Additional flags | Successful end state |
| --- | --- | --- |
| `install` | `--no-queue` | Frozen dependency installation using the pinned pnpm and lockfile; no app setup, global tool changes or deployment. |
| `setup` | `--owner-email EMAIL`, `--owner-name NAME`, `--port P`, `--host HOST`, `--answers FILE`, `--no-queue` | Manifest answers validated; real build, all local migrations, private settings and first owner prepared; temporary app stopped before exit. |
| `dev` | `--foreground`, `--detach`, `--port P`, `--host HOST`, `--idle-timeout SECONDS`, `--stop`, `--as PERSONA`, `--login`, `--no-queue` | Managed development server with assets/HMR, real health readiness and declared local Cron Triggers. `RER_OPEN` enters as the real native owner through the rer dev v2 key gate; declared personas and `signed-out` are selected with `--as`. `--login` retains the same dev v2 entry. |
| `preview` | `--port P`, `--host HOST`, `--idle-timeout SECONDS`, `--stop`, `--no-queue` | Managed foreground production output, health readiness, canonical durable state and declared local Cron Triggers. Prints the app address; native password sign-in applies. No automatic dev entry or local email viewer. |
| `build` | `--no-queue` | Real production Worker/assets built with private local settings excluded, then restored exactly. A `devIdentity` seed's build fails with exit 4, naming the file, when its output contains the dev layer's marker. |
| `verify` | `--no-queue` | The seed's complete verification command runs; it never calls its own public `verify` alias recursively. Then its production build is served on loopback as `pnpm exec rer deploy` hosts it (see Hosted assets and deploy identity); verify fails, listing each path, when a built file does not answer 200 or `/health` lacks the deploy identity. |
| `reset` | `--yes` | Explicitly confirmed local data, owner, generated settings and installer state removed; no remote effect. |
| `deploy` | `--environment NAME`, `--dry-run`, `--no-queue` | Base deploy-kit owner-account deployment plus health (the deploy identity, then one built file must answer 200); dry run validates/builds locally and makes zero provider requests or mail sends. Real deploy requires the private `EMAIL_PROVIDER`, `EMAIL_FROM` and `EMAIL_API_KEY` inputs, mapped to both `MAIL_*` and native `EMAIL_*` bindings; with rer 0.2.42 a dry run validates them when supplied and otherwise lists them as needed. Default environment is `production`. Both refuse with exit 4, before building, a deploy binding, secret or secret source named `RER_DEV_KEY` or any key the adapter declares in `localOnlyKeys`; deploy-kit's owner plan refuses the same. |
| `export` | `--target local\|remote`, `--output FILE`, `--origin URL`, `--session-file FILE`, `--no-queue` | Complete supported installation data written to a new owner-only archive, with integrity receipt and explicit exclusions. Default target is local; output is required. A declared `prepareData` hook runs first and the path is checked against the app's served folders after it, so a checkout that never built still completes when its Vite configuration needs a file `prepareData` generates. |
| `import` | `--target local\|remote`, `--input FILE`, `--journal FILE`, `--origin URL`, `--session-file FILE`, `--yes`, `--legacy-v1`, `--acknowledge-unverified-metadata`, `--acknowledge-unverified-schema-objects`, `--output FILE`, `--no-queue` | Archive validated and atomically restored into an empty destination under the product's restore policy; input and confirmation are required. Normal import requires v2; `--journal` (local only) names a later archive of the same installation, whose erasure journal also fences the restore. Backup-only local Workers v1 recovery requires both legacy flags and a new v2 output; it refuses `--journal` rather than ignoring it. See modules/portability/README.md#backup-only-v1-recovery. Older v2 archives without `schemaObjects` need no acknowledgment when recorded migrations prove the complete destination schema; otherwise explicit `--acknowledge-unverified-schema-objects` is required and the recovery receipt records that uncertainty. A declared `prepareData` hook runs first, so a copy that never ran setup or build can import. |
| `doctor` | none | Read-only tool/version, local configuration and state-placement diagnostics, naming missing inputs and their documented sources, plus `warnings` for leftover Node quarantine copies, mismatched Node/pnpm/workerd pins across running checkouts and a checkout on another volume (warnings never change the exit code). No provider request. |
| `describe` | none | Describes commands, flags, aliases, effects, pins and state without installing or executing project commands. |
| `check` | `--profile first-party` | Read-only structural contract/operations validation, including required hooks, flags, aliases and pins. No credentials needed for a fresh clone. |
| `release` | existing `--repo`, `--project`, `--repository`, `--output`, `--ref`, `--dry-run`, `--tag [vVERSION]`, `--clean-history`, `--onto`, `--env-file`, `--no-queue` | Existing Base release behavior, receipts, validation, gates, local tags and exit codes preserved. |

`release` is the compatibility exception: preserve its existing parser, required `--repo`/`--output`, JSON receipt and exit codes; do not retrofit the new common flags or infer publishing identities. Root help may list the new commands. Release never pushes or deploys. Source inspection and locking remain edition-authoring commands, not another implementation in `rer`.

`--no-queue` is available only on the heavy commands that list it and only
when the original caller has `CI=true`. The actual descriptor is authoritative
for a given checkout.

Base default-seed and exported foundation typechecks in `verify` use checkout-local, gitignored `.cache/typecheck.tsbuildinfo` in the package; deleting it forces a full check, while `build` still builds the real Worker and assets.

`P` is a decimal integer 1–65535. An explicit occupied port fails; never silently choose another. Default port is the saved local port; a first `setup` with no `--port` saves the first free port from 8787 (free on every address, never a port another process listens on) and prints it in one line. `HOST` is exactly `127.0.0.1`, `localhost` or `::1`; default is saved host, otherwise `127.0.0.1`. Public/listen-all hosts fail. First setup saves the selected origin. Dev/preview overrides apply together to runtime bindings and never rewrite private settings. Setup refuses a conflicting saved owner or a changed host with an actionable reset/recovery instruction; it does not silently ignore flags. Setup with a different `--port` moves the checkout instead: only the saved port changes, data is kept, no reset is needed, and the old and new port are printed; a refusal for a busy port names the holder and gives the exact `pnpm exec rer setup --port N` command for a free port. Heavy commands wait in the machine-wide job gate (`~/.rer/jobs`) for a slot, load at or below 36 and available memory above 2 GiB (macOS free+inactive+speculative+purgeable pages, Linux `MemAvailable`); the waiting message gives position, the jobs ahead with their checkout paths and available memory against the floor, and `RER_JOBS_MIN_FREE_MEMORY_BYTES` changes the floor. `dev` never queues behind other checkouts' jobs. No automatic secret rotation; existing reviewed rotation APIs remain outside these public verbs.

First setup requires an owner email explicitly, through the manifest answers file, or through an interactive prompt showing any proposed git-email default. Non-interactive mode never silently claims the git identity. Email must be a valid plain mailbox, normalized consistently with mail/auth; never put it or secrets into a shell command. Owner name defaults to `Owner` unless supplied or declared by the manifest. `--answers` is a regular private JSON answer file using manifest names, not an environment file; conflicting flag/file values fail. Conditional required fields and seed-specific workspace answers come from `rer-setup.json`, never new seed-specific CLI flags. Secrets are read privately from declared files/environment or asked privately, never accepted as CLI values or printed. `--non-interactive` means no stdin prompt/browser launch; missing answers exit 3. JSON also suppresses automatic browser opening and prompts.

Missing-answer errors name the missing manifest fields. An answers file is a
private mode-0600 JSON object keyed by those names, for example
`{"OWNER_EMAIL":"owner@example.com"}`, passed with
`pnpm exec rer setup --answers PATH --non-interactive`. Keep secret
values in declared private inputs.

Local setting names come from the seed's existing declarations: `commandAdapter.hooks.secrets.originKey` selects the saved origin, and the setup manifest's `owner-claim.emailField` selects the owner mailbox. Without an owner-claim step, `commandAdapter.input.names.email` selects the mailbox. Undeclared names default to `AUTH_ORIGIN` and `OWNER_EMAIL`. Setup preflight, dev/preview prerequisites and identity input, and doctor all use these same keys and the adapter's declared settings file/format. Native-auth seeds retain their own setting names; do not add duplicate aliases or redeclare the manifest's owner field in the adapter.

## Output and exits

Human dev/preview output prints `RER_READY http://HOST:P` (IPv6 bracketed,
no trailing slash) only after the real application health check succeeds. Dev
then prints a private `RER_OPEN` address. The command does not launch a browser:
open that address to enter as the real native owner, or the selected `--as`
persona. Preview prints its ready app address and uses native password sign-in.
Declared local Cron Triggers report their bounded outcome as `RER_SCHEDULED`
lines or JSON `scheduled` events.

`RER_OPEN` uses `/__dev/key#rer-dev=KEY&as=owner`. The browser removes the
fragment before a same-origin POST exchanges the checkout key for the dev gate
cookie, then `/auth/dev/enter?as=owner` creates a native dev session. Keep this
entry URL private. No sign-in email or message body is printed.

Setup prints `RER_SETUP_READY URL` and exits with no server left running. Build,
install, verify, reset, deploy, export and import print their verb, outcome and
relevant safe path or URL. Dry-run deployment explicitly says no deployment
occurred.

With `--json`, stdout is UTF-8 NDJSON only: `{version:1,verb,event,...}`.
Bounded commands finish with one `result` event containing `ok` and `exitCode`;
failures emit an `error` event with a stable `code`, safe `message` and
`exitCode`. Dev/preview emits `ready` with `url`; dev identity also supplies
`openUrl` and `signedInAs` (null for signed-out). JSON and non-interactive modes
never launch a browser or ask stdin questions. Do not share credential-bearing
`openUrl` values. `describe --json` is one inspection object for actual parser,
adapter, pins, aliases and local-state capabilities. `check --json` reports
structural clauses and actionable errors; neither performs provider work.

| Code | First-party/new CLI meaning |
| --- | --- |
| 0 | Success, help or completed read-only check. |
| 1 | Executed command/test/health/transfer failed, or contract check failed. |
| 2 | Invalid invocation, flag/value, malformed descriptor or answer/archive syntax. |
| 3 | Missing setup answer, prerequisite/tool version, configuration, authentication or input file. |
| 4 | Safety refusal: unconfirmed reset/import, unsafe state/path/host, occupied requested port, conflicting saved identity, active local operation, unsupported capability, a build holding the dev layer, a local-only deploy key, an archive holding dev sessions or dev-minted credentials, or dev identity beside a managed installation. |
| 130 / 143 | SIGINT / SIGTERM after owned children stop and private files recover. |

Release keeps 0 success, 1 BLOCKED receipt, 2 failed argument/source/artifact validation. Independent declared commands preserve their child's exit status and signal conventions; wrapper validation uses the new CLI codes. An error is never success with a warning. Check is structural; doctor is environment-dependent; neither claims app acceptance or remote health.

## Local sign-in and state

Local development uses rer dev v2. Setup builds, migrates, briefly starts the
app and prepares the real first owner, then stops its temporary runtime.
Repeated setup preserves the owner, data and native password credentials.
Open dev's private `RER_OPEN` URL for automatic owner entry; no mailbox or
printed sign-in link is involved. The explicit development mail transport
validates and suppresses visitor and teammate email with status `development`.
It stores no messages and serves no mail viewer; no external email is sent.
Hosted email requires the configured real provider, and failures remain explicit.

**No built-in routes or private files on the public listener.** For every seed, nothing the local runtime serves under `/cdn-cgi/*` (Wrangler's and the Cloudflare Vite plugin's Local Explorer, the scheduled and email trigger handlers, the R2 and platform proxies) answers on the port a person or proxy reaches, and neither do the checkout's private folders (`.rer`, `.seed`, `.wrangler`, `.dev.vars*`) or export archives (the `exports/` folder and any `*.rer` file). rer starts every runtime with `X_LOCAL_EXPLORER=false`, setup's temporary app runs without trigger handlers (preview's runtime has them only when the project declares Cron Triggers, on the internal port), rer's public listener answers 404 for those paths, and rer's scheduler calls the runtime's internal port. `pnpm exec rer export` refuses an `--output` the dev server would still serve: save archives at a normalized path inside the checkout's `exports/` (`exports/x.rer`, `./exports/x.rer` or an absolute path there), or at an absolute path outside the checkout. Outputs elsewhere in the checkout are refused, including public, source and build folders; so are `..` segments, unsafe symlinks and any path served by the app. Upstream connection failures, including while setup is building its app, answer the same 404 as private-path refusals. All three local runtimes (dev, preview and setup) bind a separate loopback port behind this same proxy. Every seed build must use `archiveOutputGuard()` from the shared onboarding `archive-output.mjs` in its Vite plugins: after public assets and bundles are written, it refuses `*.rer` files and portability archive manifests under any filename, including custom output directories. The shared lifecycle also checks `dist/` before setup can start its temporary app. A seed's Vite config limits `server.fs.allow` to the folders the app is built from (`src`, `public`, `node_modules`) so nothing else in the checkout is served.

**Native dev identity and the key gate.** HappyToHelp retains its own accounts,
sessions, passwords, roles and first-owner transaction. A local-only wrapper
exchanges the per-checkout `RER_DEV_KEY` for a dev gate cookie before issuing a
native dev session. Dev sessions require the gate on each request, so a rewritten
loopback Host alone never admits them. A runtime without the private local key
exposes none of this surface. Setup retains the key across reruns; reset removes
it. The key stays private under `.rer/local/` and never becomes a deploy binding.
Production output excludes the wrapper and its marker; the build rejects a leak.
Export excludes dev sessions and credentials minted through them. Native hosted
email links retain explicit single-use confirmation POSTs. No static session,
sample owner or mail substitute is introduced.

Canonical local durable data is `.wrangler/state/`, outside dist/build output. CLI bookkeeping is `.rer/local/`; installer drafts/logs are `.seed/installer/`; private settings default to `.dev.vars` (0600). An existing seed may explicitly inventory a retained private file such as `data/local-secrets.json`; it has the same custody/reset rules. Directories containing secrets are 0700. No symlink/traversal/overlap with source, exports, dependencies or build outputs is accepted as state. Preserve and report ambiguous legacy state; never silently adopt/move/delete it. Setup reruns keep exact existing private bytes, permissions and owner/data; builds preserve interrupted-operation recovery and credential exclusion.

Reset acquires the shared local lock and refuses while dev/installer/transfer owns the state. It lists exactly the removal inventory before confirmation. `--non-interactive` requires `--yes`; neither JSON nor non-interactive implies consent. Remove local D1/R2/KV/DO state, owners/sessions, `.rer/local/` (including the dev key, so earlier gate cookies stop working), `.seed/installer/`, and declared generated private settings/backups only. Keep Git/source/lockfiles, `rer-setup.json`, edition baselines, dependencies, owner export archives and `.rer/deploy/` receipts. Do not remove a broad `.wrangler`, `.rer`, `data` or checkout directory. A second confirmed reset succeeds with an empty inventory. A fresh setup then creates a fresh owner, with no previous domain rows or messages.

## First-run setup at /setup

Every first-party seed serves its owner's first-run setup at `/setup`: while setup is unfinished the signed-in owner completes it there (and any app route sends the owner to it); once finished, `/setup` takes the owner into the app (or to settings for later changes). Signed-out visitors are sent to sign-in and back. `pnpm exec rer setup`, dev identity and native sign-in return the owner to `/setup` until first-run is complete, and the README/AGENTS name it (owner, 10 Oct 2026).

First-run completion is stored durably; a setup rerun does not clear it.

## Seed theme

A first-party seed may declare one installer theme at `public/rer-theme.css`,
using the supported `:root` `--rer-*` tokens and self-hosted `@font-face` rules.
The seed descriptor names it with `theme: 'public/rer-theme.css'`; its colours
and served font files must satisfy the installer validation. Native identity and
Setup pages retain their existing product theme. The package exposes installer
integration through `@runeditrun/rer/operator-installer`.

## Hosted assets and deploy identity

`pnpm exec rer deploy` uploads `dist/client/` behind the Worker (`assets.run_worker_first`), so the Worker sees every request first and a built file reaches the browser only when the Worker hands it to `env.ASSETS`. Make `staticAssetResponse(request, env)` from Base's `foundation/runtime/static-assets.ts` (in an edition, `src/base/static-assets.ts`) the first thing the Worker entry's `fetch` does, and return its answer when it is not null. It answers GET and HEAD for paths with a file extension from `env.ASSETS` and returns null on a miss, so app routes and documents keep their own handling; it never looks up dot paths (`.rer`, `.seed`, `.well-known`, `.dev.vars`), `/exports/`, `/__dev/` or `*.rer`. Declare `ASSETS?: Fetcher` in the seed's bindings type; TypeScript rejects the call until the type shares it.

Answer `/health` with `deploymentHealth(env)` from `foundation/runtime/deployment-health.ts` (`src/base/deployment-health.ts`): `{ok: true, deployment: {sourceSha, fingerprint, versionId}}` from the `RER_DEPLOY_SOURCE`, `RER_DEPLOY_FINGERPRINT` and `RER_VERSION` bindings the deploy kit sets. Spread it into a body that carries other fields (`{status: 'ok', ...deploymentHealth(env)}`) and run any readiness check first. Declare `RER_DEPLOY_SOURCE?: string`, `RER_DEPLOY_FINGERPRINT?: string` and `RER_VERSION?: { id: string }` in the bindings type too. `pnpm exec rer deploy` compares these three values with what it just deployed and exits 1 when they differ.

Run `pnpm exec rer verify` after updating the exact `@runeditrun/rer` pin to a version that contains the check. After the seed's own verification it serves `dist/` in Miniflare from the seed's own Wrangler, with the deploy kit's asset setting, the deploy declaration's vars and origin variable (at an https origin), stand-in secrets and a generated deploy identity, applies the D1 migrations, then requests every built file except HTML documents and dot paths, every same-origin file linked from the built HTML and the home page, and `/health`. It needs no network and no account. The declaration is the one `ownerDeploy` reads (`deploy.json`); a seed with its own deploy command names its file with the `commandAdapter` option `deployDeclaration` (for example `deployDeclaration: 'owner-deployment.json'`). `pnpm exec rer verify` includes the hosted-output check.

## Pins, aliases and responsibility

Required first-party pins: `.node-version` is `22.20.0`; `package.json.engines.node` is `22.20.0`; `packageManager` is `pnpm@10.12.4`. Keep any `.nvmrc`, CI/bootstrap and documentation declarations consistent. These are today's tested Base cloud-bootstrap/foundation pins, not a requirement for independent projects. Commands that execute project work select the exact Node pin, using an exact matching installed runtime or a checksum-verified user-cache copy at `~/.rer/node/node-vVERSION-PLATFORM-ARCH/`; when needed on supported platforms, the runner retrieves the official release and verifies its SHA-256 against `SHASUMS256.txt`. The runner never changes global Node installations. `RER_NODE_AUTO=0` opts out; a failure reports the repair invocation `npm exec --yes --package=node@VERSION -- node SCRIPT VERB --cwd PROJECT`. Help, check, describe, doctor and stop do not select or acquire Node. Refresh lockfiles legitimately for pnpm 10 and retain the reviewed native-build allowlist (esbuild/workerd where needed).

Pin the shared command implementation as an exact `@runeditrun/rer` devDependency locked in `pnpm-lock.yaml`. Install with `pnpm install --frozen-lockfile`, then invoke `pnpm exec rer VERB`. Adapters import the package exports; application Base copies retain their independently reviewed origin records.

Package scripts for `setup dev preview build verify reset deploy export import release doctor describe check` use the package dispatcher: each value is the OPERATIONS argv (`["rer",VERB]`) joined by single spaces. Invoke them as `pnpm run VERB -- FLAGS`; use `pnpm run deploy`, not pnpm's built-in deploy. Never define a package `install` lifecycle script to launch `pnpm exec rer install`; `pnpm install --frozen-lockfile` is the dependency action. Provide `deps` (the same dispatcher with `install`) and `rer` (the dispatcher alone). Internal adapter targets use distinct names/files to prevent alias recursion.

Use OPERATIONS v2, preserving environmentSources and loops. Its `commands` declares every required verb with real argv, inputs and effects; inspector/CLI verbs still perform only their documented inspection. Opt in to the first-party profile with `seedContract:{version:1,profile:"first-party",adapter:"scripts/installer/local.mjs"}`. This is a small operations extension, not another configuration file or a second setup schema. An explicit `pnpm exec rer check --profile first-party` must enforce the profile even if its marker has been deleted; this flag is additional to check's common flags. References and generation tests must also require the marker. No package/edition presence alone makes an independent project first-party.

Each seed adapter exports `commandAdapter` alongside its installer integration:
declarative hooks and targets for dependencies, build, migrations, start,
health, owner, sign-in, verification, deploy and portability; state/settings
removal inventory; and the selected manifest. Reuse `localInstaller`,
`onboarding/commands.mjs` and `onboarding/local/` guarantees. The CLI owns
argument validation, profile resolution, locks/recovery, sequencing, pins,
captured/redacted child execution, health readiness, confirmation, JSON/exit
mapping and cleanup. The seed owns product answers, real resource
names/migrations, approved auth overrides, data policy and actual
build/dev/verify targets.

A seed whose build rewrites tracked-looking files that are not source (generated migrations, widget or download assets, route trees, delivery output) lists them in `commandAdapter.generatedOutputs`: project-relative files or directories, for example `generatedOutputs: ['.generated', 'public/widget.js']`. Preview's fixed-build receipt and its during-build check ignore exactly those paths and nothing else. A real source edited during the build is still refused with its file named, and an undeclared file the build rewrites is refused with a message naming it and this declaration. Without the declaration nothing changes.

Every first-party adapter selects one root `rer-setup.json` manifest. The CLI,
installer and deploy producer share its field selection and digest rules; do not
create a second setup schema. Every first-party seed proves local
export/import/export equivalence across all supported resources. Local
export/import must cover every supported resource. Remote transfer is optional
and requires complete resource coverage; an unsupported remote target fails
with exit 4 and names the missing capability.

Independent projects without an adapter use `OPERATIONS.json` v2 `commands.NAME.argv`, `inputs`, effects, environmentSources and loops. Execute argv directly with shell false in the checkout, forwarding explicit arguments after `--` unchanged; never translate them into Cloudflare/pnpm/Base behavior. Common wrapper flags are consumed before the separator. No declared verb means exit 4, not an inferred command/fallback. Existing v1 inspection remains supported. Do not infer runnable commands from the platform registration descriptor's shell strings. No global pins, aliases, installer, state layout or required verb set is imposed on independent projects; runtime requirements remain project-owned. Independent check still validates the actual declaration and refuses missing/outside-checkout inputs.

## Acceptance clauses

- SC-01: required verbs, real flags, thin self-contained dispatcher and truthful describe output.
- SC-02: exact pins and public aliases, no lifecycle/built-in collision or recursion.
- SC-03: real manifest-driven setup, private custody, idempotent owner and failure recovery. Validate the selected dependency graph before effects; claim the native owner then pull-link selected dependencies. Declared idp claim mode completes the atomic provider owner grant before readiness. Blank optional dependencies preserve standalone email-link setup; unchanged links need no new approval. Link approvals are private, exact-origin and callback-set, one-use files, deleted after successful use. Multiple interfaces use the private `RER_LINK_TOKEN_FILES` interface-to-file map; each approval is validated before effects.
- SC-04: managed foreground development/HMR and fixed production preview, requested origin, health-gated ready output, intact public-input/output build reuse and descendant cleanup.
- SC-05: rer dev v2 key-gated entry over native owner/session authority; development mail suppressed without storage, a viewer or external sending; no `/cdn-cgi/*` or private checkout paths on the public listener; local-only identity excluded from production output and deployment bindings; dev sessions and dev-minted credentials excluded from archives. Copied Base sources remain byte-exact to their reviewed pin. Native password and hosted email-link flows remain supported.
- SC-06: confirmed, contained, local-only reset and clean subsequent setup.
- SC-07: real build/verify and production preview, owner-account deploy/dry-run and unchanged release producer/receipt/exits; bounded expensive execution joins the shared queue. After deployment readiness, link selected dependencies to the real deployed origin using its own approval. Dry-run has no link effect; no additional public verb is introduced.
- SC-08: complete local export/import, integrity, empty-destination/confirmation and credential exclusions.
- SC-09: structural check rejects omissions, doctor names missing inputs, stable JSON and exits.
- SC-10: optional independent execution uses only declared argv, preserves child outcomes and forces no stack.
- SC-13: package mode pins `@runeditrun/rer` exactly, locks the installed version, removes the old vendored command trees and invokes the installed package throughout adapters, aliases, workflows and tests.

## Managed servers and bounded work

Dev starts a managed background server by default; `--foreground` keeps its
command active and lets Ctrl-C stop its children. Preview stays in the foreground.
Both support explicit stop and idle-timeout controls. A
compatible repeated invocation verifies the registered live application,
emits its ready URL and exits 0 without another build/sign-in. They
share one canonical-checkout slot;
symlink/cwd aliases share it, distinct worktrees do not. The other mode or an
explicitly conflicting host/port/timeout, or a different `--login` choice, refuses
with exit 4 and the correct stop instruction; `--as` only changes the printed
`RER_OPEN`, so it reuses a running dev server. Mode changes require stop then start. `--stop` is idempotent when
absent, needs no tools/settings/build, refuses another live mode, and rejects
start-only flags before effects.

Idle timeout precedence: explicit `--idle-timeout`, `RER_SERVER_IDLE_SECONDS`,
then 43200 seconds (12 hours). Positive integers only. The clock starts at readiness.
Application HTTP and assets activity reset it; active requests/streams
prevent expiry. Internal management/readiness probes and HMR control
traffic alone do not count. Real application WebSocket data messages do count.

Private registry: OS home `~/.rer/servers`, with `RER_SERVERS_DIR` override.
Combined cap: 10 servers per computer by default. Set `RER_SERVER_LIMIT=N`
(positive integer) to change it. Load is no guard by default; a fleet sets
`RER_SERVERS_LOAD_THRESHOLD=N` (the 1-minute load) in its own environment. Atomic reservations
precede ports/heavy work and count toward capacity. A limit set explicitly by a
running server's person holds every start (the lowest one wins); a recorded
default never lowers the cap. At capacity refuse 4 with a plain message giving
the count and the limit, each running server's checkout, mode, port and exact
stop command, and how to raise the limit; a load refusal states the load, the
threshold and how to override it. A
server is stopped only by its own checkout (explicit stop, idle timeout, signal),
never to make room for another, in any mode. A run that declares itself a test
or CI journey with `RER_SERVER_JOURNEY=1`, on its own free port, is neither
counted nor refused by the cap. Verify lifetime/process identities and health; preserve
foreign/unverifiable processes. Cleanup all owned descendants and private/state
custody before freeing records/ports; old generations cannot remove replacements.
Explicit stop/idle exit 0; child failure remains nonzero; INT/TERM retain
130/143. Starting duplicates wait boundedly and never announce a failing startup.

Preview serves real built Worker/assets/routes/private streams/404 with exactly
one workerd, no Vite/HMR, source/config watcher or automatic rebuild. Queue one
cache-miss build; reuse only when actual dirty/untracked/shared/copied runtime,
config/lock/tool inputs and intact output bytes match a nonsecret `.rer/local`
receipt. Never hash private settings. Missing/corrupt/interrupted output or an
input change during build invalidates certification. Require ordinary prior
setup/migrations; missing prerequisites name `pnpm exec rer setup` and exit 3. Preserve
private bytes/modes, owner, origin overrides and canonical `.wrangler/state`
D1/R2/KV/DO. Verify real health before ready. Dev prints `RER_OPEN` for native
owner entry; preview prints the app address for native password sign-in.

Heavy install/build/verify targets, directly documented browser suites and
indirect/generated scripts use the exported dependency-free Base job queue module.
Setup uses the shared RER installer lifecycle for build, migrations and a
bounded temporary runtime. Dev/preview queue finite preparation; managed serving uses the server
cap and never outlives a released job as its descendant. Deploy queues local
build/validation including zero-provider dry run; release queues expensive steps
without changing its producer/parser/receipt/exits except adding `--no-queue`.
Export/import queues local resource runtime work. Help/describe/check/doctor,
stop and reset inventory/removal stay light.

Labels identify the declared project, initiating verb/phase and safe checkout
identity without credential remotes or secrets. Status/waits are human progress,
valid JSON events or redacted stderr. Human queue waits report immediately with
a reason and numeric one-based position, then refresh about every 15 seconds.
Package mode has no queue status command; a waiting command reports its live position.
Nested commands share only validated live
owned membership, never a boolean bypass; slots=1 works. Queue cancellation
removes pending work; admitted cancellation stops owned children and restores
private files before releasing the lease. Queue/state locks cannot deadlock.
Original-caller `CI=true` skips queue admission. Heavy-capable verbs alone accept
`--no-queue`, only with original `CI=true`; other use fails 2 before effects.
`CI=false`/unset queue. Synthesized install child CI cannot change the original
policy. Independent commands preserve their declared argv/stack and outcomes.

- SC-11: canonical managed foreground server lifecycle, real request activity,
  exact idle/stop/cap defaults, identity-safe crash recovery and deterministic
  cross-process admission, with complete cleanup before reuse.
- SC-12: real queue coverage of every bounded expensive path, portable
  dependency-free sources, safe labels/output, validated nested membership,
  original CI policy, cancellation/custody and light inspection boundaries.

## First-party agent instructions and current entry points

Every first-party `AGENTS.md` and `CLAUDE.md` opens with a `Run it locally`
section for the checkout it governs. From a runnable edition root, show the
current command sequence:

```sh
pnpm install --frozen-lockfile
pnpm exec rer setup --owner-email you@example.com
pnpm exec rer dev --foreground
```

Explain how to provide the real owner email through setup's approved inputs.
Dev prints `RER_OPEN`; the person opens it to enter automatically as the native
owner. Visitor and teammate email is suppressed without storage or external
sending. Preview uses the existing native password. Keep entry URLs private
and preserve the actual local auth and data requirements. Stop `dev` with
`pnpm exec rer dev --stop` or Ctrl-C, and stop `preview` with
`pnpm exec rer preview --stop` before build or verification. The opening
section also shows the current verification, reset, transfer, deployment and
description commands:

```sh
pnpm exec rer verify
pnpm exec rer reset --yes
pnpm exec rer export --output exports/installation.rer
pnpm exec rer import --input exports/installation.rer --yes
pnpm exec rer deploy
pnpm exec rer describe
```

Document the actual flags, effects and cautions for each operation.

Base's root guide directs maintainers into its runnable first-party seed.
Composed foundation input becomes runnable after composition, and its agent
guide runs from that edition checkout. Describe managed foreground server
behavior and compatible repeat invocations according to the current command
contract.

Maintain first-party documents and entry points as current guidance. Remove
superseded setup, dev, install, reset, deploy and verify wrappers and
instructions, including descriptions of earlier flows. Keep the commands and
behavior the RER CLI actually uses, and retain real product, architecture,
authentication, data, security and deployment requirements. RER adoption stays
optional for independently authored projects.
