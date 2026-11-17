# hh-root-signedout-1

Signed: Run Edit Run fleet, 2026-11-17 UTC.

## Plan
1. Read native root routing, public site entry, first-run readiness, workspace authority and help publication.
2. Set up a private local trial through rer setup/dev, claim its native owner and capture signed-out root before the change at 1440 and 390.
3. Gate only the application root using existing native setup/session checks and the retained installation workspace. Keep unconfigured and signed-in behavior; send configured visitors to the built-in Help Center when published/enabled, otherwise sign-in. Use cacheless temporary redirects and target-specific query parameters.
4. Add one real-flow browser journey at 1440, traversing setup, sign-in state and knowledge publication through public doors. Capture all three states separately at 1440 and 390 and inspect them.
5. Run touched public/first-run journeys, typecheck and rer check, regenerate and check sources.lock.json last. Review the exact diff, commit with fleet identity, inspect every candidate commit and push only the named cloud branch.
6. Wait for exact-SHA Verify within the ten-call API budget. Publish complete non-secret evidence separately, report clause claims and relay inbox lines. No landing, deployment, migrations or contract status edits.

## Root cause
`src/routes/index.tsx` unconditionally renders `src/ui/homepage/Homepage.tsx`; it has no first-run or native-session guard. `src/server.ts` sends `/` to TanStack Start because it is neither an API nor a dynamic Help Center path. `src/site/pages.ts` independently renders the same Homepage component for the separate static marketing package. The application root guard must not modify that component or the site package.

## Decisions
Reuse `/api/identity/setup` (which calls `setupAvailable` and native `requireActor`) for readiness and session state; reuse `installationContact` for the retained, live owner workspace. No new first-run detector or arbitrary first workspace selection.
The product has no Help Center on/off switch. Its existing publication choices are `knowledge_experience.published_host` (including an explicit empty string selecting built-in paths), or deployment-approved help hosts when retaining deployment defaults. Use those existing publication settings as enabled; a context-only `help_center_domain` does not publish anything. A published article also qualifies. Always use the existing built-in `/help/<workspace>` URL, without printing the workspace id as prose.

## Results
Before: after rer setup claimed the native owner and rer dev became ready, the configured trial answered root HTTP 200 with the HappyToHelp product page. Inspected both `screenshots/before-configured-signedout-1440.png` and `screenshots/before-configured-signedout-390.png`.

After: the real emitted Worker journey passed all three requested states, the signed-in visit, HEAD redirects, no-store headers, destination-specific query filtering, the explicitly enabled empty Help Center and a return from docs. Assertions run at 1440; screenshots are captured at 1440 and 390 with the viewport restored before the next assertion.

Inspected all six after screenshots in `screenshots/root-entry/`: unconfigured keeps the entry page; configured without published/enabled help shows the native password form; configured with a published article shows Synthetic support's Help Center and its article. No workspace id appears as visible text. The initial full-page unconfigured capture caught reveal animations before scrolling; the final capture uses the browser's ordinary reduced-motion preference for a complete still image. No UI/CSS changes.

Root changes are only `src/routes/index.tsx` plus its server-only `src/platform/root-entry.server.ts`. Existing homepage, marketing site, Run, router, sign-in/password/widget/time-zone code and all release metadata stay unchanged. No migrations, provider calls, live installation, production deployment or contract status edits.

An inferred return type on the new root beforeLoad produced a TanStack route-context inference error at the sibling dashboard. The untouched baseline typechecked; an explicit `Promise<void>` on the new root hook fixed the typecheck without changing dashboard code.

Updated two existing public checks for the newly specified root behavior while retaining their guards: signed-out empty root must redirect to native sign-in; the signed-in root still publishes the installation's native contact widget; forwarded host headers still cannot select a Help Center.

Counts: top-level registrations under `tests/journeys/*.mjs` 118 → 119 (one new real-flow test); `public-browser.mjs` 2 → 3. No removed/skipped registrations. Contract clause statuses and summary counts are unchanged. These counts describe the push journey entrypoints, not unrun legacy registrations.

Validation and exact candidate provenance follow below.


## Screenshot index
| State | 1440 | 390 |
| --- | --- | --- |
| Before, configured and signed out | [desktop](screenshots/before-configured-signedout-1440.png) | [phone](screenshots/before-configured-signedout-390.png) |
| After, unconfigured | [desktop](screenshots/root-entry/unconfigured-1440.png) | [phone](screenshots/root-entry/unconfigured-390.png) |
| After, configured without help | [desktop](screenshots/root-entry/configured-signin-1440.png) | [phone](screenshots/root-entry/configured-signin-390.png) |
| After, configured with a published article | [desktop](screenshots/root-entry/configured-help-1440.png) | [phone](screenshots/root-entry/configured-help-390.png) |

DEFAULT PUBLIC-005: “Enabled” uses the product's existing Help Center publication/address choices; no new setting or readiness rule. Context-only external Help Center URLs grant no publication authority.
GAP PUBLIC-005: This scoped routing fix does not close the clause's broader documentation/layout qualification gaps. No clause status, Gap or Evidence text was changed.

## Publication boundaries
The cloud cannot run the fleet's publication scan; the Mac lander owns it. No self-gate, submission, deployment, main/default-branch push, PR or release is authorized by this work. The product branch and the separate report-only evidence ref have distinct custody. Final exact-SHA Verify and terminal provenance are recorded below after completion.


## Candidate
Branch: `cloud/hh-root-signedout-1`.
Base: `bb70a0424b6f1efef5b10cb14992f1b579f1fc50` (fresh main, still current at the final fetch).
Head: `bdef5aff63ee5783883d0d0ebf939182fc27c90f`.
Tree: `945d9af58a701079515ac02dbc24bc2f270630d5`.
First save: `9f876c4` (`[skip ci]`), then a real final test/type-inference commit with no skip marker. Both product pushes succeeded through cloud-push.py. Every candidate author and committer is Run Edit Run fleet <fleet@runeditrun.com>; no trailers. No published history was rewritten. The post-save main merge was already up to date. No PR is required by this repository's landing instructions, and none was opened.


## Local validation
- `pnpm run typecheck`: passed, including a fresh candidate run with Node 22.20.0.
- `pnpm exec rer check --profile first-party`: passed.
- `node scripts/edition-authoring/cli.mjs lock`, then `check`: passed after staging every new source/test file; the lock includes both new helpers. Lock regenerated after the final no-op main merge and no tracked edits followed it.
- `npx -y @runeditrun/rer build`: passed. The final-candidate rebuild was interrupted when the execution environment reconnected. Its exited zombie retained this task's operation lock. After verifying PID 9572 was this build's exited owner and pinning the regular lock inode, removed that stale ephemeral lock only; native data and tracked files were retained. The next candidate build passed.
- `node --test --test-concurrency=1 tests/journeys/public.mjs tests/journeys/first-run.mjs`: 5 passed, 0 failed, 593.875 seconds. This includes canonical help/search/draft/deleted fences, native public contact/widget checks, import noindex behavior and overload/read-effect recovery, plus both first-run journeys. No full suite was run locally.
- Initial new root browser journey: 1 passed, 0 failed, 156.556 seconds. The final exact-candidate replay and reduced-motion screenshots are recorded in the final receipt below.

The five existing journeys ran while the final commit was created from the unchanged tested tree. The final root replay rebuilds and tests the clean pushed SHA itself. The ordinary docs home link also returns to the right root destination; this is an HTML navigation check, not a claim of a separate SPA-only flow.


Final local replay on `bdef5aff63ee5783883d0d0ebf939182fc27c90f`: build passed; the new root journey passed 1/1 with no skips or failures in 157.185 seconds under Node 22.20.0. Inspected the final six 1440/390 screenshots after replay; unconfigured entry artwork is complete under reduced motion, the native sign-in form is legible at both widths, and the Help Center shows only the synthetic workspace and published guide. Native workspace ids are absent from running text. Browser and runtime processes exited; tracked product checkout remains clean.


## Exact-head Verify and terminal result
Verify run `44124009048` completed **success** on the exact pushed head `bdef5aff63ee5783883d0d0ebf939182fc27c90f`: https://github.com/just-every/run-happytohelp/actions/runs/44124009048. Six repository REST calls total: one exact-SHA discovery and five status reads, each at least 300 seconds apart. No workflow re-run, failure-log read or exception to the Verify bar was needed.

Remote product ref was read back through Git and matches this head; the checkout is clean. Six local touched/new journey registrations passed (five existing plus one new), typecheck/build/rer check/source check passed, and all eight requested before/after screenshots were inspected. No open blocker. No PR was created. No clause statuses or generated views changed; PUBLIC-005 remains partial. Push journey entrypoint registrations: 118 → 119.

CLAIM PUBLIC-005 PARTIAL points=3 tests=tests/journeys/public.mjs#a published help center: Markdown rendered safely, complete summary search paging, retained aliases and configured hosts, and drafts, other workspaces and deleted ones indistinguishable from missing

2026-11-17T16:51:34Z Run Edit Run fleet: hh-root-signedout-1 complete; native company root routing corrected, clause statuses unchanged; head bdef5aff63ee5783883d0d0ebf939182fc27c90f; Verify 44124009048 success.

READY branch=cloud/hh-root-signedout-1 head=bdef5aff63ee5783883d0d0ebf939182fc27c90f
