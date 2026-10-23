# Run it locally

Use Node **22.20.0** and pnpm **10.12.4**, from the checkout root. `rer dev`
automatically uses its local origin and generates a private native owner password.
For an explicit website, email or password, use the optional
[private-answer setup](docs/INSTALLER.md#private-setup-answers). Keep secrets in
that file, never command arguments.

```sh
pnpm install --frozen-lockfile
pnpm exec rer dev --foreground
```

Wait for `RER_READY`, then open `RER_OPEN` to enter as the real local owner.
The local dev entry uses the native owner, sessions and permissions and opens
**Setup**. Local visitor and teammate mail is suppressed without storage or
external sending. Keep the local entry URL private. Stop dev with Ctrl+C before verification or data operations.

```sh
pnpm exec rer verify
pnpm exec rer reset --yes
pnpm exec rer export --output exports/support.rer
pnpm exec rer import --input exports/support.rer --yes
pnpm exec rer deploy --dry-run
pnpm exec rer deploy --environment production
pnpm exec rer describe
```

Reset erases the printed local inventory; export your data **before** resetting
if you need it. Import requires an empty destination and retains native owners.
Deploy requires explicit owner authorization and private account configuration.
`--dry-run` needs the Cloudflare account credentials too: without them it refuses
before any provider request. With them it builds locally and makes only read-only
Cloudflare GET requests (the account's Workers subdomain and the Worker's settings
and secret names), validates the private mail inputs when supplied and refuses
when a required secret is neither held nor supplied. It sends no mail and changes
no provider resources.
See [OPERATIONS.md](OPERATIONS.md) for state, deployment and restore requirements.

## Working on HappyToHelp

Read [CONTRACT.md](CONTRACT.md), [ACCEPTANCE.md](ACCEPTANCE.md) and
[HANDOVER.md](HANDOVER.md) for requirements, proof boundaries and architecture.
Use the TanStack Start/React/Hono/TypeScript Worker runtime. The rer adapter is
`scripts/installer/local.mjs`; internal `build:app`, `build:assets` and `verify:app`
are its execution targets. Agents start the application through rer.

The site's `/docs` pages are built from Markdown listed in `docs/site.json`.
List each root or docs Markdown file there as published or GitHub-only. Modules
under `src/modules` own reusable capabilities through ordinary imports. Split
files by responsibility and remove replaced code.

Preserve native passwords, message admission/revisions, tenant isolation,
permissions, knowledge publication, prior data and local-agent authority.
Unknown paid or remote outcomes remain unknown and never trigger automatic
replay. Provider fixtures belong only in tests; no mock application behavior or
silent-success fallback. Never commit credentials, local state or customer data.

New workspaces are provisioned only through `src/modules/management/provisioning`
(starter assistant, mailbox, installation sender); Setup observations live in
`src/modules/management/activation`. Run touched tests and the typecheck. Full verification and browser checks belong
on the designated remote runner; keep local, hosted and configured-provider
results distinct. After tracked edits, run `pnpm run source:lock`, then
`pnpm run source:check`. Preserve the selected byte-exact Base sources.

## Test budget

The owner cap is **200 effective tests**. There is no established JSON budget
schema in this edition; this section records the cap until one is adopted.
Run `node scripts/count-tests.mjs` for the counts, `--json` for every counted
location, or `--check` to fail when the cap is exceeded or a registration loop
cannot be resolved. The inventory includes nightly and live tests even when they
are not run on every push; package-script aliases do not add tests.

The counter parses source without importing tests. It expands registration loops
and replaces the Move-in, Connections, Reports, historical-upgrade and erasure
group wrappers with their registered scenarios/steps. A data-driven matrix
inside one registration counts once only when all inputs prove the same behavior.
Standalone assertion scripts count their named `checks.push` checkpoints, or one
flow when no checkpoints are declared. Assertions inside a flow are not separate
tests. Helper calls do not excuse combining unrelated behaviors: review their
meaning as well as the mechanical inventory, and split unrelated behaviors.

Keep public-door integration checks for high-stakes or user-visible behavior.
Delete copy, hash, version, file/environment-list, threshold, static-page and
configuration-shape pins; do not weaken security, custody, erasure, restore or
money assertions to meet the cap. A count over 200 remains over budget, never a
claim of compliance. Do not run tests as part of build or deployment.
