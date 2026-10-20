# Reusable source capabilities

Modules are selected source, with ordinary edition integration. The paths remain
where the product authors edit them. Every capability has module.json metadata;
edition.json records this application's actual selection. The table identifies
portable entry points and the integration work they require. Full application
routes additionally use `src/platform` identity, environment and D1 contracts.

| Component | Useful source / integration contract | Storage and verification inputs |
| --- | --- | --- |
| `src/modules/conversations` | `conversations/admission.ts` conditional writer; `socket.ts` persisted replay and delivery; edition chooses participants, permission and reply policy | 0002, 0004, 0007 migrations; conversation admission/socket tests |
| `src/modules/widget` | `widget/index.jsx` mountWidget with API origin, public widget key and target; independent browser source, Shadow DOM and native transport | build-widget script, transport/browser/lost-response tests; compatible conversation/identity API required |
| `src/modules/ai-support` | `assist/` evidence packet, history, two-pass suggestions; selected `llm/` and Ensemble text/tool runtime; `service.ts` native generation lifecycle | 020 migration and ai-support tests; generation policy binds to conversation; training adapter is an optional integration entry |
| `src/modules/knowledge` | ingestion/publication, search, citations and refresh; project identity plus D1/R2 and configured crawler/embedding/vector adapters | 0050–0053 migrations and knowledge tests; published corpus survives failed refresh |
| `src/modules/customer-context` | monitoring and attributed profile builders/validation, durable contextual work and personalization; consumer chooses identities/consent | both 0060 migration files and customer-context tests; configured neutral AI execution |
| `src/modules/local-computer` | explicit Integration interface for authorization/context/reply admission; paired real Node connector and existing-session MCP | 030 migration, local-agent tests, native lifecycle test; actual process execution stays on paired host |
| `src/modules/training-runs` | durable bounded matrix, artifacts/checks, recovery, explicit TrainingExecutor; original evaluation harnesses | 040–041 migrations, training/eval-harness tests; uncertain provider attempts are retained |
| `src/modules/plugin-sdk` | plugin UI message contract, host bridge and policy; consumer owns allowed plugin origins | standalone SDK tests; no provider or conversation database dependency |
| `src/modules/site-preview` | isolated preview proxy, project-scoped temporary grant, asset handling and request bounds; consumer supplies auth/origin policy | 0096 migration and preview tests; separate preview origin required |

The remaining identity (including `src/modules/identity/two-factor`), access (roles), audit (security log), management, email/integration, public-site,
legacy-import, dashboard and bootstrapping paths are edition integration. They
remain editable source and can be extracted later when a real second use
establishes a useful boundary. The public-site integration serves dynamic
published help centers; the public homepage is the React root route in
`src/ui/homepage`. The original service's marketing, pricing, waitlist, referrer
and homepage-widget paths are not part of this edition.
The customer widget module remains an independently installable support surface.
An implementation's directory name alone is not an independent component
contract.

`requires` records the acyclic selected capability graph. HappyToHelp wires the
optional engines in `src/edition`: `ai/customer-context-provider.ts` supplies
context execution, `ai/training*.ts` binds the training runner to AI and context
builders, and `local-computer.ts` binds local authority to conversation admission.
`src/jobs.ts` passes execution and generation-effect adapters explicitly.
The AI lifecycle separates provider requests, currentness checks and guarded
finalization; `src/edition/ai/generation-effects.ts` owns its socket and notification
effects. Durable admission finishes before delivery effects, and an effect failure
cannot reopen a completed generation or replay a provider request. The context engine has
no provider default; missing wiring fails before it claims a persisted job.
Training uses its own input validation rather than depending on local-computer.

The context-only selection in ai-support/module.json is five self-contained ESM
files: packet, packetBounds, passEvidence, historyCursor and historyOutput. It has
no provider/storage import and preserves evidence IDs, omission metadata, bounded
newest-first context and recoverable history cursors. The former
`tests/module-boundaries.mjs` check, which copied the published packet selection
outside the checkout, exercised image/evidence bounds and bundled the context and
training entry points against module contracts, was retired in the October 2026
test consolidation.

Full Worker routes and persistence engines remain integrated with this edition's
`src/platform` identity, project-liveness and D1 schema. These are real integration
requirements, not an independently deployable folder: adopting them means adapting
those contracts and carrying the listed migrations. The isolated packet selection,
plugin SDK, widget browser surface and local-computer Integration contract have
narrower consumer requirements. No runtime plugin registry or universal storage
abstraction is required.

Migration filenames are current identities, not a proposed reorder. Each module's
sourcePaths lists the actual files to carry. Aggregate tests such as the delegation
runtime include its real edition dependencies; their passing result does not imply
that an isolated folder with missing adapters will run. Package dependencies and
third-party notices are covered by the root locked package and provenance notes.
Training retains raw observed provider rounds and bounded run budgets without an
active payment, balance or Stripe ledger.
