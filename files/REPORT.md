READY-TO-BUILD — the offline migration paths exist; pagination, field fidelity and mounted-door qualification need account-free builder work before a release claim.

Read-only baseline: `just-every/run-happytohelp` main at `b2b9bc602a73feb542017bca8a46529f68b631c4` (package 0.4.31), inspected 17 November 2026. No product edits, product commits, PRs, CI dispatch, application launch or deployment were made. Only the separate evidence branch is authorized for publication. The requested `just-every/run-runeditrun` owner-context repository returned “Repository not found” on clone and ref lookup; no cited copy of its DIRECTION.md/AGENTS.md was found in the inspected seed guidance. That context remains unavailable, and no owner direction is invented. Launcher AGENTS.md, seed AGENTS.md, CONTRACT.md, ACCEPTANCE.md and HANDOVER.md were read; the assignment overrides local plan editing.

Existing implementation and contract judgments

| Clause | Current CONTRACT Status row | Existing work and remaining boundary |
| --- | --- | --- |
| MOVE-IN-001 AP1 | published / done | Reviewed five-kind import, source custody, omissions, role checks, bounded resume, exact repeat/undo and 1,000-conversation synthetic coverage. Do not rebuild its engine. |
| ZENDESK-IMPORT-001 AP1–6 | target / missing | Offline packer, attachment/history mapping and browser helpers exist. Status explicitly credits supporting door evidence for AP1/2/5/6 only and no AP3/4 qualification; all six mounted Move in outcomes remain owed. |
| MOVE-IN-002 AP1–3 | target / partial | Four-vendor upload, partial fields/companies/configuration, plus a separate live Zendesk connector/pull/file fetch. Offline synthetic work cannot close all-vendor or live cutover claims. |
| MOVE-IN-003 AP1–2 | target / partial | Imported public notification keys, conflict-safe matching, Solved reopen/Closed follow-up and ownership review. Live incumbent notification/cutover proof remains separate. |
| MOVE-IN-004 AP1–2 | target / partial | Zendesk macro actions/placeholders, groups, views, schedules, draft rules, typed fields/forms and a bounded SLA policy mapping exist; full configuration equivalence remains incomplete. |
| MIGRATION-001 AP1–3 | published / partial | Legacy single-file/chunked import, guarded D1/R2 custody, financial archives, erasure and delta machinery exist. Its carried-done audit still names unproved outcomes; helper existence does not overturn that judgment. |

These rows are in CONTRACT.md:1207, :1223 and :1259–1262; requirements are at :175, :304 and :675–727. ACCEPTANCE.md and docs/CLAIMS.md are generated views. `importers.json` records Zendesk as “documented format” with `validation:synthetic-only` and `realExport:not-supplied`; this is not release or live compatibility qualification.

Source inventory, pinned to that main revision:

- Public Move in implementation: `src/modules/move-in/routes.ts`, `preparation.ts`, `readers/{records,shapes,normalise,zendesk-fields,zendesk-configuration,zendesk-macro,zendesk-offline,companies}.ts`, `supplied-attachments.ts`, `email-threading.ts`, `review-report.ts`; `scripts/pack-zendesk-offline.mjs`; `docs/moving-in.md`.
- Existing synthetic generators/proofs: `tests/move-in/{generator,zendesk-offline-fixture,zendesk-offline,zendesk-door,zendesk-offline-browser,configuration-source,configuration-review,configuration-sla,door-field-visibility}.mjs`; `tests/journeys/{move-in-admission,move-in-browser,move-in-capacity,move-in-custody,move-in-erasure}.mjs`. Browser registration already calls `zendeskOfflineBrowserFlow`; these are coverage to extend, not tests newly passed by this planner.
- Legacy implementation/docs: `docs/LEGACY-EXPORT.md`, `src/modules/legacy-import/README.md`, `scripts/{export-legacy,import-legacy}.mjs`, `scripts/legacy-export/{scope,extract,package,text-policy,secrets}.mjs`, `src/modules/legacy-import/{map-core,map-project,map-knowledge,map-operations,mapping,importer,archive-only}.ts`, `package-in/`, `worker/`, `adoption/`, `custody/`; `src/ui/native/pages/legacy-package/`.
- Legacy fixtures/proofs already exist in `tests/legacy-export/{schema.sql,live-schema.sql}` and `tests/legacy-export/{fixture,extended-fixture,delta}.mjs`, `tests/legacy-export.mjs`, `tests/helpers/legacy/{custody,network-edge}.mjs`, `tests/helpers/legacy-package.mjs`, `tests/move-in/legacy-{package-upload,adoption-integration}/`, `tests/journeys/legacy.mjs`. The schema contains 53 tables and 580 columns. Nothing was read from app.happytohelp.com, its database or its buckets.

Documented incumbent shapes to test

Use Zendesk's [account JSON export](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file) as singular-wrapped JSON records, and its documented API response objects as separately supplied local source files. Do not call a custom packing manifest a Zendesk export format. CSV lacks full nested history and is not the complete-fidelity fixture. Do not invent a single Zendesk archive containing every resource.

| Local source component | Official documented shape/reference |
| --- | --- |
| Tickets | [Tickets API](https://developer.zendesk.com/api-reference/ticketing/tickets/tickets/): `{tickets:[...]}` / `{ticket:{...}}`; positive numeric IDs, requester/submitter/assignee/group/organization IDs, six status categories, custom_fields `{id,value}`, tags, via and timestamps. Use [incremental exports](https://developer.zendesk.com/api-reference/ticketing/ticket-management/incremental_exports/) to model complete account history, including archived tickets, rather than assuming ordinary listing includes them. |
| Comments and events | [Ticket Comments](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_comments/): `{comments:[...],next_page,...}`; each comment has its own ID, author_id, public, body/plain_body/html_body, created_at, attachments and metadata. Collect all pages. [Audits](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_audits/) carry audit ID, ticket_id, author_id, created_at and events; [metric events](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket_metric_events/) carry ticket_id, instance_id, type, metric, time, optional sla/group_sla/status/deleted. These are historical observations, not policies. |
| People and companies | [Users](https://developer.zendesk.com/api-reference/ticketing/users/users/): `{users:[...]}`, role end-user/agent/admin, email, external_id, default organization_id, user_fields and profile/authority metadata. [Organizations](https://developer.zendesk.com/api-reference/ticketing/organizations/organizations/): `{organizations:[...]}`, domain_names, organization_fields and sharing policy. Additional memberships require separate relationship records; organization_id alone means default membership. |
| Groups and memberships | [Groups](https://developer.zendesk.com/api-reference/ticketing/groups/groups/): `{groups:[...]}` with id/name/default/deleted/is_public/description/timestamps. [Group Memberships](https://developer.zendesk.com/api-reference/ticketing/groups/group_memberships/): `{group_memberships:[...]}` with id/user_id/group_id/default/timestamps. Membership does not arrive inside a group. |
| Macros | [Macros](https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/): `{macros:[...]}` or `{macro:{...}}`, actions `{field,value}`, restriction, active/default/position and titles. Liquid placeholders and conditions/actions are source semantics, not arbitrary text substitution. |
| Rules | [Triggers](https://developer.zendesk.com/api-reference/ticketing/business-rules/triggers/) and [Automations](https://developer.zendesk.com/api-reference/ticketing/business-rules/automations/): plural/singular resource wrappers, conditions `{all:[...],any:[...]}` of `{field,operator,value}`, actions, active/position; triggers also categories. Automations have time conditions. |
| Views | [Views](https://developer.zendesk.com/api-reference/ticketing/business-rules/views/): conditions, restriction, active/default/position and execution columns/grouping/sort. Preserving inclusion alone does not preserve its presentation or access. |
| Help centre | [Articles](https://developer.zendesk.com/api-reference/help_center/help-center-api/articles/): locale-specific article objects with HTML body, draft, section_id, author, labels, position, permission_group_id, user_segment_id/user_segment_ids and source_locale. Sections/categories/translations are separate relationships. [Article Attachments](https://developer.zendesk.com/api-reference/help_center/help-center-api/article_attachments/) carry article_id, id, locale, inline, file_name/content_type/size/content_url and timestamps. |
| Ticket attachment bytes | [Ticket Attachments](https://developer.zendesk.com/api-reference/ticketing/tickets/ticket-attachments/): id, file_name, content_type, size, content_url plus deleted/inline/thumbnails/dimensions/malware state. URLs are metadata, never bytes or permission to fetch. Bind owner-supplied local files by ticket/comment/attachment ID, local relative path, size and SHA-256. |
| Pagination | [Pagination](https://developer.zendesk.com/api-reference/introduction/pagination/): preserve offset next_page/previous_page/count or cursor links/meta.has_more/after_cursor as applicable; incremental exports use after_cursor/after_url/end_of_stream or next_page/end_time/count. These envelopes must establish completeness before being removed. Never fetch a cursor URL during offline import. |

The existing local packing format is `happytohelp-zendesk-offline-v1`: manifest files identify kind/path and comment ticket/page bindings; `_offline` adds comment completeness, local attachment base64+digest bindings, history availability, metric/audit arrays and provenance. `_offline_provenance` identifies original component/file hash/row/pointer. Those are HappyToHelp annotations; untouched Zendesk attachments need no base64 property. The packer currently supports ticket/user/organization/ticket_field and comments/metrics/audits components; configuration records use the existing singular-wrapper uploader, not an imaginary existing packer capability.

Legacy HappyToHelp has a repository-documented operator export, not a public SaaS export API: `happytohelp-legacy-v1` has source provenance, `tables:{table:[rows...]}` and optional `{key,dataBase64,sha256}` objects; `happytohelp-legacy-chunks-v1` has `manifest.json`, source repository/revision/exportedAt/projectId/rowCounts, chunks/context descriptors `{table,count,file,bytes,sha256}`, object descriptors `{key,mediaId,file,size,sha256}`, attachmentsComplete and mediaBytes. UUIDs survive; SQL DECIMAL/BIGINT values stay strings, JSON stays JSON, timestamps are UTC. The default row chunks are 4 MiB. Mounted intake additionally bounds manifest to 2 MiB, each part to 4 MiB, each object to 16 MiB and inventory to 20,000 descriptors, with status pages at most 200. CLI directory import has different streaming bounds; its “any size” documentation is not a mounted-door guarantee. Delta source.since/watermark and retirement marker are separately documented; no live source extraction is required for synthetic packages.

What maps, maps with loss, or is dropped

“M” means a source value/relationship is mapped into native content or source-linked native provenance; it does not mean native IDs are numerically identical. “L” means conditional, transformed, inactive or provenance-only. “D” means absent from operational native data, even when sanitized originals remain privately archived. Retaining an original is not a mapped success. Every actual unknown nested key must get its own source pointer, not disappear behind a generic “unsupported fields” count. Request/write-only API parameters are distinguished from returned export fields in the matrix; no importer should replay them.

The packet's `ZENDESK-FIELD-MATRIX.csv` names all 243 top-level fields from the cited resource JSON Format tables plus 23 explicit nested mapping boundaries. `LEGACY-FIELD-MATRIX.csv` names all 580 schema columns with policy and destination judgments. They are source audits, not executed end-to-end acceptance. The following groups specify the native mapping and the exact losses; the D-field inventory below names every catalogued drop.

| Resource | Mapped now | Loss/condition now; required product place |
| --- | --- | --- |
| Ticket | id→source provenance/search; requester_id→contact; subject→imported subject; created_at/updated_at; six status categories; tags→workspace tags. | hold→native on_hold; closed/solved keep distinct native follow-up semantics. Priority null/unknown becomes Normal with a note. custom_fields[].id/value require supported definitions and exact native type; absent definitions lose values from native tickets, null/empty are skipped. custom_status_id is only noted. via.channel retained; the rest of via is mostly opaque. description is not a substitute for full comments; is_public is not authority. assignee_id/group_id record historical ownership, but preparation.ts currently also passes exact-email matchedAgents into normalise.ts and importedAssignee, creating an assignment path before explicit ownership review: verify and remove that activation path. Add ticket-specific organization, submitter, source external/encoded IDs, participants, form, task/incident relationships and native historical status/metadata fields without creating access. |
| Comment | id, author_id, source created_at, explicit public; public messages vs private move_in_notes; staff/system authors retained without logins. | plain_body wins over body; html_body/rich presentation not reproduced. Public explicit Message-ID/References/In-Reply-To/reply-to/subject keys are retained by email-threading.ts; unrelated metadata remains original-only. Store inspected rich/source metadata and audit relationships, preserve private attachment ownership, never infer notification tokens from bodies. |
| User | id→vendor-scoped identity; end-user name/created_at/email; tags→inert imported_tags; role→historical authorship. | Invalid/missing email becomes null; staff requester becomes inert no-email contact; other staff get no login. external_id remains original-only; organization_id maps only default company; updated_at is source provenance. verified is intentionally reset to unverified. Preserve phone/locale/time zone/profile/custom fields and historical restrictions/suspension as inspectable values; no source role/MFA/verification grants authority. |
| Organization | id/name/domain_names/timestamps→company/domain rows. | Only default membership; no domain-based access. details/notes/external_id/custom fields/tags/group/tree metadata have no native place. shared_comments/shared_tickets/ticket_restriction are not activated. Add inspectable company attributes and explicit reviewed relationship/policy mappings. |
| Group | id/name/updated_at→ticket_groups. | No members/default; creation time is provenance, deleted groups refused. Description/privacy are lost. Import memberships as pending mappings to current principals and preserve their exact source policy; activate only after review. |
| Macro | id/title/timestamps; exactly one reply action; comment_mode_is_public; priority/status/current_tags/remove_tags. | Known requester/assignee/current-user/title/id/url/organization-name placeholders translate. Unknown placeholders remain visible and block send; Liquid logic/attribute placeholders/restricted macros refused. HTML becomes Markdown. Other actions are individually omitted; active/default/order/description/raw title have no mapped behavior. Add full declared action/placeholders coverage to inactive native drafts; refuse the whole semantic unit when a condition/action cannot safely translate. |
| Trigger/automation | title/id/order/timestamps→draft native rules; supported conditions/actions. | Predicates: status/priority is/is_not, group_id is/is_not, supported tag contains operators, status less_than solved. Actions: status/priority/group/add-remove tags. Automation accepts exactly one supported all-condition hours_since_* greater_than clock; native hour-boundary/once-per-episode semantics differ. Any other condition/action rejects the whole rule; active is deliberately not activated. Add missing source semantics to native sandboxable drafts, keep category/default/raw metadata visible and do not equate native execution to Zendesk without a test-ticket comparison. |
| View | id/title/timestamps, supported all-conditions, supported sort. | any conditions/restrictions/unsupported sorting refuse; imported view is personal. execution.columns/group_by/group_order are recognized by shapes.ts but unused by zendesk-configuration.ts, so they need field-specific omissions and native presentation mappings; position/default/description are lost. |
| Article | id/title/updated_at, public publication/draft, HTML→Markdown. | created_at is source provenance; slug regenerated; position reset, section/category absent. Restricted valid audience is held back with no searchable/public native content; unknown audience rejected. Locale/translation/structure/editor permissions/labels/authorship/votes are not reproduced. Add native hierarchy, locale/version/provenance and permission review; keep restricted records inactive until an equally restrictive native mapping exists. |
| Ticket attachment | Supplied bounded bytes and id/file_name/content_type/size→native media; digest checked, comment/note visibility and distinct same-name identities retained. | URL-only records have no bytes; URLs are removed/refused under credential policy. Current offline bound is 48 KiB/file, 20/ticket and six passive MIME types, inside 128 KiB/record and 2 MiB/upload; larger/zero-byte/other MIME files are refused, not successful imports. Inline placement/thumbnails/dimensions lack mappings. Offline suppliedAttachments does not inspect deleted/malware flags: add pre-effect refusal/quarantine, including no override bypass. Reuse separate native media paths; do not evade offline bounds by silently switching to live Fetch files. |
| Article attachment | None in offline article mapping. | All documented returned metadata and supplied bytes need article-bound private/public native media and locale/inline bindings with audience enforcement. Do not turn signed content_url into a public link. |

For all noncredential business drops, build a typed native operational place where the value affects support work, or an inspectable, source-linked historical place where it describes the past. Document computed API URLs/counters in provenance rather than claiming to recreate the vendor API. Credentials, executable queues, stale sessions, verification trust and malware access overrides intentionally gain no active place; their omission or inactive state must still be named. Engineering difficulty is not a reason to omit fields from the build scope.

Confirmed source-level faults and proof limits

The planner ran a dependency-free probe against the existing packer, writing only external temporary synthetic files. A complete two-page comments response, with Zendesk's non-null next_page on page 1 and both pages supplied, produced two comments but `_offline.comments_complete:false`. `scripts/pack-zendesk-offline.mjs:68,79` incorrectly requires every page's next_page to be null. Separately, a users response with a non-null next_page and no supplied second page packed successfully and lost the continuation metadata. Both results are in `source-probes.json`; the former will be rejected by the existing offline mapper, the latter can hide an incomplete people export. Correct page-chain validation must distinguish an intermediate link from an omitted final page, including empty pages, duplicate/conflicting pages and cursors.

The same probe generated the existing 1,000-ticket capacity fixture: 937,603 bytes, 1,104 source records; New/Open/Pending/Hold 167 each and Solved/Closed 166 each, but zero supplied attachment bindings. The Business fixture has 312 tickets and 52 old Closed tickets. Existing source does contain the small attachment/history journey and 1440/390 browser flow. This planner did not execute them or any app/browser/hosted suite. Probe Node was v24.19.0; builders must use the repository's Node 22.20.0 and pnpm 10.12.4. No paid API, account login or provider credential was used for planning or probes.

Legacy mapping boundaries

The legacy matrix distinguishes native CLI restoration from mounted historical adoption. CLI maps users and memberships but omits passwords; mounted historical adoption deliberately maps no users/user_settings/memberships/ai_defaults, preserves source author attribution and maps any assignment only through current native identity. Historical AI profiles are disabled; grants/devices/jobs remain revoked/cancelled/uncertain. A restoration test cannot prove the safer mounted profile by implication.

Native legacy data already maps UUIDs, contact identity/metadata, conversations/transcript order and authorship, private notes, supported assignment/insight events, participants, categories/articles/pivots, saved replies, published dataset Markdown, plugin configuration, widget settings and media. DECIMAL charges become exact safe minor units or fail; original financial/usage rows remain inert history, never balances/payments. Source event types outside INTERNAL_NOTE/AGENT_ASSIGNED/USED_INSIGHT are excluded. Soft-deleted rows are archived, not revived. Duplicate local message IDs are renamed; missing requesters use a noncontactable system identity; closed-time fallback, publication inference and explicit model selection are losses that must be shown.

Dataset runtime/crawl/provider state is not resumed: next_refresh_at/claim_token are cleared, unsupported refresh modes fall back to manual with a hold; only publication-proven retained files become knowledge. Mail imports disabled; native credentials and verified channel configuration need separate setup. Native work/read state differs deliberately: full history is marked read, trigger-generated work is removed, and the default close rule becomes a draft. Delta changes only source-changed/native-unchanged rows, preserves native edits/deletion/erasure and never overwrites project/identity state. Mounted historical package adoption and CLI delta are distinct doors; do not claim mounted delta parity without implementing/testing it.

Known legacy widget differences are named, not hand-waved: `settings.show_glow.on_insight_reply`, `.on_ai_typing`, `.on_human_typing`, `settings.ai.enabled`, `settings.ai.types`, `settings.collector.enabled`, `text.errors.connection`, default `text.collect.placeholder_email`, default `text.prompt.placeholder_email`, and `app_logo`; unread callouts/settings.header branches are not native behavior. Existing `widgetNotReproduced`/`mediaUrls.left` summaries identify these limits. Build useful supported appearance/copy behavior, keep AI/tracking authority explicit and make remaining historical settings inspectable; never silently enable tracking to reproduce a source switch.

Actual exporter omissions are catalogued in `LEGACY-OMISSION-POLICY.json`: exact column/table names and structured paths, never values. Text-policy redaction additionally removes credential/cookie/authentication/capability values in support text, raw diagnostic payloads and their repeated copies. Preserve readable redacted history and omission counts; do not import secrets to achieve a superficial field total. The mounted upload excludes `ai_usages` by default even though explicit opted-in historical import exists. All other archive-only business fields listed below need a report and a supported place for their retained meaning; no provider/account work is needed to build that.

Synthetic fixture and end-to-end proof specification

Extend the committed generators; add a repo script `scripts/generate-import-proof.mjs` that uses a fixed seed 271828, fixed UTC clocks, stable IDs and stable ordering to emit source files, packing manifests, safe expected counts/IDs/hash ledgers and clean/corrected/hostile variants. Generation twice must produce byte-identical output. Replace per-run RSA fixture-key randomness where used in accepted packages with fixed public test data; never put credential-shaped secret test values in published evidence. Expected outcomes come from the source specification, not from calling product mappers to predict themselves.

Zendesk core corpus: 1,000 tickets, 120 end users, three historical staff and 12 organizations; 167 New/Open/Pending/Hold and 166 Solved/Closed, including old archived Closed tickets. Each ticket has one public request, one staff public answer and one private note: 2,000 public messages and 1,000 private notes. Include no-email and staff requesters, system author -1, exact-email historical/current-member collisions, nondefault ticket organization and multiple memberships, all supported typed fields, custom statuses and every catalogued business field. Keep Unicode/RTL/combining characters/emoji, quotes, nested metadata, null/empty/absent values, duplicate identical IDs, conflicting duplicate IDs and out-of-order components. Use numeric Zendesk IDs and example-domain addresses; every human-readable synthetic identity is `synthetic-hh-<n>`.

Generate documented plural API files with at least three pages for tickets/users, three comment pages for a designated ticket, cursor and offset variants, and incremental end_of_stream metadata. Include empty intermediate/terminal pages, an omitted middle page, repeated/conflicting pages, false completeness/count and malformed cursor variants. Each admitted upload remains within 2 MiB expanded, 5,000 positions/derived records, 64 ZIP entries and 128 KiB/complete ticket. Split into complete dependency-bearing uploads rather than raising limits; report expected deduplication across files. An over-limit complete ticket is a located refusal, not a truncated success.

Attachment/history cohort: 24 tickets with paired public/private small deterministic text/PDF/image files, duplicate filenames with different IDs/hashes, inline metadata and URL-only examples; auditable status changes and activate/pause/fulfill/apply_sla/breach metric events including elapsed business/calendar units, unknown events, absent vs empty event files and group_sla metadata. Add article fixtures with public published, public draft, valid restricted and malformed-audience articles, two locales, hierarchy, article attachments and permission review. Configuration cohort: two groups plus membership records, one macro with reply/priority/status/tag actions and supported placeholders, another with unresolved expressions, one view with columns/group/sort, weekly calendar+holiday, one supported and one unsupported SLA policy, two forms with typed fields, and a trigger/automation pair plus unsafe counterparts. Supply separate local files; a custom packer may join them but must retain original pointers.

Legacy cohort: deterministic documented chunk package for one source workspace plus a second isolation/control workspace, 1,000 conversations/3,000 messages, notes, published/draft knowledge, macros, media, exact decimal history, revoked historical principals and every retained schema column represented by safe synthetic data. Use small row chunks to force multiple worker turns, more than 200 descriptors to paginate status, multiple context parts, and binary byte hashes. All chunks/objects respect mounted limits. Include malformed manifests/digests, foreign-scope rows, missing components, symlink/path traversal fixtures in local packing, excluded usage, interrupted/resumed application, native-edit conflicts, a deterministic CLI delta and native erasure. Unknown columns/paths get names and reasons; no real export or MySQL account is required to generate this package.

Proof runs on a clean disposable native installation through `pnpm exec rer dev --foreground`, the emitted private owner entry and actual sessions; do not fake application data. Upload/review/apply through `/app/move-in` and mounted `/api/move-in/projects/:projectId/imports` routes. Legacy uses its folder UI and mounted `/api/move-in/projects/:projectId/legacy-import/:sha/{manifest,files,status}` plus current adoption/start controls, not direct database seeding as the proof door. CLI restoration/delta is tested separately through documented commands. Direct database/object snapshots may observe results, never substitute for admission or publish records.

Before approval, compare full business state and object hashes to baseline; review changes no native business data. Bind apply to the exact reviewed fingerprint/manifest and current reviewer. Stop after a genuinely committed batch, reopen/sign in, resume, then reconcile source counts, native IDs, requester/company/ownership, public/private transcript ordering, typed values, attachment SHA-256 and history availability/events. Read native inbox/ticket/contact/company/macros/workflows/help-centre/media APIs and screens. At both 1440 and 390, functionally operate upload, omissions/report pagination, approval, stopped/resume, ticket details, fields, private history, downloads, configuration previews, repeat and undo; take screenshots as evidence, not as the sole assertions. Reload and test keyboard disclosure/focus and mobile control access. Customer, other-customer, other-workspace and revoked-reviewer requests must be denied appropriately; restricted knowledge never enters public search or retrieval.

Re-import byte-identical and harmlessly repackaged data: exact business rows and all attachment objects are unchanged, with only the contract's named counters/sequences, audit and import journals excluded. Corrected source/native edits show explicit changes/conflicts without overwrite. Whole-import undo restores exact prior business state and preserves intervening native edits. Erase an imported requester through the native public door; comments/notes/media/personal history/custody disappear and original/corrected replay, resume and portable restore cannot revive them. Preserve unrelated people/workspaces. Assert zero outbound network/mail/widget sends/model calls/payment/provider work, no source-trigger activation, no notifications, no new SLA clocks/alerts and no imported-history inflation in Reports.

Hostile test uploads include broken JSON/UTF-8, duplicate keys, ZIP traversal/bombs, nested/record limits, token-bearing links, contradictory privacy, missing pages/relationships, tampered hashes/sizes and unauthorized principals. Admission refusals must leave custody, jobs, native state and objects unchanged. A well-formed upload containing a semantically refused record may retain private review custody, but that record creates no native effect; reports must distinguish this from whole-upload refusal. Never claim global “no side effects” for a partially accepted batch that correctly published unrelated reviewed records.

The operator gets a paginated/downloadable field report with source file/physical row/JSON pointer/kind/source ID, original field name, mapped destination, exact transformation or dropped/held/rejected reason, record/byte counts and reviewable next action. Never include source secret values. Totals reconcile supported, lossy, held, rejected, duplicate and archive-only records/fields; those categories cannot inflate native-success counts. Every dictionary key in user_fields/organization_fields/custom metadata is covered, including when diagnostic display is truncated; a continuation/export must expose the full field-name list.

Release handoff is a tested source candidate and full synthetic receipts under normal repository verification/landing rules. Run touched journeys/typecheck; regenerate CONTRACT-derived views only after real evidence, then source lock/check and first-party check after all edits. Full verification/browser checks use the designated runner. No task may self-upgrade global all-vendor/live clauses or label the feature released merely because a branch/evidence transfer exists. Production release authorization remains with the owner/lander; this planner launches nothing.

External holds (separate from the buildable synthetic work)

- HELD-EXTERNAL: live Zendesk/OAuth/final channel and historical-notification rehearsal needs one owner-authorized Zendesk sandbox with its test support channel. Build the offline format, deterministic sandbox transport tests and simulated cutover now; do not seek a token.
- HELD-EXTERNAL: Business-minted grants/stage rehearsal needs one authorized Business integration environment. Existing developer-generated grant tests are supporting local evidence only.
- HELD-EXTERNAL: actual production release/deploy needs the owner's release authorization through the normal release workflow. The current assignment authorizes no deployment.
- Unavailable context: owner DIRECTION.md/AGENTS.md needs an accessible read-only copy or corrected repository URL; this is not a need for live customer/account data.

Single sentence for the import's own report

“Not carried into your workspace: {count} fields and {count} files listed below, with each source record, reason and next action; restricted content and historical permissions stay inactive, and no old credentials or running jobs were restored.”

Field inventory (source audit; current mapping, not a claim of test passage)

Zendesk fields absent from native operational mapping are named below. For each, the reason and required place are the resource-specific rules above and the per-field matrix row. API request-only properties are separately classified in the CSV and are not alleged to be missing export records.

- tickets: `allow_attachments`, `allow_channelback`, `brand_id`, `collaborator_ids`, `due_at`, `email_cc_ids`, `encoded_id`, `external_id`, `follower_ids`, `followup_ids`, `forum_topic_id`, `from_messaging_channel`, `generated_timestamp`, `has_incidents`, `organization_id`, `problem_id`, `raw_subject`, `recipient`, `satisfaction_rating`, `sharing_agreement_ids`, `submitter_id`, `support_type`, `ticket_form_id`, `type`, `url`, `via.source.from`, `via.source.to`, `via.source.rel`.
- comments: `audit_id`, `html_body`, `type`, `metadata.*`.
- users: `active`, `alias`, `chat_only`, `custom_role_id`, `default_group_id`, `details`, `iana_time_zone`, `last_login_at`, `locale`, `locale_id`, `moderator`, `notes`, `only_private_comments`, `phone`, `photo`, `remote_photo_url`, `report_csv`, `restricted_agent`, `role_type`, `shared`, `shared_agent`, `shared_phone_number`, `signature`, `suspended`, `suspension_details`, `ticket_restriction`, `time_zone`, `two_factor_auth_enabled`, `url`, `user_fields`, `user_fields.*`.
- organizations: `children_count`, `details`, `external_id`, `group_id`, `notes`, `organization_fields`, `tags`, `url`, `organization_fields.*`.
- groups: `description`, `is_public`, `url`.
- memberships: `created_at`, `default`, `group_id`, `id`, `updated_at`, `url`, `user_id`.
- macros: `active`, `default`, `description`, `position`, `raw_title`, `url`.
- triggers: `category`, `category_id`, `default`, `description`, `raw_title`, `url`.
- automations: `default`, `raw_title`.
- views: `default`, `description`, `position`, `execution.columns`, `execution.group_by`, `execution.group_order`, `execution.group`, `execution.sort`.
- articles: `author_id`, `comments_disabled`, `content_tag_ids`, `downvote_count`, `edited_at`, `html_url`, `label_names`, `locale`, `outdated`, `outdated_locales`, `permission_group_id`, `position`, `promoted`, `section_id`, `source_locale`, `upvote_count`, `url`, `vote_count`, `vote_sum`.
- attachments: `deleted`, `height`, `inline`, `malware_access_override`, `malware_scan_result`, `mapped_content_url`, `thumbnails`, `url`, `width`, `thumbnails[*].*`.
- article-attachments: `article_id`, `content_type`, `content_url`, `created_at`, `file_name`, `guide_media_id`, `id`, `inline`, `locale`, `size`, `updated_at`, `url`.

Legacy schema fields are grouped exhaustively by current outcome. M/L are conditional on admitted, nondeleted rows and the selected CLI/historical profile, as explained above. D is original/archive-only and needs an inspectable business/history place, not a silent-success count. OMITTED/EXCLUDED must remain absent from active product state for the stated security/telemetry/runtime reason; the operator still sees their names/counts. All children of structured paths are covered by the recursive field report.

- users — L: `id`, `name`, `email`, `timezone`, `type`, `avatar_url`, `is_notifiable_on_conversation_assignment`, `created_at`; D: `email_verified_at`, `global_inbox_appearance`, `ai_profile`, `ai_profile_at`, `ai_profile_count`, `last_login_ip`, `last_login_country`, `last_login_at`, `updated_at`, `deleted_at`; OMITTED: `password`, `remember_token`.
- password_resets — EXCLUDED: `email`, `token`, `created_at`.
- media — M: `id`, `extension`, `mime_type`, `size`, `created_at`; L: `disk`, `directory`, `filename`, `filename_original`, `url`, `original_media_id`; D: `aggregate_type`, `variant_name`, `updated_at`, `alt`.
- mediables — L: `media_id`, `mediable_type`, `mediable_id`; D: `tag`, `order`.
- telescope_entries — EXCLUDED: `sequence`, `uuid`, `batch_id`, `family_hash`, `should_display_on_index`, `type`, `content`, `created_at`.
- telescope_entries_tags — EXCLUDED: `entry_uuid`, `tag`.
- telescope_monitoring — EXCLUDED: `tag`.
- failed_jobs — EXCLUDED: `id`, `connection`, `queue`, `payload`, `exception`, `failed_at`, `uuid`.
- waitlist — EXCLUDED: `id`, `email`, `name`, `url`, `created_at`, `updated_at`.
- projects — M: `id`, `name`, `created_at`, `slug`, `is_availability_schedule_enabled`, `timezone`, `is_contact_tracking_enabled`, `help_center_domain`, `is_human_response_enabled`, `avatar_url`; L: `updated_at`, `deleted_at`, `email_from_address`, `email_from_name`, `availability_schedule`, `widget_settings`, `website`, `default_visitor_ai_id`, `metadata`, `default_verified_user_ai_id`; D: `widget_settings_hash`, `is_collection_created`, `ai_profile_at`, `ai_profile`, `ai_profile_count`, `proxy_other_requests_count`, `proxy_html_requests_count`, `ai_level`, `ai_balance`, `ai_monthly_budget`, `stripe_id`, `pm_id`, `pm_type`, `pm_last_four`, `pm_error`, `pm_expires_at`, `is_ai_balance_top_up_enabled`, `ai_balance_top_up_when_below`, `ai_balance_top_up_amount`, `is_ai_level_dynamic`, `is_proxy_only`; OMITTED: `verification_secret`.
- contacts — M: `id`, `project_id`, `country_code`, `timezone`, `language`, `ip_address`, `avatar_url`, `created_at`; L: `nickname`, `name`, `provided_name`, `email`, `provided_email`, `identifier`, `metadata`, `is_verified`, `blocked_at`, `deleted_at`; D: `ai_profile_at`, `ai_profile_count`, `ai_profile`, `last_seen_at`, `updated_at`; OMITTED: `user_agent`, `key_hashes`.
- conversations — M: `id`, `project_id`, `created_at`, `updated_at`; L: `agent_id`, `contact_id`, `ai_id`, `last_message_id`, `resolved_at`, `deleted_at`; D: `metadata`, `ai_thoughts_at`, `ai_thoughts`, `is_ai_locked`, `is_ai_selected`, `unread_contact_messages_count`, `unread_agent_messages_count`, `last_message_at`.
- messages — M: `id`, `project_id`, `conversation_id`, `bucket_id`, `content`, `created_at`; L: `contact_id`, `agent_id`, `local_id`, `deleted_at`; D: `read_by_agents`, `read_by_contacts`, `notified_by`, `notified_at`, `updated_at`, `local_agent`; OMITTED: `content_raw`.
- connections — D: `id`, `project_id`, `conversation_id`, `contact_id`, `agent_id`, `is_internal`, `is_proxy`, `created_at`, `updated_at`, `deleted_at`; OMITTED: `shared_key`, `contact_shared_key`, `contact_shared_key_id`, `page_content`.
- project_users — L: `project_id`, `user_id`, `role`; D: `id`, `invited_by_id`, `invitation_email`, `is_notified_on_unassigned_activity`, `is_primary`, `accepted_at`, `created_at`, `updated_at`; OMITTED: `invitation_token`.
- buckets — M: `id`, `conversation_id`, `created_at`; L: `project_id`, `first_message_id`, `last_message_id`, `counts`, `is_vectorized`, `updated_at`.
- macros — M: `id`, `project_id`, `created_by_id`, `title`, `content`, `created_at`, `updated_at`.
- events — M: `id`, `conversation_id`, `bucket_id`, `agent_id`, `created_at`; L: `type`, `payload`; D: `contact_id`, `local_agent`.
- conversation_participants — M: `id`, `conversation_id`, `contact_id`, `created_at`; D: `updated_at`.
- categories — M: `id`, `project_id`, `slug`, `summary`; L: `_lft`, `parent_id`, `title`, `published_at`; D: `_rgt`, `created_by_id`, `modified_by_id`, `created_at`, `updated_at`.
- articles — M: `id`, `project_id`, `title`, `slug`, `summary`, `content`, `updated_at`; L: `published_at`; D: `created_by_id`, `modified_by_id`, `created_at`.
- article_categories — M: `article_id`, `category_id`; D: `id`, `created_at`, `updated_at`.
- plugins — M: `id`, `project_id`, `name`, `position`, `created_at`; L: `url`; D: `created_by_id`, `modified_by_id`, `updated_at`.
- datasets — M: `id`, `project_id`, `last_refreshed_at`, `refresh_unchanged_count`, `max_crawl_depth`, `max_crawl_pages`, `created_at`; L: `url`, `excluded_urls`, `refresh_mode`, `next_refresh_at`, `refresh_claimed_at`, `status`; D: `external_id`, `staged_external_id`, `crawl_run_id`, `refresh_interval_days`, `refresh_claim_reason`, `last_refresh_attempt_at`, `pages_count`, `metadata`, `updated_at`; OMITTED: `crawl_webhook_token`, `refresh_claim_token`, `status_message`.
- ais — M: `id`, `project_id`, `type`, `name`, `avatar_url`, `is_animated`, `created_at`; L: `role`, `prompt`, `is_enabled`; D: `updated_at`.
- collectors — M: `id`, `project_id`, `contact_id`, `actions_count`, `last_run_at`, `created_at`, `analysis_count`; L: `running_at`, `analysis_actions`, `analysis_since_insight`; D: `summary_count`, `updated_at`; OMITTED: `data`.
- collector_actions — D: `id`, `project_id`, `contact_id`, `updated_at`, `created_at`; OMITTED: `action`, `contact_shared_key_id`.
- collector_summaries — D: `id`, `project_id`, `contact_id`, `metadata`, `total_actions`, `total_pages`, `total_summaries`, `start_at`, `end_at`, `updated_at`, `created_at`; OMITTED: `summary`.
- asymmetric_keys — EXCLUDED: `id`, `project_id`, `contact_id`, `agent_id`, `public_key`, `private_key`, `metadata`, `updated_at`, `created_at`.
- ai_defaults — M: `id`, `type`, `role`, `prompt`, `created_at`; D: `updated_at`.
- insights — M: `id`, `contact_id`, `project_id`, `content`, `closed_at`, `created_at`; D: `ai_id`, `ai_type`, `metadata`, `analysis`, `activated_at`, `updated_at`.
- dataset_files — M: `id`, `dataset_id`, `url`, `title`; L: `original_url`, `markdown`, `created_at`, `updated_at`; D: `project_id`, `file_id`, `vector_store_id`, `rank`; OMITTED: `html`.
- ai_usages — D-default/L-opt-in: `id`, `project_id`, `tag`, `model`, `usage`, `created_at`, `contact_id`, `cost`.
- ai_logs — EXCLUDED: `id`, `project_id`, `tag`, `model`, `request`, `response`, `created_at`, `ai_usage_id`, `schema`, `tools`.
- contact_shared_keys — EXCLUDED: `id`, `project_id`, `contact_id`, `last_connection_id`, `hash`, `salt`, `updated_at`, `created_at`.
- job_batches — EXCLUDED: `id`, `name`, `total_jobs`, `pending_jobs`, `failed_jobs`, `failed_job_ids`, `options`, `cancelled_at`, `created_at`, `finished_at`.
- jobs — EXCLUDED: `id`, `queue`, `payload`, `attempts`, `reserved_at`, `available_at`, `created_at`.
- charges — M: `id`, `project_id`, `stripe_id`, `created_at`; L: `amount`, `status`; D: `receipt_url`, `invoice_url`, `updated_at`.
- project_optimizations — D: `id`, `project_id`, `metadata`, `ai_profile_at`, `ai_profile`, `ai_profile_count`, `created_at`, `updated_at`.
- leads — D: `id`, `project_id`, `source`, `website`, `website_html`, `email`, `name`, `subject`, `content`, `error`, `status`, `sent_at`, `created_at`, `updated_at`.
- project_github_connections — D: `id`, `project_id`, `github_user_id`, `github_login`, `scopes`, `connected_at`, `created_at`, `updated_at`; OMITTED: `access_token`.
- message_thinkings — D: `id`, `project_id`, `conversation_id`, `message_id`, `local_id`, `seq`, `model`, `content`, `created_at`; OMITTED: `thinking_id`, `signature`.
- migrations — EXCLUDED: `id`, `migration`, `batch`.
- elastic_migrations — EXCLUDED: `migration`, `batch`.
- local_agent_device_authorizations — EXCLUDED: `id`, `client_session_id`, `device_code_hash`, `user_code_hash`, `name`, `provider`, `capabilities`, `status`, `approved_project_id`, `approved_by_user_id`, `local_agent_grant_id`, `expires_at`, `approved_at`, `denied_at`, `redeemed_at`, `created_at`, `updated_at`.
- local_agent_device_project_settings — M: `local_agent_device_id`, `project_id`, `working_directories`; D: `id`, `created_at`, `updated_at`.
- local_agent_devices — M: `id`, `project_id`, `local_agent_grant_id`, `name`, `provider`, `last_seen_at`, `max_concurrent_tasks`, `created_at`; L: `operator_id`, `client_session_id`, `capabilities`, `worker_ready_at`, `worker_mode`, `revoked_at`, `updated_at`; D: `local_agent_pairing_id`; OMITTED: `token_hash`.
- local_agent_grants — M: `id`, `project_id`, `created_at`; L: `operator_id`, `revoked_at`, `updated_at`; D: `last_used_at`; OMITTED: `token_hash`.
- local_agent_pairings — EXCLUDED: `id`, `project_id`, `operator_id`, `code_hash`, `expires_at`, `consumed_at`, `created_at`, `updated_at`.
- personal_access_tokens — EXCLUDED: `id`, `tokenable_type`, `tokenable_id`, `name`, `token`, `abilities`, `last_used_at`, `expires_at`, `created_at`, `updated_at`.
- prompt_plans — EXCLUDED: `id`, `project_id`, `stable_hash`, `stable_prompt`, `dynamic_example`, `metadata`, `retrievals`, `ai_plan`, `ai_plan_at`, `ai_plan_count`, `created_at`, `updated_at`.
- support_delegation_events — M: `id`, `support_delegation_id`, `event_type`, `message`, `payload`, `created_at`; D: `created_by_user_id`, `event_id`.
- support_delegations — M: `id`, `project_id`, `conversation_id`, `local_agent_device_id`, `request_id`, `mode`, `instructions`, `run_id`, `expected_last_message_id`, `context`, `result`, `parent_support_delegation_id`, `source_proposal_id`, `started_at`, `created_at`; L: `created_by_user_id`, `status`, `claim_id`, `session_id`, `cancel_requested`, `delivery_state`, `completed_at`, `updated_at`; D: `result_note_event_id`.

Explicit removed nested legacy paths: `events.payload.contact_message.contact.hash`, `events.payload.contact_message.contact.metadata.hash`, `events.payload.contact_message.contact.metadata.admin`, `messages.content.data.clientConfiguration.braintreeApi.accessToken`, `messages.content.data.tokenizeUsBankAccount.paymentMethod.id`, `messages.content.data.tokenizeUsBankAccount.paymentMethod.legacyId`, `contacts.metadata.admin`, `conversations.metadata.customer_reply`, `conversations.metadata.suggestions`. Unknown credential-like paths refuse export; redaction values never belong in a report.

Packet and validation: REPORT.md, SOURCE-RECEIPT.json, source-probes.json, PUBLIC-SOURCES.json, ZENDESK-FIELD-MATRIX.csv, LEGACY-FIELD-MATRIX.csv and LEGACY-OMISSION-POLICY.json are retained under `$HOME/rer-consolidation/work/ct-import-plan-happytohelp-1/packet/`. All are actual regular non-secret report/receipt files; research HTML, application data, environment files and hostile credential fixture values are not publication selections. Read-only product provenance and probe limits are recorded in SOURCE-RECEIPT.json.

Five bounded builder entries, in priority order; only the local feeder updates the lane plan:

```queue-entries
[
  {
    "priority": 1,
    "role": "builder",
    "seed": "happytohelp",
    "repository": "just-every/run-happytohelp",
    "status": "BUILDABLE-NOW",
    "title": "Fix offline page completeness and account for every source field",
    "contract": [
      "ZENDESK-IMPORT-001 AP1/AP5",
      "MOVE-IN-001 AP1",
      "MOVE-IN-002 AP1",
      "MOVE-IN-004 AP2"
    ],
    "acceptance": [
      "Correct supplied offset/cursor page-chain validation, including empty/intermediate/terminal pages; refuse genuinely missing or inconsistent pages without fetching URLs.",
      "Preserve envelope/provenance and name every lossy/dropped field, including schema-known unused keys and every dynamic metadata key; expose the complete paginated/downloadable report without secret values.",
      "Add deterministic documented-source generator and independent expected field/count/hash ledger; preserve current byte/record/ZIP limits."
    ],
    "files": [
      "scripts/pack-zendesk-offline.mjs",
      "scripts/generate-import-proof.mjs (new)",
      "src/modules/move-in/readers/{records,shapes,zendesk-offline}.ts",
      "src/modules/move-in/review-report.ts",
      "src/ui/native/pages/{MoveInReview,MoveInReport}.jsx",
      "docs/moving-in.md"
    ],
    "tests": [
      "tests/move-in/{generator,zendesk-offline-fixture,zendesk-offline,zendesk-offline-browser}.mjs",
      "tests/journeys/move-in-admission.mjs",
      "tests/journeys/move-in-browser.mjs"
    ],
    "proof": "Both reproduced packer defects turn green; missing-middle/empty/duplicate/cursor cases and schema-known unused execution columns are asserted; generation is byte-identical twice; every source path reconciles to mapped/lossy/held/refused with native-success totals kept separate; report works at 1440/390.",
    "must_not_touch": [
      "No network exporter, token setup, live source, raised admission bounds or replacement import engine.",
      "Do not modify byte-exact Base sources, other-vendor semantics or contract Status without executed evidence."
    ]
  },
  {
    "priority": 2,
    "role": "builder",
    "seed": "happytohelp",
    "repository": "just-every/run-happytohelp",
    "status": "BUILDABLE-NOW",
    "title": "Preserve the Zendesk people and ticket relationship graph without activating authority",
    "contract": [
      "ZENDESK-IMPORT-001 AP2/AP5/AP6",
      "MOVE-IN-002 AP1/AP2",
      "MOVE-IN-003 AP1/AP2",
      "FORMS-001 AP1/AP2",
      "CUSTOMER-001 AP1"
    ],
    "acceptance": [
      "Add native/scoped historical places for the catalogued ticket/user/organization business fields: ticket-specific company, submitter, source external/encoded IDs, participants/CC/followers, task/incident/follow-up links, source custom status/form, phone/locale/timezone/details/custom attributes and source restriction/suspension state.",
      "Preserve typed custom values and form/field definitions without silent missing-definition loss, and inspect metadata/provenance distinctly from active settings.",
      "Remove pre-review assignment activation through matchedAgents/importedAssignee; keep explicit ownership activation, no source login/trust/company access, exact repeat/undo and erasure."
    ],
    "files": [
      "src/modules/move-in/{preparation,ticket-import,source-ownership,ownership,email-threading}.ts",
      "src/modules/move-in/readers/{normalise,companies,zendesk-fields,shapes}.ts",
      "src/modules/tickets/",
      "src/modules/customers/",
      "src/modules/forms/",
      "src/ui/native/pages/{ContactDetails,Companies,MoveInOwnership}.jsx and src/ui/dashboard/components/ticket-panel/",
      "next uniquely numbered migrations and RELEASE.json buyer steps"
    ],
    "tests": [
      "tests/move-in/{ticket-identity,door-field-visibility,configuration-source,configuration-review}.mjs",
      "tests/helpers/email/vendor-replies.mjs",
      "tests/journeys/{move-in-admission,move-in-custody,move-in-erasure,move-in-browser,email}.mjs"
    ],
    "proof": "Independent source/native comparison for all catalogued fields and both default-vs-ticket company cases; a historical staff email matching a current member stays unassigned until explicit activation; Solved/Closed threading, private notes, native edits, erasure and corrected replay pass; details function at 1440/390.",
    "must_not_touch": [
      "Do not import source credentials, verify a customer, infer domain entitlement, send notifications or auto-activate memberships/assignment.",
      "No other-vendor expansion, active SLA/procedure/reporting redesign or source-money behavior."
    ]
  },
  {
    "priority": 3,
    "role": "builder",
    "seed": "happytohelp",
    "repository": "just-every/run-happytohelp",
    "status": "BUILDABLE-NOW",
    "title": "Qualify supplied Zendesk media, inert history and help-centre custody through Move in",
    "contract": [
      "ZENDESK-IMPORT-001 AP1/AP3/AP4/AP5/AP6",
      "MOVE-IN-002 AP1/AP2",
      "KNOWLEDGE-001 AP1",
      "KNOWLEDGE-002 AP1/AP2",
      "UI-001 AP1"
    ],
    "acceptance": [
      "Refuse/quarantine source-deleted or malware-flagged supplied attachments before native effect; preserve dimensions/inline/thumbnail metadata, source identity and inspected history without bypassing passive-media guards or current bounds.",
      "Map article hierarchy/locales/authorship/labels/publication/permission history and supplied article attachment bytes under equally restrictive native audiences; hold unresolved restricted content safely.",
      "Complete mounted owner upload/review/apply/resume/read/undo/erasure proof for attachment bytes and audit/metric/group_sla history, including absent versus empty/unknown events and inertness; retain all historical meaning in adapter fingerprints and portable custody."
    ],
    "files": [
      "src/modules/move-in/{supplied-attachments,attachment-schema,targets,review-records}.ts",
      "src/modules/move-in/readers/{zendesk-offline,normalise,shapes}.ts",
      "src/modules/knowledge/",
      "src/modules/conversations/routes.ts",
      "src/ui/dashboard/components/ticket-panel/ and src/ui/native/pages/{MoveInReview,MoveInReport,KnowledgePage}.jsx",
      "scripts/pack-zendesk-offline.mjs",
      "next uniquely numbered migrations and RELEASE.json buyer steps"
    ],
    "tests": [
      "tests/move-in/{zendesk-offline-fixture,zendesk-offline,zendesk-offline-browser,business-equality}.mjs",
      "tests/journeys/{move-in-admission,move-in-browser,move-in-erasure,move-in-capacity,restore}.mjs"
    ],
    "proof": "The 24-ticket attachment/history cohort plus article hierarchy/locales downloads exact SHA-256 bytes through native access; private/restricted data denies customer/foreign workspace/search; malware/deleted/ambiguous/tampered bytes have no native effect; all six offline AP outcomes run through mounted owner doors, including mixed 1,000-ticket capacity, 1440/390 interactions, reload, exact repeat/undo/object equality and portable erasure fences.",
    "must_not_touch": [
      "No live Fetch files, URL downloading, paid APIs, policy activation, SLA clocks/alerts, model work, provider calls or historical Reports inflation.",
      "Do not widen knowledge access, replace original source custody or raise the established offline file/record/upload limits."
    ]
  },
  {
    "priority": 4,
    "role": "builder",
    "seed": "happytohelp",
    "repository": "just-every/run-happytohelp",
    "status": "BUILDABLE-NOW",
    "title": "Carry the documented Zendesk configuration into reviewed native drafts",
    "contract": [
      "MOVE-IN-004 AP1/AP2",
      "MOVE-IN-002 AP1/AP3",
      "MACRO-001 AP1/AP2/AP3",
      "AUTOMATION-001 AP1/AP2/AP3",
      "AUTOMATION-002 AP1/AP2/AP3",
      "QUEUE-001 AP1",
      "SLA-001 AP1/AP2/AP3",
      "FORMS-001 AP1/AP2"
    ],
    "acceptance": [
      "Implement the fixed catalogued configuration gaps: group descriptions/privacy/pending member/default mappings; macro action/placeholder/scope/order/description fidelity; view any-conditions/columns/grouping/sorting/order and audience; rule category/condition/action meanings; schedules/holidays, explicit SLA association and disabled forms.",
      "Where the fixed documented source meaning lacks a native model, add its model and sandboxable behavior; field history alone is not an operational configuration mapping. Preserve source active/default semantics for review but activate nothing during import.",
      "Keep whole-rule/form refusal for unresolved semantics, show every exact transformation, simulate selected drafts on test tickets and require explicit current-admin publication."
    ],
    "files": [
      "src/modules/move-in/readers/{zendesk-configuration,zendesk-macro,zendesk-fields,shapes,normalise}.ts",
      "src/modules/{macros,tickets,workflows,forms}/",
      "src/modules/move-in/ownership.ts",
      "src/ui/native/pages/{MoveInReview,MoveInReport,MoveInOwnership}.jsx and src/ui/native/pages/{workflows,tickets}/",
      "docs/moving-in.md",
      "next uniquely numbered migrations and RELEASE.json buyer steps"
    ],
    "tests": [
      "tests/move-in/{configuration-source,configuration-review,configuration-sla}.mjs",
      "tests/journeys/{move-in-admission,move-in-browser,workflows-browser}.mjs",
      "existing macro/workflow/form route journeys"
    ],
    "proof": "Import macro with four actions, two groups plus memberships, grouped/column view, holiday schedule, explicit SLA policy, two forms and trigger/automation pair; compare exact predicates/actions and source-vs-native fixture outcomes, including negative cases; zero work during import; explicitly publish selected items only inside the disposable sandbox; repeat/undo/native-edit guards and 1440/390 previews pass.",
    "must_not_touch": [
      "No broadening dropped conditions/restrictions, live mail/provider execution, staff-access activation, automatic rule publication or historical SLA clock creation.",
      "No other-vendor qualification claim; do not alter the Base import engine."
    ]
  },
  {
    "priority": 5,
    "role": "builder",
    "seed": "happytohelp",
    "repository": "just-every/run-happytohelp",
    "status": "BUILDABLE-NOW",
    "title": "Prove legacy folder adoption and finish the synthetic migration release handoff",
    "contract": [
      "MIGRATION-001 AP1/AP2/AP3",
      "MOVE-IN-001 AP1",
      "MOVE-IN-002 AP1/AP2",
      "ZENDESK-IMPORT-001 AP1-AP6",
      "PORTABILITY-001 AP1/AP2/AP3",
      "UI-001 AP1"
    ],
    "acceptance": [
      "Generate a fixed-clock, schema-complete synthetic legacy package without MySQL/live source; force multi-turn chunk/context/object ingestion and >200 status descriptors.",
      "Add field-level report/native historical projections for all retained archive-only business fields and widget differences; explicitly name exporter exclusions/default ai_usages exclusion and profile-specific losses, never migrate credentials or runtime authority.",
      "Import through folder UI and historical-adoption HTTP doors, separately prove CLI restoration/delta/retirement-marker behavior against synthetic source artifacts; cover source/native changed conflicts, interruption, exact repeat and erasure.",
      "Rerun the consolidated Zendesk and legacy native/API/browser/capacity/portable proofs on the candidate, update contract evidence only to executed scope, regenerate derived docs/source lock and assemble a reviewable release handoff."
    ],
    "files": [
      "scripts/generate-import-proof.mjs",
      "tests/helpers/legacy-package.mjs",
      "tests/move-in/legacy-adoption-integration/fixture.mjs",
      "src/modules/legacy-import/{mapping,map-core,map-project,map-knowledge,map-operations,worker/result}.ts",
      "src/modules/legacy-import/{package-in,adoption,custody}/",
      "src/ui/native/pages/legacy-package/{Result.jsx,result-note.js}",
      "docs/{LEGACY-EXPORT,moving-in}.md",
      "CONTRACT.md and generated ACCEPTANCE.md/docs/CLAIMS.md",
      "edition source lock and RELEASE.json as required"
    ],
    "tests": [
      "tests/move-in/legacy-{package-upload,adoption-integration}/",
      "tests/helpers/legacy/{custody,network-edge}.mjs",
      "tests/journeys/{legacy,move-in-admission,move-in-browser,move-in-capacity,move-in-custody,move-in-erasure,restore}.mjs",
      "tests/legacy-export/delta.mjs adapted to account-free artifact fixtures; keep existing isolated MySQL exporter test separately"
    ],
    "proof": "Two generations hash-identical; 1,000 legacy conversations/3,000 messages reconcile through mounted native screens/API, source roles never become logins, private media/notes deny others, all chunks/objects/counts and field report pages reconcile, status pagination/resume works, CLI synthetic delta preserves edits/erasure, and source/native financial hashes remain inert; 1440/390 controls pass. Run touched tests/typecheck, designated-runner full verification/browser checks, contract regeneration, source lock/check and first-party check; report exact candidate SHA and actual receipts without claiming production release.",
    "must_not_touch": [
      "Never access the live legacy app/MySQL/S3, set up provider keys, replay jobs/payments, import secret payloads, modify lane plans or deploy/release without separate authorization.",
      "Do not claim mounted delta parity from a CLI-only test, all-vendor completion from Zendesk/legacy tests, or acceptance/landing from evidence publication."
    ],
    "held_external": "Actual release needs owner/lander release authorization; live Zendesk and Business-stage qualification remain separately held as described in the report. All code and synthetic proof in this entry is buildable now."
  }
]
```
