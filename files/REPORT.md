# HappyToHelp newcomer trips and rer update

Run Edit Run fleet — 2026-11-16. Repository: just-every/run-happytohelp.
Branch: cloud/hh-stranger3-docs-1. Baseline main: 2044dfa31d6b5e43dea1224bca08e0b509e48396.

## Plan and scope

The complete executed plan is in PLAN.md. This round fixes the four named newcomer trips and updates the rer pin/Base copies. It does not change release metadata, migrations, the release-upgrades baseline, size-check.json, scanner configuration, widget email behavior, or clause judgments. All observations use disposable local synthetic work through rer and native application doors. No hosted installation or provider operation was authorized or attempted.

## 1. README release drift

Before: clean main presents “Release 0.4.28”, says “v0.4.28 once published”, and tells a new deployer to clone that tag. package.json/RELEASE.json identify 0.4.31, whose published tag is e5fb53dc305f53a71ff0b6db81d5eec7dfd0104f. Searches of in-repo scripts found no writer for the README release heading or clone command: this is manually maintained prose. The installed rer release-candidate help and implementation explicitly list only seed.json, package.json and RELEASE.json as version metadata targets; README is not among them. Git history identifies the separate README release preparation at 41fb4024 and later installation-doc edit at 1e2aaf87. The details were copied into a current-release section rather than derived from the release declaration.

After: the current-release section is versionless, points to the latest published release, the selected checkout’s release-specific buyer steps and the authoritative update/recovery instructions, and the deploy commands resolve GitHub’s latest published release redirect. The command does not choose the newest Git tag: tagged but unpublished releases are deliberately not selected. Older legacy upgrade instructions outside that section stay intact. RELEASE.json, its buyer steps, changelog and tags are unchanged. docs-receipt.json records the before and after.

Outside-repo producer gap: no external release producer was inspected or modified. No dependency on such a producer remains for these README deployment directions.

## 2. Visitor email default

Before: the rer local owner reaches Setup, which says the widget asks visitors for email. Widget → Settings shows Require email checked while its helper says the opposite. The installed built widget presents an email input to an anonymous visitor before admission. README and docs/INSTALLER.md also describe the opposite default.

After: README, installer guide and the Widget settings helper all say fresh installs ask for email, and the owner can disable Settings → Widget → Settings → Required contact details → Require email. The helper also says saved choices are retained. No default, provisioning or widget admission implementation changed. At 1440 the native settings form was saved with Require email off, reloaded, saved again with no edits and reloaded: off remained off. The original on choice was restored through that form. before-widget.json and after-widget.json record these results. A repository-wide targeted search found no other contrary widget-default statements; unrelated “no email” wording concerns suppressed local mail or other features.

Screens inspected: before-widget-settings-1440.png, before-widget-settings-390.png, after-widget-settings-1440.png, after-widget-settings-390.png. before-visitor-email-1440.png and before-visitor-email-390.png show the required visitor field; before-setup-1440.png records Setup’s accurate initial explanation.

## 3. Reports workload decision and evidence

Builder interpretation, signed Run Edit Run fleet, 2026-11-16: retain the explicit message-bearing Reports cohort. CONTRACT.md REPORTS-001 Requirement begins “Native conversations created in the workspace IANA calendar range with at least one persisted message form the cohort”; its next sentences explicitly exclude empty widget conversations and imports. ACCEPTANCE.md REPORTS-001 repeats this requirement. REPORTS-002 adds workload/backlog/incoming dimensions and inspectable exclusion rules but does not replace that cohort. Internal notes and call notes are durable private notes, not messages in that cohort. Therefore the brief’s “keep numbers and state the exclusion plainly” route applies; its default for a silent contract is not needed. This is a builder interpretation, not an attributed owner quotation or new status judgment.

Before: using the installed widget, one anonymous visitor submitted a question and email. Through New ticket, the owner created an Internal note — no email ticket for that existing requester and a Log a call ticket for a new requester. All three were assigned to the native owner. Inbox Yours shows 3. Team report, last 30 days, All teams, All brands, imported off shows incoming 1, current backlog 1 and creation cohort 1. The cohort note gives native/imported counts without explaining the retained internal work. before-inbox-1440.png and before-reports-{1440,390}.png show this; before-reports.json records the API’s matching numbers.

After: the same three retained work items remain in Yours; incoming/backlog/cohort remain 1/1/1. Beside those counts, the Team report now explicitly says that incoming, workload and backlog require a public message and exclude internal-note-only tickets and call logs without one, even when assigned in Inbox. Ordinary Reports and docs/reports.md give the same explanation; API/CSV definition text agrees. A later public message qualifies the ticket under the existing rules. Response and resolution sample counts remain 0 for this unanswered fixture; no timing/resolution calculation or query changes. after-reports.json records the unchanged measurements and new scope note. after-reports-{1440,390}.png and after-inbox-1440.png record the result. Screens fit both widths; functional assertions use 1440, with 390 used for visual proof.

Counts: Inbox Yours 3 → 3; incoming 1 → 1; backlog 1 → 1; creation cohort 1 → 1; first-response samples 0 → 0; first-resolution samples 0 → 0. Contract statuses and summary counts are unchanged (91 clauses; generated summary 4 done, 71 partial, 16 missing). No acceptance point or Status/Gap/Evidence cell changed. No test registration was added, removed, skipped or weakened because no numerical or settings behavior changed. A literal inventory of tracked tests/journeys node:test registrations is 107 before and 107 after (registration-receipt.json); this is a source inventory rather than an adjudication of the fleet-wide cap.

## 4. Deploy acquisition collision

Before: in a directory containing the quick-start main checkout named run-happytohelp, the original git clone --branch v0.4.31 https://github.com/just-every/run-happytohelp returns exit 128, destination already exists and is not empty. A following cd enters the main checkout. deploy-before.json records the actual command and error.

After: the README resolves /releases/latest with curl, extracts v0.4.31, clones into the separate run-happytohelp-release directory and cds into it. Literal acquisition commands selected e5fb53dc305f53a71ff0b6db81d5eec7dfd0104f while retaining the existing main checkout. The report distinguishes the acquisition fixture from the local application proof: the additional acquisition checkout was an ordinary clean main clone, not a second full rer quick-start install. All subsequent deployment commands are explicitly scoped to that release directory. The local dry-run result and its actual completion receipt are recorded separately below.

Real production deployment commands were inspected for working-directory assumptions but not executed: this brief explicitly prohibits live installations, account changes and provider operations. Those commands require a separately authorized owned account and private configuration. This is an intentional scope boundary, not proof of remote deployment.

## 5. rer and Base

package.json and pnpm-lock.yaml pin @runeditrun/rer exactly at 0.2.120. Base refresh uses rer refresh-base --ref 35e0a4ac735bab3c3ded8dc92c994da6ae2c9bfc --from-api; no tag is passed as --ref, no other repository is cloned or modified. The first two attempts were atomically refused on GitHub API HTTP 503 responses, with no source or record changed. The decrypted launcher bundle was refreshed and fleet Git setup repeated for each retry, with 15- and 45-second backoffs. The third attempt completed successfully. The official API acquisition reads all 3,342 distinct blobs in the target snapshot before its atomic write; no task-local transport adapter or other repository clone was used. Final refresh outcome and checks appear in completion receipts.

## Verification and custody

Local plan: touched Reports, Widget/Setup and documentation checks; typecheck; source lock/check generated last; rer check --profile first-party. No full local rer verify or full suite. Exact-SHA GitHub Verify is the full gate. The requested broad rer verify wording is resolved by the cloud adaptation and builder rule that explicitly limit local checks and use branch Verify for the full wall.

The first explicit non-interactive setup attempt with --owner-email fleet@runeditrun.com required WIDGET_ORIGIN and OWNER_PASSWORD private answers and exited 3. The ordinary rer dev quick start generated its private local owner and reached Setup. No private answers, dev entry tokens, environment values or credentials are in this packet. Before visible-source screenshots were collected, product files were restored byte-for-byte from origin/main, then the saved patch was reapplied; rer had already been pinned to 0.2.120. The same disposable installation supplied the before/after work items.

All report, screenshot and terminal receipt files live outside the product branch. Product branch custody and evidence publication are independent. No PR is required by this repository’s branch Verify/lander rules. Final SHA, exact-SHA CI run IDs, touched check outcomes and evidence head follow in the final completion section and machine-readable receipt. The actual local proof drivers are widget-browser-proof.mjs and stranger-browser-proof.mjs. They read only the disposable dev-entry log and require the local owner entry; no reusable owner/session credential is published.

## Published checkpoint

The first real save c06c450d0c3ee42e47bd33b68ea26de80cf317f3 was committed with fleet author/committer and active forwarding hooks, audited across every candidate parent, and pushed through cloud-push.py to cloud/hh-stranger3-docs-1. Its [skip ci] marker identifies it as a preservation save, not the final candidate. Before saving, typecheck, 8/8 touched journeys (zero skipped), the 39-page docs validator, source lock/check and rer first-party check all passed. Actual logs and local-checks-save.json record them. The local release checkout's literal rer deploy --dry-run also passed, with the original main checkout retained.

A subsequent explicit setup with the fleet email correctly refused to reassign the already-created local native owner and retained its data/settings. No reset or owner replacement was attempted. The independent fresh release checkout is used to qualify the requested explicit fleet-email setup with a contained private answers file; that file was removed and never selected into evidence. The fresh release-checkout explicit fleet-email setup completed with exit 0 (setup-receipt.json).

## Published documentation browser proof

The final build from 47218177618172fff37999d7aa2311f200802c10 completed successfully; the documentation screenshots were recaptured from this exact head. In its isolated emitted Worker, /docs/install and /docs/reports both returned 200 and rendered the updated guidance. after-docs-install-1440.png, after-docs-install-390.png, after-docs-reports-1440.png and after-docs-reports-390.png were captured and inspected. docs-browser-receipt.json retains the visible changed paragraphs and route results; docs-browser-proof.mjs is the actual driver. Its Chromium and Worker were closed through their own recorded handles.

## Clean-main corroboration

The separate acquisition checkout remains at original main with unmodified tracked source and its original rer pin. The ordinary public rer dev entry completed there with actual installed rer 0.2.119 and a clean Git tree at 2044dfa31d6b5e43dea1224bca08e0b509e48396. Its installed widget asked for email, the contradictory helper was visible with Require email checked, and the three public-door owner-assigned tickets again gave Yours 3 and incoming/backlog/cohort 1/1/1. clean-main-receipt.json, clean-main-widget.json, clean-main-reports.json and the clean-main-* screenshots distinguish this untouched baseline from the candidate installation. This corroborates the earlier same-installation before/after fixture without changing its receipts.

## Local diagnostic handling

A terminal diagnostic accidentally included a disposable loopback dev entry link. That server was stopped, its checkout-local dev key removed, and the documented native setup/dev commands generated a replacement. A private comparison confirmed the entry changed. No entry links, session cookies, private answers or environment files are included in this packet. No hosted credentials or company data were involved.

## Final candidate

Final product head: 47218177618172fff37999d7aa2311f200802c10. Both product commits are pushed to cloud/hh-stranger3-docs-1; no PR was required or created. The final commit has no skip marker. Fresh main was fetched and merged (already up to date); no published history was rebased or force-pushed. All 437 Base records now pin 35e0a4ac735bab3c3ded8dc92c994da6ae2c9bfc. The 990 selected source files were already byte-identical, so the refresh changes only records; five acknowledged seed adaptations remain, with no retirement, withholding or edition migration. Base advertises React 19.3.1 while this seed retains 19.2.8; that advisory caused no selected source change or failing check, and this round does not upgrade React.

Final local typecheck, 39-page docs check, source lock/check, rer first-party check and offline recorded-byte Base check passed. The offline check does not prove remote origin; the completed immutable API refresh did that. The eight functional journeys passed on c06c450d, and no functional source changed afterward. local-checks-final.json separates those facts from the exact-SHA CI gate. Final README copy also labels the historical 0.2.117 size qualification as previous, and the Reports guide keeps its contract rationale in this report rather than presenting clause IDs to operators.

## Final native browser proof

Widget settings and Reports were also recaptured from 47218177618172fff37999d7aa2311f200802c10. The native owner retains all three assigned stranger tickets; the 1/1/1 report figures and zero timing samples are unchanged, and the exclusion explanation is visible beside them. The settings form again retained an explicit off choice through reload and no-edit save, then restored the original on choice. All eight final screen captures (the two native screens and two published docs pages, each at 1440 and 390) were inspected. Final browser receipts name the exact head. The final local dev server PID 91980 was stopped; no global stop command was used.

## Builder claims

These are scoped proof claims, not clause promotions or demotions. No Status, Gap or Evidence cell was edited. Pure copy/source-custody changes do not claim full installer, availability, scale, publication or refusal coverage beyond the exercised journeys.

CLAIM NATIVE-001 PARTIAL points=none tests=tests/journeys/first-run.mjs#a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest
CLAIM FIRST-RUN-001 PARTIAL points=none tests=tests/journeys/first-run.mjs#a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest
CLAIM WIDGET-001 PARTIAL points=none tests=tests/journeys/first-run.mjs#a first owner provisions useful support, observes actual Setup receipts, installs a provider and answers within the daily allowance while local and uncertain mail stay honest
CLAIM REPORTS-001 PARTIAL points=none tests=tests/journeys/reports.mjs#inspect calendar Reports and formula-safe exports against known durations, rates and exclusions, then revoke private export access
CLAIM REPORTS-002 PARTIAL points=1,2 tests=tests/journeys/reports.mjs#resolve and reopen multichannel support with visible answer attribution, visitor feedback and permission-scoped team reports
CLAIM PUBLIC-005 PARTIAL points=none tests=tests/helpers/public-docs-journey.mjs#verifyDocs
CLAIM SOURCE-001 PARTIAL points=none tests=scripts/edition-authoring/cli.mjs#check; scripts/edition-authoring/cli.mjs#verify-base --offline

## Literal deploy replay after the public quick start

After the clean-main public rer dev journey completed and its server stopped, the exact original clone command was repeated in that quick-started folder: exit 128 again. The disposable prior release probe was removed after confirming its Git tree was clean and its HEAD was the public release. The final README’s latest-release acquisition commands were then executed literally: they created run-happytohelp-release and entered e5fb53dc305f53a71ff0b6db81d5eec7dfd0104f, preserving the quick-start main checkout. The literal rer deploy --dry-run completed with exit 0 again, with zero Cloudflare requests, no provider credentials and no remote changes. deploy-after.json and the complete deploy-dry-run-after-quickstart.log retain this stronger replay receipt. No real production command was executed.

## CI and terminal custody

Verify run 43900957917 is bound to exact head 47218177618172fff37999d7aa2311f200802c10: https://github.com/just-every/run-happytohelp/actions/runs/43900957917. At the fifth allowed REST observation it was still in_progress with conclusion null. No failed run or assertion has been observed. ci-discovery.json, ci-final.json and ci-watch-receipt.json retain the actual responses and call timing. Five CI reads plus the rate-limit read and two Base tree reads use eight of the ten manual GitHub calls; the remaining two are reserved for failure diagnosis. The explicitly supplied cloud adaptation permits returning PUSHED when the budget runs short with Verify still running. No READY or green CI claim is made, and no additional watcher is left running.

Terminal product custody is PUSHED at 47218177618172fff37999d7aa2311f200802c10 on cloud/hh-stranger3-docs-1. All four named product/doc trips and the rer/Base adoption are implemented and locally verified. The outstanding item is observing exact-SHA Verify completion/success; no product blocker is known. The fleet’s independent gates must read the current exact-SHA result and run their own publication/landing checks. No landing, submission, main push, tag, release update or real deployment was performed. Evidence publication is report transport only and grants no acceptance or landing signal.
