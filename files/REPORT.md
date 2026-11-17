Done. Exact-head Verify is green; the one-commit carry is pushed for the fleet and independent gates.

# Linear legacy-import fidelity carry

Run Edit Run fleet, 2026-11-17. Tag: hh-import-legacy-fidelity-1-c1.
Repository: just-every/run-happytohelp. Branch: cloud/hh-import-legacy-fidelity-1-c1.

## Assignment and plan

Carry the complete product change of prior head `388b0bbc612761895766ffdbb329aace0169522f` as one linear commit on current main, without its unauthorized contract evidence/gap edit or generated views. The complete execution plan is in PLAN.md. No Base refresh, pin change, migration-file change, deployment, PR, new product surface, proof/ directory or independent gate was performed. The fleet owns landing and its publication scan.

The correction brief reports that prior final Verify `44111374830` on `388b0bbc612761895766ffdbb329aace0169522f` failed only contract-docs and its aggregate. This is supplied task context, not an additional API observation by this round. The recovered prior report predates that observation.

The starting main is `bb70a0424b6f1efef5b10cb14992f1b579f1fc50`, also the prior head's merge base. The 40-file net patch applied without conflict. CONTRACT.md was excluded completely. Neither ACCEPTANCE.md nor docs/CLAIMS.md appeared in that patch; both remain main's bytes. sources.lock.json was excluded and will be regenerated last with the declared command, rather than copied or hand-edited. The remaining 38 files, including importer code, fixtures and documentation, have byte-for-byte equality with the prior head. The only intended differences from that head are CONTRACT.md and sources.lock.json.

The prior catalogue follow-up commit explains a computed update of the moving-in guide binding, but this checkout declares no catalogue generator command. `regenerate-catalogue.mjs` reproduces that read/hash/write operation from actual final document bytes, preserving all other catalogue fields. It outputs size 66844 and SHA-256 `9e1b0a3ebfa6c823b90da41ecaaf080d15aaca894255256c9d509d211f1919b5`; these equal the prior final head's catalogue values. No digest was hand-edited. All 12 newly added source/fixture files are present in the regenerated lock (`lock-new-files.json`). New files were staged before the final regeneration because the command selects Git-owned paths. The source lock uses the actual declared generator, `node scripts/edition-authoring/cli.mjs lock`.

## Source equality and counts

`patch-equality-precommit.json` records the full file list and precommit comparison. The final committed comparison and one-parent proof will be in `patch-equality.json` and `receipt.json`. It compares the binary `git diff` from prior merge base to prior head against current main to the new head, excluding CONTRACT.md, generated views, importers.json and sources.lock.json. Catalogue and lock are separately regenerated. `runtime-tree-equality.json` additionally verifies all 38 carried files, including catalogue, equal prior-head file bytes.

Before: 40 changed files on the prior branch, with four candidate commits including one merge in its candidate history. After: 39 changed product files, one commit with one main parent, no contract or generated-view edits. This round adds zero test registrations. The carry extends the existing legacy/MySQL/mounted-adoption fixtures and assertions; six legacy journey registrations and one focused mounted registration are selected locally. The existing MySQL exporter registration remains on the remote keep path as the correction brief directs.

The historical synthetic fixture counts are unchanged by this carry: 53 tables, 580 baseline columns, two enrichment fields, 154 SQL rows, 132 distinct exported rows, 84 source rows with native targets, 48 archive-only source rows, and 22 rows omitted before export. Scoped exported rows total 134 because shared source context occurs in both tenant exports. There are 11 generated attachment objects and 17 source pivots. The 580 policies divide into 152 native, 71 normalized, 34 control/custody, 176 archive-only and 147 omitted. These are conditional policies, not 580 native functionality claims. Prior JSON/package equivalence compared 24 native tables and exact replays applied zero rows. These counts come from the recovered prior evidence, not a new MySQL execution in this round.

## Excluded contract evidence and fidelity matrix

MIGRATION-001 remains PARTIAL; no Status, Gap, Evidence, acceptance text or summary count changes. `omitted-contract.patch` preserves the complete excluded change for the lander to assess. The intended additional evidence is reported here instead:

- `tests/legacy-export.mjs`, `tests/legacy-export/fidelity-inputs.mjs`, `tests/legacy-export/field-matrix.mjs`, `tests/legacy-export/native-readers.mjs` and `tests/legacy-export/transport-equality.mjs` exercise an isolated synthetic MySQL 8 SQL export through both public transports, 53-table/580-column classification, nullable-author CLI hold, subject readback, source parent/cycle/digest refusals, native readers and transport equality.
- `tests/move-in/legacy-adoption-integration/journey.mjs` and `fixture.mjs` exercise stored owner approval, an operational unknown-author saved reply under the legitimate custodian, source verification cleared privately, original-schema note media without project_id, Article/Event/Message pivots, private downloads and audience denial.

The completed historical field matrix is `prior/FIELD-MATRIX.md`, with structured rows in `prior/field-matrix.json`. `prior/source-reconciliation.json`, `prior/object-dispositions.json`, `prior/normalization-outcomes.json`, `prior/refusal-and-deletion-effects.json`, `prior/results.json` and `prior/native-readers.json` retain actual source counts, field dispositions, reader outcomes and normalization limits. The full original plan and report are included as `prior/PLAN.md` and `prior/REPORT.md`. They describe the old candidate and its old CI status; they are provenance and are superseded by this round's exact product/CI receipt, not fresh proof on the new SHA. Recovered evidence ref: `refs/heads/evidence/hh-import-legacy-fidelity-1`, head `63950c16aa6d40f17e8a72025719cf17b7bb6468`.

## Product behavior retained

- A null-author saved reply no longer aborts CLI planning of unrelated support history. CLI explicitly holds/archives that row rather than inventing a source author. Historical adoption uses its already-approved custodian and records the original author as unknown.
- Historical contacts are native-unverified, while their original verification fact remains privately retained. The administrative CLI policy intentionally remains separate.
- Conversation subject maps to the existing native destination. Field dispositions disclose unsupported mapped-row columns and target-schema omissions without source content.
- Multiple media pivots are handled deterministically; unrepresentable message associations and pivot tag/order are explicit holds/dispositions. Note and incompatible audiences remain private. Worker mapping hydrates source-shaped Article/Event/Message relationship context.
- Deleted source parents suppress native descendants while retaining sanitized source custody. Both CLI transports retain replay/conflict/erasure fences and inert work behavior.
- Docs in docs/LEGACY-EXPORT.md, docs/moving-in.md and the importer README retain the entry procedures, separate CLI/adoption policies, explicit enrichment choices and native limitations.

The prior report identifies actual changed source paths and lines. `runtime-tree-equality.json` proves that this correction does not modify those implementations or assertions further.

## Local execution and evidence boundaries

The focused mounted historical-adoption helper passed in this round; `mounted-adoption.json` and `mounted-adoption.log` are its actual results. It uses current native owner/session and stored approval, real Worker stops/deaths, replay, native readers, custodian and contact-verification assertions, attachment/audience checks, and cleanup. It is not an independent gate. Its first direct execution used Node 24.19.0; the registered journeys are then run under the repository's Node 22.20.0 and pnpm 10.12.4.

The actual setup and build use the required cloud subreaper. Initial setup attempts needed declared owner password/widget origin fields, refused a concurrent checkout holder, and then refused an answers file outside the checkout. Those failed attempts were corrected with generated private answers under ignored .rer/, after the focused helper finished; no setup secret or private entry log is included in evidence. The final setup/build succeeded. Private answers are excluded and removed at cleanup.

The correction brief does not repeat the synthetic MySQL run locally; its existing remote keep workflow is `.github/workflows/installer-journeys.yml` legacy-export. `prior/deletion-complete-export.log` is the prior completed SQL fixture run (440.889 seconds), and prior native/browser results and selected screenshots at 1440/390 are included with their original provenance. This carry changes no UI. No fresh browser inspection or MySQL qualification is claimed by this round. Public-branch Verify remains the full wall on the new exact SHA.

## Defaults, gaps and handoff

DEFAULT MIGRATION-001: Preserve main's contract whole; retain CLI null-author row holds and the separately approved historical custodian policy. Preserve synthetic-only qualification and no-live-export claims.
GAP MIGRATION-001: Synthetic evidence cannot qualify current production schema, real export/object completeness, original hard-deleted history, actual domain/mail/model choices, live integrations, production backlog, cutover or team adoption. CLI null-author replies still require a separately allocated legitimate custodian-selection policy to become operational. Extra media message links and pivot tag/order lack native equivalents and remain named holds.

No independent Opus data-fidelity/privacy gate, fleet publication scan, landing, submission, real-data migration or deployment is awarded here. The selected packet contains only reports, content-free measurements and previously published synthetic proof; no credentials, environment dumps, private test packages or held-out material are selected.

## Local runtime retry

The initial all-six legacy run passed the CLI/custody journey (423.687 seconds) and migration-repair journey (203.327 seconds), but the work-count/unread/default-rule registration encountered `Wrangler command failed (1)` from the shared emitted-runtime command helper. This was a command exit, not an assertion comparison. The test's `finally` cleanup removed the diagnostic directory named in the error; the surviving Wrangler log ends after local command-start metadata without an error body. Its cause is therefore unknown, not proven environmental. The remaining cases continue; only this failed registration will be rerun with an external private diagnostic path. Both attempts are retained in the packet; no test or product source is changed to obtain a pass.

The isolated work-count/unread/default-rule retry passed in 219.922 seconds without any source or assertion change (`legacy-retry.log`). The initial command failure did not reproduce; its root cause remains unknown. Thus all six legacy registrations have completed passes across the original run plus this one scoped retry. The original failed run is retained and is not described as an all-green invocation.

## Final product custody and local results

Product head: `c91ad58f146f84520d942986dcf6974ae3f85a16`, pushed once successfully on `cloud/hh-import-legacy-fidelity-1-c1`. Final freshly fetched main remained `bb70a0424b6f1efef5b10cb14992f1b579f1fc50`. No PR was created; the repository uses the fleet's branch landing contract.

`patch-equality.json` and its printed log prove `git log origin/main..HEAD` has one commit, whose only parent is main. For all 37 non-exception carried paths, both each binary Git diff and the complete filtered Git diff are identical to the prior candidate's net patch. The explicit file list, comparison commands and patch hashes are included. CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md equal main whole. The regenerated catalogue also equals the prior candidate byte for byte. The regenerated lock includes all twelve additions. The final checkout is clean. `candidate-identities.log` records all candidate authors/committers and trailers; fleet identity is correct independently for both, and trailers are absent.

Completed local results: final build PASS; contract-docs through both repository/CI entry points PASS; final Node 22.20.0 typecheck PASS; first-party rer check PASS; source lock generation/check PASS. Six legacy registrations have completed passes across the initial 5-pass/1-command-failure run and one successful scoped retry. The focused registered mounted-adoption journey passed in 142.818 seconds; its current native assertions include the unknown-author custodian, cleared historical contact verification with private source fact, source-shaped note media, audience checks, real stop/restart, immutable custody and replay. `final-local-checks.json` records actual command starts, finishes and exits. No full local suite was run.

Exact-head Verify is run `44124929580`: https://github.com/just-every/run-happytohelp/actions/runs/44124929580 . Its initial discovery was queued; completion must be read before READY. The final observed state will be recorded below and in receipt.json/ci-final.json.

## Completed exact-head Verify and handoff

Verify run **44124929580** is **completed / success** on exact product SHA **c91ad58f146f84520d942986dcf6974ae3f85a16**. The actual final API response is `ci-final.json`. Six task Actions API calls were used, separated by at least 300 seconds; the final observation used a longer interval to preserve budget. No CI rerun, failed-log download or PR API call was needed. No contract-docs exception is used: the whole exact-head run is green.

There are no product blockers in this correction. The independent Opus data-fidelity/privacy gates, publication scan and fleet landing remain separate work, not awarded by this builder. The current branch remains the one linear commit with one main parent. Product publication and report-only evidence transport are separate; the packet is published only to `refs/heads/evidence/hh-import-legacy-fidelity-1-c1`.

CLAIM MIGRATION-001 PARTIAL points=1,2 tests=tests/helpers/legacy/custody.mjs#legacyCustodyJourney; tests/move-in/legacy-adoption-integration/journey.mjs#mountedAdoptionJourney

Run Edit Run fleet, 2026-11-17.
