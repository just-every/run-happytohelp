# HappyToHelp stranger-13 corrections

Author: Run Edit Run fleet. Date: 2026-11-17 UTC.
Repository: just-every/run-happytohelp. Branch: cloud/hh-stranger13-ui-1.

Final product head: 94cc8ccc2d39d369695411554a3ac86113efec28. Product branch push and remote ref identity are confirmed. Exact-SHA Verify is in progress; this report will record its actual conclusion before publication.

## Scope and plan

The complete execution plan is in [PLAN.md](PLAN.md). The work covers only import wording, missing-key procedure classification, named machine-credential bindings, discovery of signed-in workspace creation and merge search/survivor selection. It retains existing native layouts and server authority. No contract Status, Gap or Evidence cell, migration, release/version metadata, upgrade baseline, size-check configuration, scanner setting, pin, Base source or provider-preflight file was changed. The fleet's Mac publication scan and independent gate remain landing work; this cloud does not self-gate or land.

## Reproduction on clean main

Clean-main head: 94f64dfc35d938bd92b59bac9e938c11be10c27d, newer than the historical head in the brief. The first capture was interrupted by a setup build replacing browser assets and was repeated from a clean-main build. Only the complete repeat's before receipt and screenshots are retained in the packet.

The native browser reproduction used bootstrap/login, the existing Settings pages, the workspace/account menus and Actions → Merge ticket. All data was synthetic. No paid provider was configured or called. The initial setup required a private local answer file; setup then completed using the existing pinned rer version. No deployment or live installation was used.

| Item | Before | Implemented result | Browser proof |
| --- | --- | --- | --- |
| 5 | With 0 source records processed, the plan said 1,106 of 1,107 records “are imported”. The 1,000-ticket import subsequently completed. | The summary and article counts stay planned until the import is completed; committed wording appears on completion. The separate processed-record progress remains visible. Prior undo wording is retained. | before/import-{1440,390}.png; after/import/planned-{1440,390}.png and completed-{1440,390}.png |
| 8 | A $0.10 simulation on the default model without its key produced one uncertain attempted case and three Not run cases. | Provider-key preflight blocks the run before a case starts or cost is reserved. All four cases are Not run, the receipt identifies OPENAI_API_KEY and offers provider-key setup. Genuine started/provider uncertainty retains its existing handling. | before/simulation-{1440,390}.png; after/stranger13/simulation-blocked-{1440,390}.png |
| 14 | All seven credential-binding dimensions required comma-separated IDs. | Native multiple selectors list current-workspace brands, mailboxes, groups, forms, priorities, tags and credentials by name. The issued binding stores the corresponding original IDs; cards show names. Brands retain the existing workspace security boundary. | before/bindings-{1440,390}.png; after/stranger13/bindings-selected-{1440,390}.png |
| 16 | Neither menu had a creation link. | Both menus link to the existing signed-in /projects/create flow, which still uses its existing authorization and provisioning and leads to Setup. | before/switcher-{1440,390}.png and account-{1440,390}.png; after/stranger13/workspace-switcher-{1440,390}.png, workspace-account-{1440,390}.png and workspace-created-{1440,390}.png |
| 18 | Merge required a source ID and implicitly retained the open ticket. | Search lists same-workspace, permitted tickets by requester name/email or subject. Selecting a ticket still requires an explicit survivor choice, then uses the original versioned preview and merge. The proof chooses the other ticket as survivor and reads the retained private source note through operator history. | before/merge-{1440,390}.png; after/stranger13/merge-preview-{1440,390}.png |

The synthetic Zendesk fixture is the repository's documented-format generator with 1,000 tickets and 100 distinct customers; it therefore has 1,107 reviewed source/derived records rather than the stranger's 2,005. The fixture and actual before/after receipts are supplied. Native data, keys, browser profiles, environment dumps and private held-out material are excluded.

## Tests and boundaries

Assertions run at 1440; screenshots show the changed screens at 1440 and 390. Three registrations were added for three changed flows. Existing import and procedure journeys were extended. The direct registered journey count is 118 before and 121 after; no registration was deleted, skipped or weakened. test-counts.json states the count's scope.

Typecheck, rer check --profile first-party, build and source-lock check pass on final head 94cc8ccc2d39d369695411554a3ac86113efec28. The actual check summaries and heads are in VALIDATION.json; full successful journey logs are in checks/.

- Named bindings and workspace creation: two registrations passed on 7591f933f9145553b284b7a9507642c50cf0cf87.
- Procedure settings browser (including configured failures and the keyless $0.10 run) and procedure route journey: passed on 7591f933f9145553b284b7a9507642c50cf0cf87.
- Requester/subject merge, explicit survivor, foreign-workspace exclusion and private-source-note retention: passed on 7591f933f9145553b284b7a9507642c50cf0cf87.
- Existing Move in review/apply/repeat/filter/undo browser journey: passed on bebd40362f17287c939959b9cb86546e5089e5d0. Its import-summary and journey files were byte-identical to 7591f93 when that result was carried forward.
- The final change after 7591f93 is singular article-completion wording and its generated source lock. A fresh 1,000-ticket public-door import, screenshots, typecheck, first-party check, build and lock check all pass on 94cc8ccc2d39d369695411554a3ac86113efec28. The other product and journey files are byte-identical to the earlier validated head.

Browser validation caught and fixed a repeated-form regression caused by an added token component key; the original stable component identity is retained. The procedure journey's old missing-key expectation was updated to four unexecuted cases; its distinct uncertain provider-failure assertions remain. Menu proof now reopens the desktop menu after the phone capture, and Setup is verified through the installable widget rather than an assumed heading. A full local suite was not run. Genuine paid-provider execution and production rollout are outside this keyless UI round.

## Clause custody

No clause status changes are proposed by the builder. FIRST-RUN-001 remains partial; MOVE-IN-001 remains done; CONVERSATION-002 remains partial; API-002 remains missing; PROCEDURE-001 remains partial. These narrow corrections do not claim the untested remainder of a multi-part acceptance point. clause-statuses.json records the unchanged before/after values. The fleet applies any acceptance judgments after the independent gate.

DEFAULT FIRST-RUN-001: Reuse the existing signed-in creation route and its server authorization for every signed-in account role already admitted there.
DEFAULT API-002: A brand remains the current workspace, consistent with the existing create-input brand guard; no cross-workspace option is offered.
GAP PROCEDURE-001: No live cohort, real-provider qualification or production release is claimed.


## Builder claim lines

CLAIM MOVE-IN-001 PARTIAL points=none tests=tests/journeys/move-in-browser.mjs#an owner connects Zendesk twice, reviews an export, imports and filters its history, detects a repeat and undoes the import
CLAIM PROCEDURE-001 PARTIAL points=1 tests=tests/journeys/workflows-browser.mjs#a lead compares saved procedure definitions, revises an older version without losing unsaved work or source receipts, and requires fresh evaluation before any release; tests/journeys/ai.mjs#a lead versions a synthetic-only procedure, inspects its bounded simulations and refuses a failed or mismatched release
CLAIM API-002 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#an owner chooses named workspace bindings and issues a machine credential with the same scoped IDs
CLAIM FIRST-RUN-001 PARTIAL points=none tests=tests/journeys/workflows-browser.mjs#a signed-in owner discovers workspace creation in both menus and reaches Setup as its owner
CLAIM CONVERSATION-002 PARTIAL points=none tests=tests/journeys/inbox-browser.mjs#an operator finds a merge by requester or subject and explicitly chooses the surviving ticket
