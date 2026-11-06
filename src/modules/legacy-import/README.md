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
- **Knowledge index.** After the rows, the command indexes the imported workspace's knowledge (dataset documents and published articles) for copied-text detection, with the application's own indexer, 100 sources a pass, each committed as it goes. Without it the first workspace request after the import would rebuild the whole index inline, which a large knowledge base cannot finish within one request, and every workspace page and workspace creation would fail until it was done. A rerun continues the indexing; `knowledgeIndex` in the summary counts the sources indexed and ends with 0 pending.
- **Progress.** One JSON line per step and chunk goes to stderr (ids, counts, timings). The final summary goes to stdout: rows applied and replayed per table, archive-only rows, holds, attachments and the knowledge index.

## Checks after an import

`scripts/legacy-import/check.mjs` reads an installation after a package import and writes nothing. Each check prints one JSON object of counts, ids, digests and sizes, never content. The deployed checks use the same deploy credentials and remote target as the import; `mail` reads SendGrid activity with `SENDGRID_API_KEY`.

```sh
node scripts/legacy-import/check.mjs rows --package /absolute/company/import --database <installation>-db --bucket <installation>-files [--exclude-table ai_usages]
node scripts/legacy-import/check.mjs attachments --package /absolute/company/import --database <installation>-db --bucket <installation>-files
node scripts/legacy-import/check.mjs work --database <installation>-db --bucket <installation>-files
node scripts/legacy-import/check.mjs queues --since <ISO> --until <ISO> --queue <installation>-jobs --queue <installation>-jobs-dead-letter
node scripts/legacy-import/check.mjs mail --since <ISO> --until <ISO>
node scripts/legacy-import/check.mjs size --database <installation>-db
```

- **rows**: per source table, the package's rows against the journal's (mapped and archive-only), with `journalEqualsPackage` and the tables that differ outside `--exclude-table`; the company's canonical rows per native table; attachments journaled; holds; the run's state.
- **attachments**: downloads every attachment from R2 and compares its size and SHA-256 with the manifest, and with the original file under the company's `source-objects/` when the export kept it.
- **work**: the installation's outbox, mail delivery, sign-in, notification, integration, context job, lead, brand and survey tables, which the importer never writes, and datasets scheduled to refresh. Take it before and after: an import leaves every count unchanged.
- **queues**: message operations on the named queues in the window (Cloudflare analytics); an import writes none.
- **mail**: every message of every sender on the SendGrid account in the window, per sender and status, split into the fleet's own recipients and everyone else.
- **size**: the D1 database's stored size.

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

* Projects supply `allowed_origin` or their original `website`/`website_url`/`url`; the mapper retains its browser origin. Original widget settings, availability booleans, responder IDs and deletion metadata become native project settings. Supply a chosen `widget_key` or retain project ID as the public key.
* Media supplies `object_key` (or `storage_key`), matching complete bytes in `objects`, plus original filename, type and size. Original polymorphic `mediables` joins attach message files; non-conversation media remains archived until its consumer mapping is provided.
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
