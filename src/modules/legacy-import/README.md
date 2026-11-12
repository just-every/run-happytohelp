# Legacy data import

This module imports a portable legacy export into an already-migrated native installation: either a local edition or a deployed one. It never connects to MySQL, AWS or legacy buckets, and it calls no provider. Every command validates and plans without writing unless `--apply` is given.

```sh
# One JSON export (small projects and tests)
node scripts/import-legacy.mjs --file /absolute/export.json
node scripts/import-legacy.mjs --file /absolute/export.json --apply --persist-to .wrangler/state

# A chunked export package (any size), into local state
node scripts/import-legacy.mjs --package /absolute/company/import
node scripts/import-legacy.mjs --package /absolute/company/import --apply --persist-to .wrangler/state
```

## Importing a package into a deployed installation

A deployed installation is imported with its deploy credentials. The command binds only that installation's D1 database and R2 bucket, through Wrangler remote bindings and the operator's Cloudflare API token. It has no route in the application, so no workspace session or public request can reach it. It creates no queue, mail, AI or payment binding and never invokes the installation's Worker, so the import itself sends no email, dispatches no job, calls no AI provider and charges nothing.

```sh
CLOUDFLARE_ACCOUNT_ID=... CLOUDFLARE_API_TOKEN=... \
node scripts/import-legacy.mjs --package /absolute/company/import --apply \
  --remote --database <installation>-db --bucket <installation>-files \
  --expect-manifest-sha256 <sha256 of manifest.json> --concurrency 4
```

- **Package.** `manifest.json` (format `happytohelp-legacy-chunks-v1`) lists 4 MiB row chunks, the context parts that mapping reads across tables, and one file per attachment, each with its size and SHA-256. Pass `--expect-manifest-sha256` with the digest of the approved package; any other manifest is refused.
- **Validation before writing.** Every chunk, context part and attachment is checked against the manifest, and every table's row count against `source.rowCounts`, one file at a time. A damaged or incomplete package writes nothing.
- **Bounded memory.** Rows are planned and written one chunk at a time. Contacts, conversations, messages and media from the context go into a private on-disk SQLite index, which the command deletes when it ends, so memory does not grow with the company's size. A killed process cannot delete its index: each private directory (`$TMPDIR/h2h-legacy-context-<pid>-*`, `h2h-legacy-remote-<pid>-*`) is named for its process, and the next import removes those of processes no longer running before it starts. Attachments are streamed in 8 MiB parts.
- **D1 limits.** A chunk's journal is read in one query. Existing-row checks and inserts pass their rows as one JSON array value per statement, so no statement nears 100 bound parameters or 100 KB of SQL. A group is sized by what its statements bind: at most 1.25 MB in any one JSON parameter (its journal entries, holds, reporting rows or the values of one table's canonical rows), keeping every bound value below D1's 2 MB value limit however small or large the rows are, and its canonical rows, holds and journal entries commit together in one `batch`. A single source row too large for that limit is refused before anything in its group is written. Check the database's size after a large company: the journal keeps each source row once more.
- **Resume and idempotency.** The run is `legacy-package:<manifest sha256>`, and each chunk is its own journal run. If the command stops for any reason, run the same command again: committed groups are skipped and the import continues at the first uncommitted group. A complete rerun applies 0 rows. A row that already exists with different values stops the import without overwriting it. R2 objects use conditional creation and R2 checks each upload against its SHA-256, which it keeps as the object's checksum. An object is confirmed by that checksum (an object without one, such as a multipart upload, is read back and hashed), and an existing object with other bytes stops the import.
- **Concurrency.** `--concurrency` (1-16) imports that many chunks of one table, and that many attachments, at a time. Parent tables finish before their children start. Run one import per installation at a time.
- **Interruptions.** A dropped connection or a stopped process ends the command with an error; nothing partial is committed for the group in flight. Rerun the identical command. Wrangler's remote bindings open local connections for every call and hold some until their session ends, so the command paces its binding calls (25 a second) and renews the session every 500 calls. On a machine already short of ephemeral ports (`connect EADDRNOTAVAIL`), wait half a minute for closed sockets to drain before rerunning.
- **Leaving a table out.** `--exclude-table <table>` (repeatable) skips a source table that no other row is mapped through, such as `ai_usages`. Its rows are neither imported nor journaled; the summary lists them under `excluded`, and the package remains their record. A package's run is the same whichever tables it leaves out, so a later run can still import them.
- **Imported history is history** (`imported-history.ts`, `work-rows.ts`). A full package or `--file` export removes, in each batch, the rows the application's triggers add to the work tables, the workflow journal and `inbox_visitor_waiting`; puts each new workspace's default "Close solved tickets after 4 days" rule back to a draft (`--publish-default-rules` keeps it published); and marks every inserted conversation read for the workspace's members (`--leave-unread` leaves them unread). Both flags are refused with a delta package. Authorless legacy messages import with role `system`; every message gets a `message_authorship` row (`visitor`, `human`, `ai`, else `unknown`). See [Native import](../../../docs/LEGACY-EXPORT.md#native-import). An installation imported before this ran has the rows the batches now remove; migration `320_legacy_import_work_repair.sql` removes them by the import's journal and run windows (see the same section).
- **Knowledge index.** After the rows, the command indexes the imported workspace's knowledge (dataset documents and published articles) for copied-text detection, with the application's own indexer, 100 sources a pass, each committed as it goes. Without it the first workspace request after the import would rebuild the whole index inline, which a large knowledge base cannot finish within one request, and every workspace page and workspace creation would fail until it was done. A rerun continues the indexing; `knowledgeIndex` in the summary counts the sources indexed and ends with 0 pending.
- **Legacy media URLs** (`media-urls.ts`, `media-index.ts`, `media-rewrite.ts`, `file-door.ts`). Before mapping, the run resolves the workspace's files by legacy storage key: the package's media rows with exported bytes, and the files earlier imports journaled that the seed still holds (a native media row, or a recorded object R2 still has). `planImport` rewrites each legacy storage URL in mapped message text, article bodies, `logo_url`, `widget_settings.theme.background_image` and teammate and assistant avatars to the file's native URL: a conversation's file to its conversation route, any other file to the file door `/api/imported-files/<workspace>/<file>` with a `legacy_import_files` row (migration 321) mapped beside the row that names it. The journal keeps the legacy source row verbatim; the canonical row and its import state hold the rewritten value, so replays compare equal. See [Native import](../../../docs/LEGACY-EXPORT.md#native-import).
- **Legacy widget** (`legacy-widget.ts`). A full import writes the effective legacy widget tree, the schedule with numeric days, presence-based away off and `widget_team_display: 'workspace'` (the widget settings door then shows the workspace as the team).
- **Upgrade.** `scripts/legacy-import/upgrade.mjs --project <id> (--persist-to DIR | --database D1 --bucket R2)` (`upgrade.ts`) brings a workspace imported before these existed to the same rows, once.
- **Progress.** One JSON line per step and chunk goes to stderr (ids, counts, timings). The final summary goes to stdout: rows applied and replayed per table, archive-only rows, holds, attachments, `mediaUrls` (legacy storage URLs `rewritten`, and `left` because the package does not carry their file and no earlier import holds it), `widgetNotReproduced` (a full import: dotted legacy widget paths the native widget does not read, with a count of workspaces) and the knowledge index.

## Delta sweeps

A delta package (`scripts/export-legacy.mjs snapshot --since <watermark> --chunk-bytes ...`, see [Export legacy HappyToHelp](../../../docs/LEGACY-EXPORT.md#delta-sweeps)) carries only the rows legacy created, changed or deleted since an earlier export, with the whole project as context. The same command imports it; `source.since` in its manifest selects the update-aware path (`delta.ts`, `delta-plan.ts`, `delta-batch.ts`):

```sh
node scripts/import-legacy.mjs --package /absolute/company/delta-1/import --apply --persist-to .wrangler/state
node scripts/import-legacy.mjs --package /absolute/company/delta-1/import --apply --remote --database <installation>-db --bucket <installation>-files
```

- **Import state.** Full and delta imports record, in `legacy_import_state`, the digest of the columns written to each canonical row and of the legacy row they came from, in the same D1 batch as the write; rows found already equal are recorded too. Replaying a package records it for rows journaled before this existed, where the canonical row still equals its mapping, and writes nothing else: that exact replay of the original package is the one step an installation imported earlier takes before its first delta.
- **Import lease.** Every import with a target (a delta, a full package, a `--file` export) takes its workspace's `legacy_delta_leases` row (`lease.ts`, migration `315_erasure_leases.sql`) before it plans: one statement, only when no contact of the workspace is being erased (no live `contact_erasure_leases` row), taking over only an expired lease, by the database's clock. A full package and a `--file` export name the workspace in `source.projectId` (`extract.mjs`) and are refused before any write without it. While an erasure runs it waits (a `waiting` progress line every 30 s, counts only; polled every 2 s) for up to 15 minutes, then exits non-zero having written nothing; run it again. It renews the lease every 20 s for the whole run, uploads included, and deletes it when done. Every import batch starts with an assertion that the lease is still the run's own and live (`ik_d1_assertions`, `CHECK(ok=1)`) and ends by clearing it; each upload confirms it before and after (an upload that landed after a lapse is deleted again) and is recorded in `legacy_import_objects` in such a batch (when that batch fails, the upload is deleted), so a run whose lease lapsed (it stalled past the expiry and an erasure took the workspace) keeps nothing more and stops with a message to run it again. Under the lease it reads the workspace's erased contacts (`erased.ts`): a full import journals their pending rows as erasure leaves them (`source_json='{}'`, status `erased`, the mapped target), writes none of their canonical rows, holds, reporting rows or import state, keeps them out of the conflict preflight and uploads none of their files; its media are read from the package's media chunks only when such contacts exist. A file of an erased contact still in R2 that no native media row holds (by id or key) was uploaded by an earlier run before its media row was applied, out of her erasure's sight: the run deletes this run's `legacy_import_objects` row for it and the object (`objectsRemoved`); one R2 no longer holds stays as her erasure left it, and one a native media row holds is another person's attachment, which her erasure kept (`erased.ts` `heldByNativeMedia`): it stays. Which files are hers follows the erasure (`delta-scope.ts` `contactsOf`): a file the import puts in a conversation belongs to that conversation's customer and its uploader, however legacy also links it, so another customer's file linked into her conversation is imported for them; only a file with no conversation of its own goes with everyone it is linked to. An erasure requested while an import applies waits up to 30 s, then answers 409 with `Retry-After`: import when nobody is erasing.
- **Plan, then preflight.** Before the first write the command plans across the delta's chunks: the transcript position of each new message (after the conversation's existing messages; the seed's transcript is never renumbered), the conversation's new revision and last message, the messages and files held in conversations the seed has changed or closed, and the files of erased contacts. Every chunk and attachment is then checked read-only, as for a full package.
- **Decisions.** No canonical row: appended. Canonical row equal to the mapping: nothing written. Canonical row as the importer last recorded it: updated, only the differing columns. Changed in the seed and in legacy: left and listed as a conflict; changed only in the seed: left. A row the seed deleted after import is not restored. Rows mapped from the legacy `projects` row are kept, and the legacy project's soft delete is disregarded, so the archive-only cascade never hides a sweep. Users, settings, memberships, devices, grants and delegations are appended, never updated. Rows of a contact in `contact_erasures`, or with a `contact_erasure_leases` row (an erasure in progress or interrupted), are not applied and journaled with `source_json='{}'`, and their files are withheld; a file and a file link are the contact's when any link of the file (or of its original, for a variant) is in the contact's conversation, through a message, a delegation or an event (`delta-scope.ts` `contactsOf`, over every link the context indexes). Contact erasure clears `source_json` of every journal row of the contact, of any status, found by its recorded target and by its source (`contact-erasure/archive.ts`), the files and links of its delegations and internal notes included, keeping its digest, target and status. A row legacy deleted is journaled archive-only and listed when the seed holds it.
- **Skipped mail.** A legacy message whose delivery id is the SES message id of a receipt the seed's Amazon SES reader recorded (`legacy_mail_s3_receipts`) is journaled `skipped`, with no source copy (`source_json='{}'`; replay compares the digest), and never written, with its files (not uploaded) and, when the seed does not hold its conversation yet and every delta message of it is skipped, the whole conversation.
- **No side effects.** Each batch fences the conversations it writes to in `move_in_native_fences` and removes any row a trigger added to the work tables `check.mjs work` counts, to `workflow_events` or to `conversation_resolutions`, before it commits (`delta-scope.ts` `batchRemovedTables`). A delta that resolves a conversation with a survey cycle therefore leaves no resolution row: the widget's resolution state offers no survey and the dispatcher discovers nothing; `conversation_tracking`'s cycle start stays. The batch marks each fence it inserts in `legacy_import_marks` (only where none existed) and deletes only those, so a fence another writer, such as Move in, held before the batch stays.
- **After the legacy retire.** The retire soft-deletes the project and every live contact with one marker time `<T>` (UTC, to the second). Import every sweep after it with `--retire-marker "<T>"` (`YYYY-MM-DD HH:MM:SS` or `YYYY-MM-DDTHH:MM:SS[.fff]Z`; refused when malformed, with `--file` or for a full package, before any D1/R2 read or write). The package's contact rows, in its chunks and its context, are read through `scripts/legacy-import/retire-marker.mjs`: `deleted_at` equal to the marker becomes null, so a marked contact is the row legacy exported before the retire (its own run, its source recording `retireMarker`), its customers' new messages and conversations import live, and one whose only change is the marker is `unchanged`. Contacts deleted at another time keep the usual handling. The summary's `ignoredRetireMarker` (top level and `tables.contacts`) counts the marked rows. Use the marker from the first import of such a sweep; a run without it lists the marked customers as conflicts.
- **Unique values and references** (`delta-guard.ts`). Each chunk reads, from the seed's schema (`PRAGMA index_list`, `index_info`, `foreign_key_list`), every full unique index of a written table beyond its key and every foreign key, then the seed rows holding the values its rows would write and the rows they reference. A write that would take a value a different row holds is not applied: an update is a conflict (`unique contacts(project_id,external_id): held by contacts <id>`: the index and the holder, never the value); a new `contacts` row is appended with `external_id` null (as the full import appends a later holder) and listed with the conflicts (`...; appended without its identity`), so its conversations import; a new row of another table is a conflict. A row that references a row the seed does not hold and the chunk does not append (withheld this way, or deleted in the seed) is a conflict. Values the chunk writes are held from then on, and a value is never freed by a release in the same delta (a batch runs inserts before updates). The guard reads the seed as it is at decision time, so a resumed chunk decides as an uninterrupted one. Every unique index of a table a delta writes:
  - `contacts(project_id,external_id)`: reachable on both paths (the seed's widget, API or CSV identify contacts; legacy re-identifies one). Guarded as above.
  - `messages(conversation_id,revision)`, `(conversation_id,local_id)`: the plan numbers new messages after the seed's highest revision and keeps them off its delivery ids, so only a native message written between plan and batch reaches them. Guarded: such a message is a conflict, and its files (`media.message_id`) with it.
  - `media(object_key)`: the exporter keys each legacy file `legacy/...` by media row; no native writer uses that prefix. Guarded.
  - `context_tracked_events(project_id,subject_id,local_id)`: legacy events are `legacy:<event id>`; native events use other prefixes (`assignment:<id>`). Guarded.
  - `conversation_participants(conversation_id,contact_id)`: reachable (the portal mailbox, member actions, forms and channels add participants). Guarded.
  - `knowledge_categories(project_id,slug)`, `knowledge_articles(project_id,slug)`: reachable (members create and rename help; knowledge imports). Guarded; child categories, articles and `knowledge_article_categories` pivots of a withheld row are conflicts through their foreign keys.
  - `context_actions(project_id,subject_id,local_id)`: reachable when the seed's widget recorded the same action id. Guarded.
  - `billing_ledger(provider_id)`, `ai_attempts(generation_id)`, `training_runs(project_id,request_id)`, `training_cases(run_id,case_id,model,variant)`, `billing_accounts(stripe_customer_id)`: native writers can hold the same provider or request id. Guarded.
  - `context_evidence(project_id,subject_id,id)`: contains the key; unreachable.
  - Identity and authority tables, appended only and not guarded: `users(email)` is reachable (a seed member with the email of a new legacy user) and stops the batch; `local_devices(token_hash)` is `import-revoked:<id>` per device and `(grant_id,client_session_id)` names an imported grant no native device uses; `local_grants(token_hash)` is null on import; `local_jobs(project_id,request_id)` is legacy's request id or `legacy:<id>`, `(device_id,claim_id)` has a null claim and the partial active-job index never holds an imported, cancelled or revoked job.
- **Journal and reruns.** Every delta row is journaled with its intended target and its outcome as `status` (`mapped` appended, `updated`, `unchanged`, `conflict`, `kept`, `erased`, `skipped`, `archived_only`); conflicts and listed rows also go to `legacy_import_conflicts`. A rerun replays each chunk's run: nothing changes, and the summary lists the same `conflicts` (`{sourceTable, sourceId, targetTable, targetKey, reason}`, no content). The command exits 0 with conflicts. A sweep stopped partway (a refused batch, a lost connection, a stopped process) resumes with the same command and package: a chunk's run id is the digest of its chunk bundle, its committed batches are skipped, the plan treats messages the package already appended as not yet there, files already in R2 are counted present, and every remaining decision reads the seed as it is, so it ends as one uninterrupted import with nothing journaled twice.

`check.mjs delta` reads a delta's outcome and exits 1 on any mismatch: every row journaled by the delta's runs, the project's distinct journaled source rows equal to `--previous-total` plus the delta's rows no earlier run journaled, and every applied attachment identical in R2. It lists the delta's conflicts in `conflictRows` (`conflicts` counts them). Each journal query reads one run and finds another run's row of the same source through `legacy_import_rows_source` and that run's `legacy_import_runs` row (scoped by its `projectId`), a few rows read per journal row. A D1 "overloaded" answer is retried after 2, 4, 8, 16 and 32 seconds (`retries` counts them), then the check fails with it; other errors fail at once.

```sh
node scripts/legacy-import/check.mjs delta --package /absolute/company/delta-1/import --previous-total N --persist-to .wrangler/state
node scripts/legacy-import/check.mjs delta --package /absolute/company/delta-1/import --previous-total N --database <installation>-db --bucket <installation>-files
```

## Checks after an import

`scripts/legacy-import/check.mjs` reads an installation after a package import and writes nothing. Each check prints one JSON object of counts, ids, digests and sizes, never content. The deployed checks use the same deploy credentials and remote target as the import; `mail` reads SendGrid activity with `SENDGRID_API_KEY`.

```sh
node scripts/legacy-import/check.mjs rows --package /absolute/company/import --database <installation>-db --bucket <installation>-files [--exclude-table ai_usages]
node scripts/legacy-import/check.mjs attachments --package /absolute/company/import --database <installation>-db --bucket <installation>-files
node scripts/legacy-import/check.mjs work --database <installation>-db --bucket <installation>-files
node scripts/legacy-import/check.mjs queues --since <ISO> --until <ISO> --queue <installation>-jobs --queue <installation>-jobs-dead-letter
node scripts/legacy-import/check.mjs mail --since <ISO> --until <ISO>
node scripts/legacy-import/check.mjs size --database <installation>-db
node scripts/legacy-import/check.mjs delta --package /absolute/company/delta-1/import --previous-total N --database <installation>-db --bucket <installation>-files
```

- **rows**: per source table, the package's rows against the journal's (mapped and archive-only), with `journalEqualsPackage` and the tables that differ outside `--exclude-table`; the company's canonical rows per native table; attachments journaled; holds; the run's state.
- **attachments**: downloads every attachment from R2 and compares its size and SHA-256 with the manifest, and with the original file under the company's `source-objects/` when the export kept it.
- **work**: the installation's outbox, mail delivery, sign-in, notification, integration, context job, lead, brand and survey tables and the workflow journal (`workflow_events`), which the importer never leaves rows in, and datasets scheduled to refresh. Take it before and after: an import leaves every count unchanged (`work-rows.ts` removes what the import's own triggers add, in each batch).
- **queues**: message operations on the named queues in the window (Cloudflare analytics); an import writes none.
- **mail**: every message of every sender on the SendGrid account in the window, per sender and status, split into the fleet's own recipients and everyone else.
- **size**: the D1 database's stored size.
- **delta**: see [Delta sweeps](#delta-sweeps). The rows, attachments, work and delta checks also take `--persist-to <state>` for a local installation instead of `--database` and `--bucket`.

Legacy widgets could deliver one local message ID twice in a conversation. Native delivery IDs are unique per conversation, so the first message in transcript order keeps the legacy ID and a repeat is imported with `legacy:<message id>`, the ID used for messages that never had one. Both messages and their content are imported; the original value stays in the source archive.

The imported workspaces arrive with legacy email sending disabled and their inbound mailbox held until a mail domain is verified. Imported team members have no password. They sign in with **Email me a sign-in link**, then set a password in their account settings.

Input shape:

```json
{
  "format": "happytohelp-legacy-v1",
  "source": {"repository": "happytohelp", "revision": "exact-source-sha", "exportedAt": "2026-09-14T00:00:00.000Z"},
  "tables": {"projects": [], "users": [], "contacts": [], "conversations": [], "messages": []},
  "objects": [{"key": "legacy/project/attachment", "dataBase64": "...", "sha256": "64-hex-digest"}]
}
```

Keep original table/row IDs and all columns. Source queries should use a consistent MySQL snapshot (for example `START TRANSACTION WITH CONSISTENT SNAPSHOT; SELECT * FROM projects; ... COMMIT;`) and a MySQL client JSON encoder that preserves decimal columns as strings. `tables` entries correspond to selected original tables; source extraction is an owner-supplied artifact, not an undocumented database connection inside this tool. Export source provenance and the chosen project filter alongside the artifact. Filter all child tables through the same project set; include referenced users, categories, conversation contacts and devices. The importer rejects conflicting project references and conflicting existing canonical rows.

Required deliberate export enrichment:

* Projects supply `allowed_origin` or their original `website`/`website_url`/`url`; the mapper retains its browser origin. Widget settings become the effective legacy widget tree (legacy's defaults under the saved overrides, `legacy-widget.ts`), the availability schedule takes numeric days, presence-based away is off and the team shows as the workspace; availability booleans, responder IDs and deletion metadata become native project settings. Supply a chosen `widget_key` or retain project ID as the public key.
* Media supplies `object_key` (or `storage_key`), matching complete bytes in `objects`, plus original filename, type and size. Original polymorphic `mediables` joins attach message files; a file with no conversation keeps its bytes in R2 and, when a rewritten URL names it, a `legacy_import_files` row whose audience its joins give (workspace, teammate or assistant: public; article: the article's readers).
* AI records or `source.aiModel` supply the selected native model identity. No model is guessed. Empty original AI prompt/role inherits its matching `ai_defaults.type` row; original AI users without email retain their identity through the AI profile, rather than becoming login accounts.
* `dataset_files.markdown` (or explicit `content`) becomes a retained published knowledge version only for ready datasets, or the actual retained last-refresh files (explicit `published_file_ids` or timestamps no newer than `last_refreshed_at`); provider file IDs without retained text remain archive-only. No paid re-download or refresh runs.
* Native generation, training and raw provider-usage exports use the explicitly
  named fields in `map-core.ts`, `map-knowledge.ts` and `map-operations.ts`.
  Historical financial SQL and imported financial rows remain retained verbatim
  as immutable archive custody; they do not become active charges, balances,
  checkout or Stripe operations. Original unsupported operation rows remain
  visible as archive-only.

Mapped families include project/membership/contact identity, transcript/revision/frontier and original bucket IDs, notes/participants/media, AI profiles, published knowledge/articles/categories, customer profiles/evidence/insights/summaries, generation attempts/round usage, revoked device/grant custody, delegation/events, training runs/cases and historical financial rows. Every input row is also retained verbatim in `legacy_import_rows`, including deleted, unsupported, financial and unrecognized columns. The plan explicitly lists archive-only rows; preserving them does not claim their application behavior has been normalized. Password hashes and old access tokens are retained only in the source archive; native password recovery and device pairing establish new credentials.

The bundle SHA-256 identifies a run. Each committed row and its canonical writes share one D1 transaction. Resuming the exact artifact skips recorded rows; new artifacts must match existing canonical bytes or fail without overwriting them. Imports are incrementally resumable, not whole-database atomic. Conflict after earlier rows leaves an inspectable partial run. R2 uploads verify their digest, refuse conflicting existing bytes and use conditional creation. The importer does not delete anything and never dispatches jobs.

Pending generation/attempt/training/provider records become `uncertain`; their
raw usage and budget state remains available for review. Historical financial
rows and prior financial SQL remain immutable archive custody and are never
activated as payment or balance behavior. Pending delegated work becomes
cancelled with delivery held. Old grants/devices are revoked.
`legacy_import_holds` records each reconciliation requirement and preserves
original state in the raw archive. A hold is not evidence that a provider did or
did not perform work. Original uppercase project roles, `contacts.blocked_at`, AI
versus human assignment, inherited AI defaults, project website/settings and
delegation `created_by_user_id`/`event_type` are tested as original PHP-shaped
exports, alongside native operation exports. Encrypted collector actions require
explicit `plaintext_action` to become native context actions; the encrypted
original remains archived otherwise.

`tests/journeys/legacy.mjs` exercises 33 table families with real local D1/R2, original transcript/bucket/knowledge IDs, exact minor-unit money, held operations, deterministic replay, conflict protection and corrupt-object denial. This fixture proof is not an import of a production dump, nor a claim that every archive-only historical system is already normalized.

The public command uses the same `v3` local persistence layout as Wrangler/rer. Source `events` of type `INTERNAL_NOTE` become private notes; nullable category `published_at` retains drafts. Soft-deleted rows and their dependent transcripts remain archive-only.

### Installed Worker runner (synthetic matched-workspace qualification)

Apply `327_legacy_import_worker.sql` before this Worker serves traffic, after all
missing published migrations and a complete D1/R2/DO/private-settings backup.
The migration adds private run, part, indexed context and result-count stores.
It does not reset native rows or change the release version.

The owner/admin `data.import` doors under
`/api/move-in/projects/:projectId/legacy-import/:sha` are `POST start`, `resume`,
`stop` and `GET result`. Start binds the approved original manifest digest and
fixed exclusions (AI usage is omitted by default); `replay:true` starts another
attempt using the same chunk journals. The source workspace must equal the URL
workspace. A mismatch returns `409 destination_policy_required`. Resume can
explicitly replace a paused/stopped run's authority with the current owner/admin
session. A revoked session pauses; Stop fences in-flight commits by run version.

Each `legacy-import.step` JOBS wake reads its phase and cursor from D1, claims the
run for 60 seconds using the DB clock, takes the separate nonwaiting workspace
import/erasure fence, performs one bounded unit and persists the next wake before
sending it. Minute cron only discovers/enqueues at most ten due runs, using
unused credit within the existing jobs envelope. Duplicate/lost wakes and process
death recover from those checkpoints and the original source-row journals.

Preparation verifies every private package part, hydrates indexed context and
preflights all source rows and objects before canonical writes. Mapping and
full/delta application use the existing engine. Slices retain the ORIGINAL
whole-part identity. Canonical rows, import state digests, reference/index writes,
source journals, work cleanup and run/lease/current-authority guards share a
transaction. A lost cursor after commit replays its unchanged journal.

Knowledge planning is read-only. Imported transcript literals remain literal;
other imported copied fields match destination knowledge only. Ordinary native
message/note writes retain their existing knowledge protection. The reference
plan commits with the canonical rows whose state digest it describes.

Initial ceilings remain experimental until the accompanying workerd measurements
qualify them: 25 mapped rows, 100 context-load rows, and 262,144 source bytes per unit,
one 4 MiB part parse, one streamed 16 MiB object, 200 metered D1 statements and
8 MiB relationship closure. Timestamp ties are sorted with the CLI's JavaScript
collation in a bounded tie group (at most 250 rows); larger indivisible rows or
closures pause `row_too_large`. No CPU limit is raised. Workload counts and wall
duration are not CPU measurements; app results leave unavailable CPU/heap values
null. The test harness uses the pinned workerd inspector for isolate sampling and
heap measurements.

Result reads durable table/journal equality, exclusions, canonical attachment
size/stored SHA-256 equality, attempt apply/replay counts, released leases and
whole-installation work deltas. Optional counts-only `diagnostics` adds workspace
conversation count, distinct delta source IDs, incomplete delta runs, five
ordered sample conversation IDs and the before-import work baseline. An original
installation baseline is null when none was recorded. Concurrent native work is
not attributed to the importer. Scratch is deleted in pages of at most 250 rows after result
verification; runs, counts, original journals and private source packages remain.

This round supports synthetic matched-workspace rehearsal only. Arbitrary fresh
Business adoption and source-package retention/contact-erasure qualification are
separate allocated rounds. Package originals and new scratch are not yet covered
by native contact erasure. Do not treat local proof as Managed plan, installation,
real-customer remote-use or release qualification. The runner supplies no upload
endpoint, provider credential, CLI remote fallback or public source download.
