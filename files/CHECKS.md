# Exact-head check receipts

Product SHA d845c2095b61a69df817205a43b612b0c8ec01f3  
Node 22.20.0, pnpm 10.12.4, system Chromium headless

| Command | Exit | Observation |
| --- | ---: | --- |
| `pnpm run typecheck` | 0 | Route generation and TypeScript passed. |
| `node scripts/edition-authoring/cli.mjs check` | 0 | All eight touched source paths are present in the regenerated lock with matching SHA-256 digests. |
| `node src/site/base/contract-docs.mjs check` | 0 | Contract documents are current. |
| `node scripts/contract-docs.mjs check` | 0 | Claims check passed. |
| `pnpm run describe --json` | 0 | Repository describe script works with the documented flags. |
| `pnpm run check --profile first-party` | 0 | Repository check script accepts the first-party profile. |
| `pnpm run rer size --help` | 0 | README’s repository script dispatches to the size command. |
| `cloud_run npx -y @runeditrun/rer build` | 0 | The command exited successfully and emitted the Worker, assets and delivery artifact on this head. |
| `verifyDocs(process.cwd())` using the public docs builder | 0 | 39 published routes, zero Markdown coverage, link or anchor problems. |
| Playwright DOM reads from the emitted Worker | 0 | Five changed pages returned HTTP 200 at each of 1440 px and 390 px. All ten observations had no retired contact link and fit the viewport. See DOCS-BROWSER.json. |
| `cloud_run node --test --test-concurrency=1 tests/journeys/public.mjs` | 0 | Three public-route journeys passed, including the docs 200/200/404 cases when help alias lookup was unavailable. |
| `cloud_run node --test --test-concurrency=1 tests/journeys/public-browser.mjs` | 0 | All three browser journeys passed. The extended journey checked all 39 emitted docs routes at 1440 px. |
