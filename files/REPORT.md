# HappyToHelp combined 0.4.29 release preparation

Run Edit Run fleet, 2026-11-15T15:52:30Z.

Repository: just-every/run-happytohelp
Branch: cloud/sd-hh-combined-next-release
Product commit: 837b8cbe2279c20c0054c7bf1970a13fa7b2597a
Product tree: c52cd1087ef578ef844d13eff15594fff5927b5c
Qualified main at preparation: 2a85237383ce828b0fcc81f3a2801cd3bfe7cb2e
Previous published release: v0.4.28, commit 41fb40246d2e69f928be397c48d952d147c39160
Candidate release: 0.4.29
PR: none; the brief requires the fleet branch lander and prohibits self-submission.

## Result and scope

One combined ordinary patch preparation contains all eight landed commits since v0.4.28, including d44ec03a, 6c972773, 1e2aaf87 and 2a852373; all four required commits are ancestors of the freshly read main. The product branch changes only package.json, seed.json, CHANGELOG.md, RELEASE.json and the regenerated sources.lock.json. The public release was read back as v0.4.28, non-draft and non-prerelease; live Git tags end at v0.4.28, so v0.4.29 is unused. No tag or GitHub Release was created, moved, signed or published.

Release metadata advances 0.4.28 to 0.4.29 with previousVersion 0.4.28 and date 2026-11-15. The new section describes the landed Zendesk internal-field/form boundary, ticket priority/assignee and missing-requester behavior, source-pull assignment fix, native public contact, installation identity defaults and installation/mail-off/dry-run documentation. It retains the documented rer signin dispatch gap and makes no new live-provider, hosted-journey or accessibility claim.

The rer source pin remains exactly 0.2.117; Node remains 22.20.0 and pnpm 10.12.4. pnpm-lock.yaml has no root package version to update and its bytes remain unchanged. There is no checkout-root package-lock.json or RELEASE.md; neither was invented. Existing happytohelp.com and app.happytohelp.com references remain. Product code, README and other landed docs, CONTRACT.md, ACCEPTANCE.md and docs/CLAIMS.md were left unchanged by this candidate. Historical changelog sections remain byte-for-byte intact after the insertion.

## Before and after counts

| Item | Before | After |
| --- | ---: | ---: |
| Version | 0.4.28 | 0.4.29 |
| SQL migration files | 200 | 200 |
| Highest migration prefix | 336 | 336 |
| Done clauses | 4 | 4 |
| Partial clauses | 71 | 71 |
| Missing clauses | 16 | 16 |
| All clauses | 91 | 91 |

There are zero new, removed or modified migrations. All 200 filenames and Git blob identities match v0.4.28; the full inventory is in metadata-receipt.json and migration-inventory.json. The last file is 336_solved_time_rule_reads.sql, and migration 326 remains absent. RELEASE.json therefore has empty migrations and pendingMigrations lists. No clause Status/Gap/Evidence changes, acceptance promotions, new claims, new defaults or new target gaps are proposed. Zero tests were added, removed or weakened; this release preparation changes no test registrations.

The upgrade instructions require backup and retained installation authority/data/settings, no reset, and no SQL work on an installation already at v0.4.28. Earlier versions retain every earlier buyer step, including missing 330 for v0.4.24/v0.4.25, 333–336 for v0.4.26, conditional 332 cleanup, report/replay backfills, restore reconstruction and recovery custody/watermark requirements. No import, cutover, mail/provider activation or deployment is authorized by these notes.

## Verification and custody

- Frozen dependency installation: PASS.
- Typecheck: PASS under Node 24.19.0 initially, then PASS under the repository's exact Node 22.20.0. The exact required pin is the authoritative local result.
- Release metadata and migration integrity: PASS. Computes consistent versions, previous release and unused next patch from live refs, unchanged dependency/script inputs, complete migration name/blob equality, release notes matching the CHANGELOG section, preserved older changelog text, allowed write scope and unchanged contracts/views. The checker and its actual JSON receipt are included.
- node src/site/base/contract-docs.mjs check: PASS; current documents, zero prose errors or warnings. No contract regeneration was needed because no contract source changed.
- node scripts/edition-authoring/cli.mjs lock: PASS, run after all product metadata edits; only the four changed metadata input hashes differ in sources.lock.json.
- node scripts/edition-authoring/cli.mjs check: PASS before commit and again on the committed candidate after synchronization.
- pnpm exec rer check --profile first-party: PASS under Node 22.20.0.
- git diff --check: PASS. All candidate author/committer/trailer identities checked across origin/main..HEAD, including side parents: one fleet-authored/committed candidate, no co-author trailers. Clone-local cleanup/forwarding hooks remained active.
- The initial rebase attempt before committing was refused for unstaged edits. After the checks and real commit, fresh fetch plus rebase succeeded with the branch already current before its first push. No published history was rewritten.
- Product push: PASS through cloud-push.py, first attempt. Git ls-remote readback equals the full product SHA and the product worktree is clean. The clone has complete commit history after shallow acquisition was expanded for comparison and ancestry.
- Full local suite and browser proof: not run, as required for metadata-only scope. No UI sources changed in this preparation. Branch Verify provides the full CI wall.
- Exact-SHA Verify: run 43732093648, observed in progress on exact candidate SHA after the first five-minute interval; the terminal observation will be appended below and recorded in CHECKS.json and ci-status.json.
- Fleet Base publication scan: unavailable in this cloud by the task's explicit cloud adaptation. The mandatory publication scan and exact-main checks remain the guarded Mac lander's responsibility. No scan waiver, READY acceptance waiver or landing is claimed here.

Actual complete non-secret reports and receipts are retained in this packet. Product pushes and report-only evidence publication are distinct. Evidence is published only to evidence/sd-hh-combined-next-release; no evidence files are in the product commit. Cleanup occurs only after the product and report refs are verified; final cleanup receipt remains outside the owned product checkout.

GitHub budget: release discovery plus exact-SHA run discovery used two calls. Calls used at this publication: 4/10. Subsequent single-watcher REST observations are recorded with UTC times in github-calls.json, at least 300 seconds apart per run, within the ten-call budget. No provider credentials or held-out gate material were used. No provider, company, deployment, signature, scheduler, tag, release or fleet-submission action was performed.

## Full plan

Run Edit Run fleet, 2026-11-15. Tag: sd-hh-combined-next-release.

1. Install the authorized fleet credential helper, product push guard and clone-local commit hooks. Clone only just-every/run-happytohelp and create cloud/sd-hh-combined-next-release from fresh main.
2. Read launcher and seed rules and inline release rules. Compare package metadata, live Git tags and published GitHub releases; select the next unused patch without creating or moving a tag. Confirm the four qualified commits are ancestors of fresh main.
3. Inspect every landed change since published v0.4.28. Inventory all migration sources and compare their names and bytes against the release. Keep rer 0.2.117, Node/pnpm pins and legacy domains. Prepare one truthful combined CHANGELOG section, RELEASE.json and existing package/seed version references. No product, contract, generated-view, provider or deployment edits.
4. Install frozen dependencies. Run the typecheck and meaningful release/metadata, source-lock and first-party checks; do not add literal pin tests or run a full local suite. Regenerate sources.lock.json after all tracked edits. Review the exact diff and all candidate identities/trailers.
5. Fetch fresh main and rebase before the first publication; after any published save use merge only. Push only the named cloud branch through cloud-push.py at the first real commit. Leave public publication scanning, guarded landing, release production, independent signing and GitHub Release publication to their authorized later stages.
6. Discover and poll exact-SHA Verify using REST, with at most one request per run per 300 seconds and ten GitHub calls total. Record actual run IDs, outcomes and limitations; never infer green from a different SHA. Preserve results and complete non-secret receipts outside the product clone.
7. Publish explicitly selected reports/receipts only to evidence/sd-hh-combined-next-release using cloud_evidence.py. Verify report custody and product ref. At a clean pushed end, delete the owned clone/dependencies and retain the packet. Return READY only after exact-SHA green Verify, otherwise truthful PUSHED or real BLOCKED, plus the sd inbox relay.

No clause status changes are authorized or claimed. No tag, GitHub Release, production action, signer action, PR or fleet self-submission is part of this preparation unless the seed's landing rules require a PR; this seed uses the fleet branch lander.


## Matching candidate release notes

One combined update from v0.4.28, covering the landed staff-importer and sign-in documentation fixes together with the ticket-identity, native public-contact and Zendesk pull-assignment fixes.

- **Zendesk staff fields:** upload and source-pull imports retain supported, active agents-only field definitions and typed ticket values for staff review. Customer request forms require explicit source proof of portal visibility; hidden fields and imports whose visibility proof is unavailable stay out of those forms. Portal read-only, solve requirements, defaults and tag side effects still need native review where reported; importing a field does not activate those source policies.
- **Imported ticket identity:** Zendesk and historical legacy imports preserve supported priority values and assign a ticket only when its recorded staff email matches one current workspace member unambiguously. A source staff record grants no membership or sign-in authority. Unmatched assignments stay unassigned with a reported omission; missing or unsupported priority is reported and defaults to Normal. Zendesk source pulls now carry the assignee record with each ticket batch, including staff already settled by an earlier batch. Tickets without a requester use a protected workspace-local “No requester” identity, shown without a customer profile or customer actions and excluded from customer operations and outbound recipients. Existing imported assignments are not rewritten by updating.
- **Native public contact:** the installation's retained support workspace supplies the native chat widget on the public home, Run, contract and docs pages and its own help center, plus the published Contact support request form. New workspaces receive the contact form and email-collection setting; the original owner's authenticated Setup can provision missing contact defaults without replacing existing forms. Visitor email remains unverified, automatic collection stays off, and contact submissions retain the normal native authority boundaries. Public portal sign-in explains when email delivery is unavailable. These changes qualify no live mail provider or hosted customer journey.
- **Installation identity and documentation:** explicit owner and workspace answers take precedence over configured installation defaults; unanswered identity is derived. The install guide leads with the installer that brings Node and pnpm, and clarifies that normal setup does not download Chromium while browser verification does. Deployment docs distinguish the credential-free, zero-outbound dry run from live deployment prerequisites. Mail-off owner entry uses the supported native `scripts/hosted-signin.mjs` command or an existing native password; pinned rer 0.2.117's `rer signin` native-account dispatch gap remains documented. Keep one-time sign-in links private. The existing happytohelp.com and app.happytohelp.com services are unchanged.
- **Migrations and toolchain:** no new or modified SQL migrations since v0.4.28. The inventory remains 200 files, highest prefix 336; migration 326 remains absent. Node 22.20.0, pnpm 10.12.4 and rer 0.2.117 are unchanged. No contract status or provider-readiness claim changes.

Update from v0.4.28 without resetting. Back up D1, R2, Durable Object state, private settings and installation encryption custody before updating. Stop the old Worker and retain native owners, memberships, permissions, support history, files, erasure fences and every applied migration identity. Use Node 22.20.0, pnpm 10.12.4 and the unchanged pinned rer 0.2.117. There are no new migrations from v0.4.28: the inventory remains 200 SQL files, ending at 336_solved_time_rule_reads.sql, with no migration 326. Older installations must first apply every missing published migration once in filename order before this Worker serves HTTP or queue traffic. From v0.4.26, apply 333_report_cohorts.sql, 334_media_message_reads.sql, 335_socket_replay_projection.sql and 336_solved_time_rule_reads.sql; from v0.4.25 or v0.4.24, first apply the missing 330_identity_recovery.sql even when 331 and 332 are already recorded. Retain prior release buyer steps, including 332's conditional cleanup, the report and replay backfills, and report projection reconstruction after portable restore. Keep the durable recovery revocation watermark on rollback; portable restore requires fresh Managed recovery and custody binding. Build and run `rer deploy --dry-run` against the retained installation before any separately authorized deployment. The dry run needs no provider credentials and makes no provider requests; it does not qualify remote readiness. Legacy v1 remains cleanup-only and incomplete cleanup remains pending. Updating starts no import, repairs no earlier imported assignment, activates no mail provider and grants no historical user access. No reset, production import, recovery adoption, cutover or production deployment is authorized by this preparation.

_Run Edit Run fleet, 2026-11-15._


## Earlier CI observation (initial evidence publication)

Observed at 2026-11-15T16:00:44.336771+00:00: Verify run 43732093648 is in_progress with conclusion None on exact SHA 837b8cbe2279c20c0054c7bf1970a13fa7b2597a. GitHub calls used: 4/10. Product custody is PUSHED while Verify is pending; no green or landing claim is made.

## Terminal result

Observed at 2026-11-15T16:10:47.418187+00:00: Verify run 43732093648 remains **in_progress**, conclusion null, on exact SHA 837b8cbe2279c20c0054c7bf1970a13fa7b2597a. The watcher made four REST observations after discovery, each at least 300 seconds after its preceding observation/discovery. It used 6/10 total GitHub calls including release discovery; the budget was not exhausted. This report makes no green, READY, acceptance, landing or RELEASED claim. Local touched checks all passed. No completed red check or product blocker was observed.

The terminal state is PUSHED with Verify pending after twenty minutes. The lane and guarded lander must independently read the run's terminal result and execute the mandatory Mac publication scan before any landing. No workflow was re-run or dispatched. PR: none. The initial evidence ref was read back successfully, verifying all 24 manifest file hashes and the matching product provenance; evidence-initial-readback.json records that earlier publication. The final evidence publication updates this packet without changing the product head, branch or index.

At the clean pushed end, only this task's owned clone and its dependencies at /workspace/run-happytohelp are scheduled for removal, after the final evidence ref readback; the complete packet remains outside it. No server or browser was started.

PUSHED branch=cloud/sd-hh-combined-next-release head=837b8cbe2279c20c0054c7bf1970a13fa7b2597a
