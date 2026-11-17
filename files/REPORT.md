# HappyToHelp legacy import: synthetic source fidelity

Tag: `hh-import-legacy-fidelity-1`. Repository: `just-every/run-happytohelp`. Product branch: `cloud/hh-import-legacy-fidelity-1`. Product SHA: `ebeabafef8a47e6a04d89f9816583096e9a4d63f`. Publication and exact-SHA CI outcomes are recorded in `publication.json` and `ci-runs.json`. No PR is required by this repository's branch landing contract; the fleet lands the branch after its independent gates.

This is synthetic qualification. It does not establish production migration readiness, a real export's completeness, or customer adoption. The independent Opus data-fidelity and privacy gates were not run by this builder.

## Plan and execution

The full initial plan is in `PLAN.md`. The completed work follows its eight stages:

1. Read current main, the repository instructions, contract, acceptance views, handover and existing importer/exporter/fixture infrastructure. Preserve newer fixes. Start at main `b2b9bc602a73feb542017bca8a46529f68b631c4`; publish the first real save, then merge updated main `bb70a042` without rewriting published history.
2. Provision a new synthetic-only MySQL 8.0.46 container on an internal Docker network. Create a unique database and SELECT-only exporter account inside the existing test. Seed generated SQL in the current 53-table, 580-column legacy schema. Use two active synthetic tenants, Paper Lantern and Orbit Repairs; exercise deleted contacts/projects as SQL mutations. The proposed larger fixture volumes were not treated as observed legacy counts. Actual counts and null coverage are reported for every field.
3. Run the existing public snapshot exporter, local `attachments --objects-dir`, both public importer transports, read-only plans and explicit local applies. Use separate empty migrated D1/R2 states for JSON and package imports. No replacement serializer, importer, application mock, remote Wrangler import, S3 fetch or paid provider call was used.
4. Reproduce source-shape faults, fix supported mappings, add content-free field/target-schema dispositions and classify every baseline column plus the two exporter enrichments. See `FIELD-MATRIX.md` and `field-matrix.json`.
5. Exercise replay, committed-boundary interruption/resume, source/native conflict refusal, delta changes, soft-delete controls, erasure fences and held work using existing helpers. Preserve public assets when deleting a contact's private files.
6. Read native inbox/transcript/authorship/notes/contact/knowledge/saved-reply/settings/file routes through the real emitted Worker and local D1/R2. Check private denial and legitimate public images separately. Use the actual `rer dev` application and its generated owner for the browser proof at 1440 and 390.
7. Separately run the existing mounted historical-adoption workflow with current owner session, step-up, stored v2 approval and exact manifest SHA. Exercise real stop/restart and replay, not a caller-supplied adoption profile. Also adopt the actual SQL-exported package through `rer dev`.
8. Run touched regressions, typecheck, first-party checks, contract regeneration/check and source lock/check. Keep generated acceptance/claim views out of the product candidate. Push the named branch, inspect exact-SHA Verify and return this report packet on the separate evidence branch.

## Actual counts and outcomes

The completed public-command journey passed in **440.889 seconds** (`deletion-complete-export.log`). Source reconciliation is explicit in `source-reconciliation.json`:

| Inventory | Actual |
|---|---:|
| Source tables / baseline columns | 53 / 580 |
| Additional exporter enrichment fields | 2 |
| Generated SQL rows | 154 |
| Distinct exported source rows | 132 |
| Source rows with native targets | 84 |
| Archive-only source rows | 48 |
| Rows omitted before export, never archived | 22 |
| Scoped exported rows, including two shared-context source duplicates | 134 |
| Generated attachment objects / source pivots | 11 / 17 |
| Native tables compared between independent transport states | 24 |

The 580 baseline field policies are 152 native, 71 normalized, 34 control/custody, 176 archive-only and 147 omitted before export. These are conditional field policies, not 580 claims of equivalent native functionality. Runtime field outcomes record eligible, held and deleted rows separately; nullable coverage is explicit rather than inferred. Schema drift or an unreviewed source field fails the baseline classification. Mapping context is never counted as another set of imported source rows.

Per-project source rows were 68 and 66; mapped target counts were 56 and 55. Replaying either exact JSON or package artifact applied **zero** new source rows and uploaded no new objects. `results.json` includes the actual replay, delta, retirement, interruption and conflict results, plus the canonical hashes for the 24 compared native tables. D1/R2 credential scans use the existing fixture infrastructure. All object decisions, source pivot identities, SHA-256 digests and held relationships are in `object-dispositions.json`.

The native CLI state contains two projects, four contacts, four conversations, eight visible messages, two private notes, six categories, six articles, two usable authored saved replies, two native message attachments and five file-door records. Other eligible history, inert local execution records and billing custody are counted in `results.json`; they are not active jobs or provider successes.

## Findings and fixes

| Finding | Before / measured fault | Candidate behavior and evidence |
|---|---|---|
| F1, nullable saved-reply author | Public CLI planning failed the whole export at `macros.created_by_id`; `null-author-before.log` records the actual failure. | `src/modules/legacy-import/map-knowledge.ts` uses the already-approved historical custodian before required-text conversion. `adoption/historical.ts` records unknown original authors explicitly. CLI has no approved custodian and holds/archives only that reply with a field reason. Mounted and browser adoption show the unknown-author reply operational; no guessed source account is created. |
| F2, required native choices | SQL `website=NULL`, absent explicit AI model and absent mail-domain choice cannot supply native intent. | Public exporter/importer diagnostics are asserted independently. The supported fixture supplies an explicit model and synthetic origin. A separate `--defer-mail-domain` package applies with inbound address null and email disabled. No origin, model or mailbox is guessed. |
| F3/F4/F7, silent field loss | Conversation subject had an existing native destination; mapped-row counts did not explain unmapped source columns or absent target-schema properties. | `map-core.ts` maps `metadata.subject` to native subject. `map-project.ts` retains website in existing settings as well as allowed origin; contact timezone also supplies the existing reader's `timezone_name`. `field-rules.ts`, `field-dispositions.ts`, CLI results and Worker metrics expose field names/counts/reasons, export omissions and target-column omissions without source values. |
| F5, multiple media links | One media row cannot represent every source Message pivot; arbitrary pivot order could select a relationship. | `media-links.ts` considers all pivots and selects deterministically. Extra message links have explicit source-identity holds. Event/delegation or incompatible conversation audiences do not become public message files. Both input permutations have identical decisions. Tag/order remain named unsupported native fields. |
| Mounted SQL media closure | A real exporter package with Article pivots paused as invalid scope; source-shaped note media has no `project_id`, unlike a convenient native-shaped fixture. | `worker/context-read.ts` hydrates supported polymorphic parents. `adoption/note-media.ts` derives the note's validated conversation/project and stores private note media with no public message association. The actual SQL package completes through the mounted runner and `rer dev`. |
| F6, lifecycle fidelity | Provider IDs, encrypted collector content and running work are not support capability. | Ready retained markdown is native; omitted encryption/telemetry content is never restored. Other lifecycle details have explicit archive/control dispositions. Devices/grants are revoked, historical AI is disabled and queue counts stay at their pre-import baseline. |
| F8, policy documentation | The module README incorrectly denied an application route; broad access/verification claims obscured the administrative CLI policy. | Moving-in, legacy-export and module docs now identify public entry points, stored approval, the separate CLI policy, explicit choices, holds, source custody and native limitations. |
| F10, historical verification | The source mapper retained verification while historical keys were omitted. | Historical adoption explicitly sets `contacts.is_verified=0`; the source fact remains in private sanitized custody. The administrative CLI intentionally retains source verification. Both outcomes are asserted separately. |
| Measured normalization | Native timestamps are milliseconds and some manual string flags were truthy accidentally. | Actual SQL `2026-11-16T23:59:59.123456Z` retains all six fractional digits in source custody; native timestamp conversion loses 456 microseconds. Missing time normalizes to epoch 0. Manual boolean spellings normalize explicitly; invalid spellings refuse before writes. See `normalization-outcomes.json`. This is not byte-exact temporal fidelity. |

Before the fix, one valid null-author macro aborted the entire plan. After the fix, the CLI imports both projects while explicitly holding their two unknown-author replies, and historical adoption exposes both the authored and unknown-author reply in its native saved-reply list. The old source verification fact is retained privately while its historical native value is zero; CLI verification remains separate.

The initial image-expanded run also exposed a stale test assumption: contact erasure expected all five tenant objects to disappear, although two were legitimate public assets. `tests/legacy-export/resume.mjs` now asserts deletion of the three private objects and retention of the two public ones. The completed journey subsequently passed; this was not a claim that public assets should be erased.

A subsequent actual apply of the SQL-deleted-contact artifact exposed a foreign-key failure: a delegation event still targeted its suppressed job. `archive-only.ts` now follows direct contact dependencies, delegation-event parents, article/category pivots and supported media parents. The same additional applies then succeeded: deleted-contact/project descendants were absent while 68 private source rows remained. Five malformed cases also preserved every D1 row/value/storage type and every R2 object/index/blob digest. Actual outcomes are in `refusal-and-deletion-effects.json`; the original failure is retained in `deleted-contact-before.log`. These checks are now included in the existing exporter journey.

## Explicit unsupported and omitted fields

The complete names, source evidence, fixture/null counts, normalization, custody reason and actual journey association are in the 580-row matrix. Important distinctions:

- Passwords, reset/authentication material, contact keys, omitted nested credential paths, crawler HTML/errors, encrypted telemetry payloads, provider tokens, authorization/pairing/job/debug/log/prompt-plan tables and excluded PAGE_VIEW tracking are **omitted before export and never archived**. The matrix's 147 omitted columns are not source-custody successes.
- Unsupported user/contact profiles and last-seen details; article/category authors and publication timestamps; pivot identity/timestamps/tag/order; plugin authors; dataset refresh/provider/lifecycle details; AI thought state, original unread counts and original last-message controls retain only the reviewed private source custody or rebuild policy. Archive is not native workflow parity.
- Conversation subject is native. Remaining conversation metadata is explicitly partial. Unread/last-message state is rebuilt for imported history; AI execution state is not reactivated.
- Native media has one `message_id`. Additional ordered/tagged Message associations cannot all become native attachments; each unrepresented link has a reason. Private note associations are operational through historical adoption; administrative CLI note-file links remain private source custody/holds.
- Null-author CLI replies need a separate legitimate custodian-selection policy to become operational. The default remains a row hold, not an arbitrary first-owner assignment. Historical adoption already has an approved custodian and is operational.
- Source soft deletion suppresses eligible descendants. The SQL contact/project mutation cases assert both the public plan and actual applies into fresh native states: deleted-contact conversations, notes/messages and context descendants remain absent; a deleted project restores none of the tested project, contact, conversation, message, note, article, category, media, job or job-event rows. The private source journal remains populated. These are backend applies, not a separate browser import of every deletion variant. Physical source absence cannot establish a deletion time or reconstruct missing history. The existing delta helpers exercise exported changes, soft deletion and retirement; this proof does not claim recovery of arbitrary hard-deleted article/category history or invent `deleted_at` columns on those tables.

## Native readers, browser and privacy

`native-readers.json` comes from the real emitted Worker, D1 and R2. It checks native inbox subjects, transcript author/order, UTC milliseconds, ordinary private-note and customer details, categories/articles/drafts, authored saved replies, explicit CLI hold for the unknown author, project/widget/availability settings and exact downloaded bytes. Ordinary signed-out and foreign-contact requests cannot read private transcripts or files. Native assertions separately check public project/article PNG file doors with exact SHA-256 and content type; draft/hidden/private note media stays denied.

`mounted-adoption.json` is the actual prior completed representative mounted journey result, before the final deleted-parent fix. The rebuilt helper rerun and a direct-local retry stalled before business output; they are NOT PASSES for the final candidate. `cloud-runtime-note.txt` names this uncompleted inspected Miniflare/workerd startup prerequisite. The final candidate is independently exercised through the actual `rer dev` mounted runner, owner/session/approval and SQL package, rather than substituting a caller-supplied profile or claiming the stalled helper succeeded. The prior helper result records two process kills, stop fencing, fresh approval reservation recovery, exact-SHA/stale-actor/scope refusals, replay with zero new rows, erasure, no source login activation and unchanged work counts. A legitimate current-member match is disclosed as assignment, not inferred from CLI success. Private note files, including a zero-byte object and a shared note/message pivot, remain private. Historical contact verification is zero while its source value is privately retained.

`rer-dev-adoption-result.json` and `browser-outcomes.json` record the separate actual SQL package adopted by the real local application using its generated owner, normal sign-in, current step-up and stored approval. On final product head `ebeabafef8a47e6a04d89f9816583096e9a4d63f`, a freshly reset test-owned installation completed the actual mounted SQL package with unchanged work counts. Both private note downloads matched their source SHA-256, including the zero-byte file. `browser-outcomes.json` records that candidate head. The browser captures inbox, transcript/private note, customer, knowledge list/category state, published article, draft, saved replies, unknown-author reply, settings, availability and widget settings once at each 1440 and 390 width. Screens are in `screens/`. No new UI surface was introduced. Local browser outbound requests are denied; the synthetic avatar host denial is intentional, not an integration success. Browsers are closed after capture.

Generated source secrets are scanned out of chunks, context, manifests, journals, native stores and logs by the fixture assertions. The report packet is also checked for planted sentinels before publication. Test-owned database and owner credentials, cookies, entry links, environment files and source packages containing private fixture custody are not selected for public evidence. No real account, customer text, production export, original bucket or legacy host was accessed. No live integration was restored.

## Commands and validation scope

- Test-owned MySQL environment loaded privately into `node --test --test-concurrency=1 tests/legacy-export.mjs`: PASS, one existing end-to-end journey, 440.889 seconds. The journey itself invokes `scripts/export-legacy.mjs snapshot`, `attachments --objects-dir`, both public `scripts/import-legacy.mjs` transports and local Wrangler D1 migrations.
- `node --test --test-concurrency=1 --test-name-pattern='^a legacy package is reviewed|^imported storage URLs' tests/journeys/legacy.mjs`: PASS, two affected existing journeys; `legacy-regressions.log`.
- `node --input-type=module` invoking `mountedAdoptionJourney({representative:true})` from `tests/move-in/legacy-adoption-integration/journey.mjs`: prior completed PASS is retained in `mounted-adoption.json` / `mounted-adoption-final.log`; final rebuilt retries stalled before business output and were stopped. The actual RER application provides the final mounted business proof; see its separate result and browser outcomes.
- `rer setup --owner-email fleet@runeditrun.com --answers .local-fidelity/setup.json --non-interactive`, `rer build`, `rer dev --foreground`: actual generated local installation and browser proof, through the required cloud subreaper. Private setup answers and the dev log containing the private owner entry are excluded.
- `pnpm run typecheck`, `pnpm exec rer check --profile first-party`: PASS, actual candidate logs.
- `node src/site/base/contract-docs.mjs write` and `check`: PASS before restoring `ACCEPTANCE.md` and `docs/CLAIMS.md` whole from main. These generated views are intentionally not committed by this builder.
- `pnpm run source:lock`, then `pnpm run source:check`: PASS after tracked source edits. The source lock is committed with `CONTRACT.md`.

CI is the full wall and must be read from the exact product SHA in `ci-runs.json`; local touched checks do not stand in for it. The fleet publication scan and independent gates remain external landing work. Evidence publication is report custody, not product acceptance or landing.

## Contract and external limits

`MIGRATION-001` remains **PARTIAL**. Its evidence/gap text is updated for the source-shaped synthetic proof; no clause status or live-qualification points are promoted. The generated contract views are the Mac lander's responsibility.

No synthetic run can establish current production schema/deployed revision, real per-company counts, original hard-deleted history, real attachment completeness, actual domain/mail/model choices, live integration/plugin compatibility, production backlog or days of customer-support use. Future real-data qualification remains BLOCKED-EXTERNAL on an owner-supplied appropriately sanitized private export and authorized attachment bytes. That is not a request for production access and is not a blocker to this synthetic branch.

The independent Opus data-fidelity and privacy gates and fleet publication scan have not been awarded by this builder. Any further product surface or CLI custodian-selection policy needs its own owner allocation. All local processes started for this proof are stopped after capture; generated artifacts and the product clone remain available for recovery and review.

## Candidate source locations

- `src/modules/legacy-import/map-knowledge.ts:48`
- `src/modules/legacy-import/adoption/historical.ts:14`
- `src/modules/legacy-import/map-core.ts:19`
- `src/modules/legacy-import/map-project.ts:21`
- `src/modules/legacy-import/media-links.ts:7`
- `src/modules/legacy-import/adoption/note-media.ts:10`
- `src/modules/legacy-import/worker/context-read.ts:13`
- `src/modules/legacy-import/field-dispositions.ts:12`
- `src/modules/legacy-import/source-references.ts:18`
- `tests/legacy-export.mjs:20`
- `tests/legacy-export/field-matrix.mjs:19`
- `tests/legacy-export/native-readers.mjs:11`
- `tests/move-in/legacy-adoption-integration/journey.mjs:18`
