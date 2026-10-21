# Source origins and licensing

HappyToHelp 0.4.0 is a native port of the original HappyToHelp service. The
original repositories were read, not modified, when the port began on
14 September 2026. This repository contains the retained and ported source; it
does not wrap or require any original PHP, Lambda, MySQL or Python service, and
later changes to the originals do not flow into it.

| Origin | Observed revision | Role in this repository |
| --- | --- | --- |
| Run Edit Run Base template | `d840a75b4c41ddc1feae99695d6632c8b0a451d2` | Initial application template ancestry |
| Run Edit Run Base runtime and authoring | `ac90a05c0549e1f8a65a94f64ac6e2d629f4d5e1` | Retained runtime foundation, edition-authoring tool and operations command |
| Run Edit Run Base onboarding | `390328736c8dae82f87c86e5af4c17cca6bb9c00` | Retained local onboarding source |
| Run Edit Run Base SendGrid email | `d1343b638afd254679bc2b35819fc1d268bb6cc7` | Retained email sender source |
| HappyToHelp main | `7c733f7b4204c7af7b5422953dea1be67d4fca78` | React dashboard and local Node connector; PHP behavior ported to native services |
| HappyToHelp Chat | `bce98c897ec5743dcf243311b6c1886b1057f5e3` | Assistance, replies, monitoring, profiles, evaluation and model orchestration |
| HappyToHelp Widget | `69f6152963d0c89d6495d1adbedb73eab9ce1d62` | React/Shadow DOM widget, now on native transport |
| HappyToHelp Site | `94863c4557cad8bfc02817a6c5a06a54db0fb3f0` | Help Center content model; see [PUBLIC-SOURCE-PROVENANCE.md](PUBLIC-SOURCE-PROVENANCE.md) |
| HappyToHelp Completions | `692aff289c1ad65b3ac35180da523494866eea25` | Ingestion and retrieval behavior, ported; no Python service retained |
| HappyToHelp Plugin SDK | `c41f761c11ee7b45b1cf48e9a0bb0bd2e48fd2e0` | Reusable host/plugin messaging source |

These revisions identify where source came from, not the exact bytes of every
current file; the source lock (`sources.lock.json`) records the current files.
The Base donor repository is private. Its repository identity and immutable
origin revisions remain in `edition.json`, `sources.lock.json` and
`base-copies.json`; they identify provenance and do not imply public donor access.
The edition selects licensed local files under their original capability identities,
with no parent selection. A qualified freeze retains exactly the selected
immutable comparison archives and their dependency closure in `.edition/sources/`,
so source checks and comparisons with those baselines work offline. Unselected
comparison archives are removed during locking. The current candidate retains
all seven selected archives, while runtime qualification remains pending as
recorded below. A future Base update needs a new reviewed immutable pin.
Edition-owned adaptations remain outside records claiming verbatim equality;
original licenses and historical donor attribution remain intact.
`pnpm run source:check` verifies locked local source, selected archives and exact
authoring tool bytes offline. It does not authenticate the remote donor.
Frozen evaluation comparator files are historical test inputs.

## Licensing

The whole repository is MIT licensed; see the root [`LICENSE`](../LICENSE). That
includes the homepage drawings, the setup artwork, the HappyToHelp mark and the dashboard
styles, all of which are first-party. The Claude and Codex names, and their logo
glyphs in `src/ui/dashboard/components/LocalAgentGlyph.jsx` (from Lobe Icons, MIT),
identify supported local tools; no endorsement is implied.

Third-party material keeps its own notice:

- Run Edit Run Base: [`docs/licenses/base-MIT.txt`](licenses/base-MIT.txt).
- Lobe Icons (Claude and Codex logo glyphs): [`docs/licenses/LOBE-ICONS.md`](licenses/LOBE-ICONS.md).
- favcount 1.5.0: MIT notice inline in `src/ui/dashboard/favcount.jsx`.
- Ensemble: `src/modules/ai-support/vendor/ensemble/LICENSE`, with `SOURCE.json`
  and `SOURCE.patch`. Keep the three together. `SOURCE.json` also lists the
  edition-owned overrides (`utils/json_schema.js` preserves `minItems`/`maxItems`
  for grounded `evidence_ids`; `utils/tool_parameter_utils.js` passes explicit
  nulls through required nullable tool parameters; `model_providers/openrouter.js`
  attributes requests to this open-source project), which are not part of the
  recorded upstream patch.
- Outfit, Feather icons, Lucide reply icons and Font Awesome Free: see
  [PUBLIC-SOURCE-PROVENANCE.md](PUBLIC-SOURCE-PROVENANCE.md#third-party-components).
  The dashboard's earlier third-party admin theme (its styles, template entry
  files and avatar masks) and its Feather webfont were removed and replaced by
  first-party styles; `src/ui/dashboard/asset-provenance.json` records each
  removed file's hash and the reason.
- npm dependencies: each package's own licence, as locked in `pnpm-lock.yaml`.

## What a source release must never contain

Do not include `.env`/`.dev.vars` files, `.seed/` installer state, device
credentials, local browser profiles, production customer data, private provider
outputs or runtime state. The local agent packaging script uses an explicit
allowlist (package metadata, README, `bin`, `lib` and optional skills). Test
fixtures are synthetic and marked as such; none is a real customer record or a
paid-provider result.

## Image content credentials

Widget avatar PNGs have their text metadata and C2PA `caBX` content-credential
chunks removed for publication because those chunks contained contact email
metadata. Their original compressed image pixels and rendering chunks are
preserved. The published files no longer carry the original signed C2PA
credentials or certificate chain. The avatar pixels are preserved losslessly. Publication qualification scans the actual export; compressed-byte identities are not permanent test pins.

## Maintained Base copies

Current runtime helpers and the portable CLI come from reviewed Base main. The source manifests record exact origins and mappings; `base-copies.json` records byte and mode equality. Base tests stay in Base. Retained comparison archives contain only selected source.

Run `pnpm run source:check` and `node scripts/edition-authoring/cli.mjs verify-base --offline` to check the local selection. To verify acquisition against an authenticated Base checkout, run the same command with `--base` and the checkout path. These commands establish source integrity; product qualification requires the real local journeys and private CI.

The owner’s 8 October decision retains HappyToHelp native password identity, owner bootstrap and magic-link admission. The local adapter declares APP_ORIGIN and native bindings to Base without introducing SESSION_SECRET. The 16 October local-development decision adds rer dev v2 entry over the real native owner and key-gated dev sessions; hosted authentication retains the native password and email-link flows. Setup uses the shared manifest reader; the native password answer remains private. The product retains protected native artwork. The HappyToHelp local command reference is edition-owned so its native-identity archive policy stays accurate.

Base owns signed delivery preparation and bounded attempts. HappyToHelp automatically retries only HTTP 429 within Base’s four-attempt policy; HTTP 5xx, 408, timeouts and redirects stay uncertain and are never automatically replayed. The edition-owned owner/admin resend action requeues an uncertain webhook with its original ID and body after current authority, tenant, destination and erasure checks, retaining all attempts and an actor/time/target audit. It does not reset Base’s retry budget: an exhausted delivery receives one extra claim per explicit approval and no automatic retry. Copied Base source and immutable delivery policy remain unchanged. Receivers must deduplicate the logical webhook ID. Ordinary HTTPS fetch is bounded but does not claim DNS pinning.

Local archives retain domain rows, native identities/password hashes and FILES objects. Live sessions, external credentials, verification secrets, delegation grants and local-computer pairing/execution records are excluded. Reconfigure those settings after restore. Archives are private backups and do not carry transient Durable Object connections.

The Zendesk and Intercom readers are edition-owned ports with synthetic format qualification; no real export or live Slack acceptance is asserted. The guide and registry describe that boundary. Source, hosted acceptance and owner publication are separate.
