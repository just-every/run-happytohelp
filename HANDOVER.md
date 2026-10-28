# Maintainer handover

Start with [AGENTS.md](AGENTS.md#run-it-locally): use `pnpm exec rer`
for install, setup with private manifest answers/owner email, foreground dev,
automatic local owner entry and verification. [Operations](OPERATIONS.md) documents
reset, private archives, restore and owner-account deployment. Inspect actual commands
with `describe --json`; `check --profile first-party` works before installation.

## Product and current scope

HappyToHelp is the native TypeScript support workspace: React dashboard,
Shadow DOM widget, AI assistance, knowledge, customer context, local-computer
delegation, reviewed imports, resolution feedback, Reports and integrations.
Pricing, billing, waitlist and referrer features are outside this edition.
[CONTRACT.md](CONTRACT.md) defines requirements and [ACCEPTANCE.md](ACCEPTANCE.md)
defines the evidence each needs. The private release line is untagged source;
public publication and owner release approval remain separate.

## Architecture

- `package.json` and `pnpm-lock.yaml` pin `@runeditrun/rer` exactly; `pnpm exec rer` runs that installed command package.
- `scripts/installer/local.mjs` declares native lifecycle/dev/preview/verify,
  owner-account deploy and portability hooks; `native-local.mjs` retains native
  bootstrap and ordinary sign-in. `rer-setup.json` owns setup fields, and
  `scripts/installer/ui/seed.mjs` owns presentation.
- Base onboarding owns private custody, locks, process cleanup, readiness and
  bounded work. Internal `build:app`, `build:assets`, `verify:app` are real adapter
  targets. Build collects immutable migrations, assets and delivery output.
- Setup says "we did these, you approve". First-run setup is one screen
  (`src/ui/native/Setup.tsx`, `src/modules/identity/setup.ts`) that derives the
  workspace name and colour and sends the owner one welcome email through the
  durable send path. `src/modules/management/provisioning` gives every new workspace
  (first owner, signed-in creation, email-verified registration; never a demo) a
  starter assistant as its default visitor assistant, a reply-by-email mailbox when
  `INBOUND_EMAIL_TOKEN` exists and the installation sender until its domain is
  verified. A new conversation is attached to the default assistant only when its
  model's provider key exists (`conversations/routes.ts`), so with no key nothing
  generates and nothing fails. `src/modules/management/activation` observes setup by
  itself (page-initiated `POST .../check {auto:true}`, GET stays pure) and the Setup
  list (`src/ui/native/activation`) shows what needs the owner and what was set.
  `src/modules/management/site-read` reads the customer's website once, writes the
  pages it read as one private, published knowledge source that the assistant's
  knowledge search reads (no article of any status, no provider key), and takes a
  name and a colour. Migration `120_activation_observations.sql` stores
  the structured data an observation saw.
- `src/modules` owns reusable capabilities; native Worker/platform adapters
  integrate through imports. Runtime environment policy remains in
  `scripts/deployment/environment.mjs`, including management integration.
- `deploy.json` declares actual owner-account resources/private secret inputs.
  Local durable data stays in `.wrangler/state`; generated settings and archives
  never belong in source. `docs/site.json` selects Markdown for `/docs`.

## Recorded owner decisions

Native password identity, first-owner experience and prior account/workspace
state are retained (8 October). Native WebP workspace artwork and protected
asset handling remain product capabilities. Manifest answers use the maintained
Base model; copied Base sources stay byte-exact and are never locally patched.

Repeat and undo compare exact business state, including contacts, conversations,
messages, private notes, tags, source links and every other imported business
table (9 October). Only platform counters/sequences, audit and import journals
are excluded. The contact-key `email_digest` is derived memoization: project/
contact links and native email remain exact, and populated digests are validated.
Synthetic 1,000-conversation Zendesk and Intercom datasets qualify local capacity.

Connections use ordinary platform HTTPS fetch through the unchanged Base wire
interface (9 October scoped override). Redirects are refused; timeout, request
and streamed-response bounds remain enforced. This edition does not claim DNS
pinning. Uncertain external outcomes never trigger automatic replay. Preserve
the current contract's outcome/retry policy and tenant/erasure fences.

The approved homepage retains its aqua/ink illustrations, self-hosted Outfit,
hand-drawn wordmark, actual links and reduced-motion behavior. Its ordered
content and drawings are specified by PUBLIC-001 through PUBLIC-005; no price/hosting/provider plug,
compliance claim or unsupported import promise belongs there. Native docs use
the same visual language and current Markdown, with one page heading.

## Acceptance boundaries

Local command/native/browser/fixture results belong to the exact revision
executed. They do not establish hosted installation, configured provider
execution, public release, live Slack or compliance qualification. Jurisdiction,
external-service inventory and FedRAMP acceptance remain unproved.

Accessibility is **FAIL / confirmed owner HOLD**. The checker falsely accepted
four contrast cases; timing/background reliability and unsupported pixels remain
limited. No further checker correction is authorized here. Keep
[the accessibility audit](docs/ACCESSIBILITY-AUDIT-2026-09-30.md) and report no
complete WCAG conformance.

Timed activation recording remains missing; recorder preparation is not a timed
installation. See [recording instructions](tests/live/RECORDING.md) and
[configured cited-answer proof](tests/live/README.md). Hosted operating costs
and paid model execution remain unmeasured; unknown billing is never zero.

Full portable-storage fidelity remains held for Base-data equivalence: the
resizable ArrayBuffer/length-tracking preservation obligation remains unresolved.
Local `rer export` archives now carry Durable Object storage in
`durable_object_snapshots` with schema and digest (scripts/installer/durable-objects.mjs).
No local archive result waives the remaining hold.

## Maintenance and prior-data custody

Keep applied migration names/bytes immutable and follow RELEASE.json's additive
order and backup obligations. Restore D1/R2, import originals/journals, privacy
fences, provenance, rating cycles and encrypted configuration together. Never
reset an installation to upgrade it; validate restoration before switching traffic.
Native owners survive pnpm exec rer setup/import; active sessions, one-use links and
external execution credentials require explicit reconfiguration.

Run touched tests plus typecheck, full verification/browser suites on the remote
runner, and push-triggered CI on the exact merged release head. Refresh locks
through `pnpm run source:lock`; check copies offline with the official tool, and
prove actual origin separately for a Base refresh. A lock or source version is
not acceptance. Preserve concurrent branch work through normal fetch/merge;
no force push, deployment or public release follows from a documentation change.

[Workspace workflows](docs/WORKSPACE-WORKFLOWS.md), [Move in](docs/moving-in.md),
[Reports](docs/reports.md) and [API](docs/api.md) retain feature limits and explicit
owner actions. [Authoring](docs/AUTHORING.md) and [Modules](docs/MODULES.md)
map selected source and capability ownership.
