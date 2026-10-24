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
NATIVE-001 requires a zero-outbound dry-run and a separately started read-only provider preflight with owner consent and a scoped token. The separate preflight still needs implementation and live qualification.
`--dry-run` validates and builds locally without provider requests or credentials.
It sends no mail and changes no provider resources. Its receipt explicitly leaves
remote resources, credential validity and existing secret bindings unchecked;
a real deployment checks those before changing resources.
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
