# Retained acceptance boundaries

These retained command requirements and holds supplement CONTRACT.md. They do not change any clause status.

## Command journeys

`tests/journeys/installer-nightly.mjs` drives a fresh clone through the installed pinned `@runeditrun/rer` launcher: structural
check, `rer install` with frozen dependencies, manifest setup and teardown, foreground
dev with `RER_READY`, private `RER_OPEN` entry as the native owner, key-gate
refusals, owner/data/private-settings retention,
active/unconfirmed reset refusal, private export/import, confirmed reset and
fresh setup. It replaces the standalone installer qualification. Native auth,
tenant, secrets, destructive operations and restore require actual runtime proof.
A hosted first claim derives the owner's name from the actual configured owner
email and lands email sign-in on Setup. A `workers.dev` website defaults to
**My workspace** regardless of the owner email; an explicitly chosen native
workspace name takes precedence. An infrastructure hostname never becomes the
business name. A real separate-origin widget page and the app origin must both work after
saving the website origin. Normal deployment removal must remove an installation
with an uploaded attachment in one pass through rer, with absence readback; manual
bucket emptying is not the person-facing removal path.

## Acceptance holds

Accessibility is **FAIL / confirmed owner HOLD**; keep the bounded checker
limitations in [the accessibility audit](docs/ACCESSIBILITY-AUDIT-2026-09-30.md).
Timed activation and paid-provider execution remain unqualified. `rer export`
archives carry Durable Object storage with schema and digest; full Base-data
equivalence (resizable ArrayBuffer preservation) remains held.
[HANDOVER.md](HANDOVER.md#acceptance-boundaries) records those obligations and the
owner's import equality, native-auth and bounded-HTTPS decisions.
