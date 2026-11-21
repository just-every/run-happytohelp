# HappyToHelp hydration and legacy Inspector verification
Codex, 2026-11-21 UTC

- Product branch `cloud/hh-verify-hydration-1`
- Candidate `648bda0019d013cf2ae0f0b1576947eb8ce35dd8` with sole parent `c9f4904b175366d0226fc2a4c33348d6e4f8ffc9`
- Baseline `c9f4904b175366d0226fc2a4c33348d6e4f8ffc9`
- Dedicated Linux VM with Node 22.20.0, pnpm 10.12.4, rer 0.2.127 and headless VM Chromium. An isolated baseline checkout let standalone verification keep reading main while the candidate was built.

## Plan

1. Reproduce the reported symptoms on main through standalone verify, the focused homepage hydration checker and the bounded-legacy journey. Measure the homepage with the same own-fiber predicate as the hydration probe.
2. Recompute the Inspector timer from load per CPU for every command and keep the existing floor and timeout error.
3. Give React ownership of the popover element and share the tooltip behavior with the widget and editor. Compare the full rendered homepage at 1440 and 390 pixels and run the existing tooltip assertions.
4. Regenerate and verify the source lock, build and test the committed candidate, scan publication scope, then inspect the exact-SHA push Verify. Publish the receipts on the task evidence ref.

## 1. Baseline

- Focused hydration (exit 1) reported `/ plain load: the page did not settle (timeout)`. It ran 1 load before stopping.
- In the focused legacy journey (exit 0), the owner ran a bounded package, stopped in-flight writes, resumed two Worker deaths and replayed zero rows. The historical Inspector timeout did not recur in the isolated baseline command.
- Standalone `pnpm exec rer verify` (exit 1) recorded the following failed assertions.

- `not ok 1 - a visitor gets a source-linked answer from published knowledge, durable replay and a human handoff under current authority`
- `error: 'PUT /api/management/projects/p-ai/widget-settings: expected 200, got 409: {"error":"Workspace settings changed while saving. Please try again."}'`
- `not ok 28 - the support agent door binds Business ids to native people, preserves scoped reads and native transactions, enforces policy, replay, revision, Pause and consent, keeps agent ticket work off customer threads and erases its copies of erased people and customers`
- `error: |-`
- `403 !== 400`
- `expected: 400`
- `actual: 403`
- `not ok 55 - an owner publishes searchable help and removes it through article and workspace lifecycle while drafts and foreign records stay private`
- `error: 'fetch failed'`
- `verify: failed (exit 1)`

In rer 0.2.127, `cli/hydration/browser.mjs:73–76` waits for the probe's settle marker after committing navigation. The animation-frame loop in `cli/hydration/probe.mjs:135–146` requires a React-owned body, zero pending nodes, a 300 ms DOM quiet period and completion of active one-shot animations. The predicate at line 52 counts a non-React child under a React-owned parent. The effect at baseline `TooltipLayer.tsx:7` called `installTooltips(document)`, which appended a plain DOM div under body at baseline `tooltip.ts:70`. The tooltip was the sole pending node at 1440 and 390. It was hidden and idle. The check timed out because ownership never resolved.

## 2. Inspector timer

`tests/helpers/legacy-worker/profiler.mjs` computes 30,000 ms × clamp(one-minute load / available parallelism, 1, 4) per send. The real journey was exit 0. The same journey with an external OS-load stub was exit 0. The probe models 30,000, 75,000 and 120,000 ms at simulated ratios 0, 1, 2.5 and 9. No deliberate machine-stress run was used. Results were collected in the cloud VM.

## 3. Tooltip and visuals

`src/modules/tooltip/TooltipLayer.tsx` renders the manual popover div in React and binds the existing handlers. `src/modules/tooltip/tooltip.ts` shares the event binding and cleanup with the widget and editor installers, which create and remove their respective elements. The tooltip paths are seed-owned according to `base-copies.json`. Source custody is recorded in `sources.lock.json`.

- The standalone hydration checker with its default page selection was exit 0. The selected page is `/`, with 48 loads across seven sections after the change.
- The homepage had zero pending nodes after hydration at both widths. Each screenshot pair uses the same Chromium, viewport height and reduced-motion preference, with fonts and images loaded.
- Homepage pixel differences were 1440 px: 0, 390 px: 0.
- The existing mobile Move in hover and focus, modal keyboard focus, and public homepage browser journey selection was exit 0. The 390 px touch probe was exit 0.

## 4. Exact candidate checks

- `npx -y @runeditrun/rer build` — exit 0.
- `node node_modules/@runeditrun/rer/cli/hydration/check.mjs --details` — exit 0.
- `node --test --test-concurrency=1 --test-name-pattern="an owner runs a bounded legacy package" tests/journeys/legacy.mjs` — exit 0.
- `node --import /tmp/hh-timer-probe.mjs --test --test-concurrency=1 --test-name-pattern="an owner runs a bounded legacy package" tests/journeys/legacy.mjs` — exit 0.
- `node /tmp/hh-touch-proof.mjs` — exit 0.
- `node --test --test-concurrency=1 --test-name-pattern='an owner connects Zendesk twice|two brands save their appearance|a new owner finds the source' tests/journeys/move-in-browser.mjs tests/journeys/inbox-browser.mjs tests/journeys/public-browser.mjs` — exit 0.
- `pnpm run typecheck` — exit 0.
- `pnpm exec rer check --profile first-party` — exit 0.
- `node src/site/base/contract-docs.mjs check` — exit 0.
- `node scripts/contract-docs.mjs check` — exit 0.
- `node scripts/edition-authoring/cli.mjs verify-base --offline` — exit 0.
- `node scripts/edition-authoring/cli.mjs check` — exit 0.

Standalone `pnpm exec rer verify` was exit 0. Its hydration step reported:

- Hydration check: 5 page(s), 48 load(s)
- /: 10 load(s), 7 section(s)
- /docs: 15 load(s), 7 section(s)
- /login: 5 load(s), 2 section(s)
- /docs/install: 15 load(s), 7 section(s)
- /setup: 3 load(s), 1 section(s)
- not checked: /projects answered 307 to /login?returnTo=%2Fprojects

The recorded failed assertions follow.

- No failing assertion recorded at report time.

Publication scan was exit 0 (PASS). The earlier scan rejected the destination argument format. The rerun used the declared project ID and GitHub repository URL. The product-branch Verify was completed / success.
Run 44914473327 is on `648bda0019d013cf2ae0f0b1576947eb8ce35dd8`. https://github.com/just-every/run-happytohelp/actions/runs/44914473327

- contract-docs (job 136877013998) — success.
- plan (job 136877014334) — success.
- build (job 136877093354) — success.
- slow (job 136877095050) — skipped.
- size-check (job 136877385542) — success.
- Verify / connections-and-computers (job 136877385633) — success.
- Verify / import-and-reports (job 136877385647) — success.
- Verify / support-workflow-browser (job 136877385652) — success.
- Verify / support-and-recovery (job 136877385660) — success.
- Verify / identity-and-repair-browser (job 136877385668) — success.
- Verify / identity-and-desk (job 136877385686) — success.
- Verify / public-and-import-browser (job 136877385706) — success.
- Verify / assistant-and-knowledge (job 136877385731) — success.
- nightly-proof (job 136878126457) — skipped.
- full-push-proof (job 136883557657) — success.
- verify (job 136883579878) — success.

Explicit journey registrations in `tests/journeys` were 133 before and after. The contract remains 4 done, 71 partial and 16 missing of 91. Neither generated view nor any clause text, status, gap or evidence cell changed.

CLAIM SOURCE-001 PARTIAL points=none tests=scripts/edition-authoring/cli.mjs#check
CLAIM PUBLIC-004 PARTIAL points=none tests=tests/journeys/public-browser.mjs#a new owner finds the source and installation guide from the public product page, and recovers from a missing documentation page
