# Move in your support history

Open **Settings → Move in existing support history**, or use the optional **Move in** link on the Setup page. A workspace owner or admin uploads and reviews each import. Its original files, plan and report are private to that reviewer in that workspace.

Choose the format, follow the steps the page shows for it, upload the file, and wait for **Ready for review**. The review appears on the page straight away: how many records will be imported, which records **need fixing** first (with the file, line and reason), and what is **imported with notes**, such as fields that stay in your original file. **Approve and import** appears only when the file has something to import. Processing continues in bounded background batches. The report links to imported conversations, contacts, saved replies and articles. If processing stops, resolve the reported issue and choose **Resume import**; committed progress is retained. The reviewer must still have a current owner/admin session and membership when a batch executes.

An import is inert: it does not send mail or widget messages, run AI, assign staff, activate staff access, or send notifications. Imported contacts are unverified and have no automation consent. Historical staff are retained as source authors only. Conversations solved or closed in the source land **closed**; their closing time is the source's own when the export records one, otherwise the source's last update, and the review says which. Assignment is not activated. Imported messages are history, so they never count as unread. Imported history is excluded from Reports.

## Files and limits

Hosted imports require the Workers Paid D1 query budget. D1 Free permits only 50 queries per invocation and is not supported by this importer. Local trials use the local runtime. The importer enforces at most 1,000 statements per invocation, 100 bound values and 100 KB SQL per statement, and 2 MB values/parameter payloads. See the [D1 platform limits](https://developers.cloudflare.com/d1/platform/limits/); D1 also bounds query/batch duration at 30 seconds.

Uploads are limited to 2 MiB, with at most 2 MiB of expanded source bytes, 64 ZIP entries, 5,000 source and derived-tag records and 128 KiB per record. ZIP is a packaging option for supported files. It is not a claim that either vendor's export service produces ZIP. Split larger exports into smaller complete batches, each including the contacts needed by its conversations. Keep the source files until you have checked the report.

Planning reads only candidate native identities and complete related target bundles. A persisted email index preserves Unicode comparisons and reconciles at most 100 changed native contacts per background turn; unrelated workspace history is not accumulated in memory. A native target larger than 512 KiB, or combined native candidates larger than 8 MiB, is reported as a review-size conflict before its content is loaded. Parsing indexes structural source offsets and physical lines once per file, then stages at most 100 records per batch from those saved positions. Archive extraction stages at most 20 entries per batch. One immutable review covers the whole import. Internally, reviewed plans contain at most twenty source records, 512 KiB of estimated decision material and 1 MiB of serialized plan data; an individual decision beyond that bound is refused. Large conversation bundles get a plan of their own; any record needing more than 750 native SQL writes is rejected during review with its source location. A review supports at most 300 internal plans; a larger expansion is refused before approval. Application and undo process at most twenty source records or target bundles per batch, with an additional whole-invocation D1 statement cap. Durable child journals apply in dependency order and undo in reverse order while the report shows global progress. Original uploads and extracted source bytes are retained in private object storage. The global review binds the exact original upload and parsed files by private object key, size and digest; every apply/undo invocation verifies those bytes again. Each smaller Base journal retains its reviewed decisions, source digests and provenance, and explicitly marks original bytes unavailable within that child journal. Exact bytes live in the private group custody, not duplicated in every child journal. Erasure fences the entire group before removing all child journals and source objects.

Unsupported records and fields are reported rather than turned into guessed data. Attachment metadata stays in the original unless explicitly supplied Freshdesk or offline Zendesk bytes pass the checks below. Intercom and Help Scout do not yet attach bytes to native messages. Automation, assignment rules, external actions, company and segment rules, and unsupported conversation parts are not activated. Inspect the report's source filename, physical line and JSON pointer to locate a problem. Invalid JSON, duplicate JSON members (including equivalent escaped names), invalid UTF-8, excessive nesting, oversized records, excess source positions and exhausted identity work budgets refuse the entire upload before private R2 and D1 custody or native effects. The refusal gives the source file, physical line, JSON path and reason. Every ZIP member is checked first, including directories and later extraction batches; no partial upload is retained. An export with no source records is refused after the complete bounded scan. Blank files, supported empty record lists and empty stored or deflated directories can accompany actual records, including records in later archive batches. Directories must first pass header, empty-body and checksum validation. Unsupported record kinds still count as source records and reach the reasoned plan. ZIP32 stored or deflated members and checked 32-bit data descriptors are supported. Opaque archive comments or extra fields, undeclared bytes, encrypted, multidisk or ZIP64 members and unsupported compression are refused; repackage the source files without that metadata. Correct the export and upload again. Valid JSON with unsupported kinds or mapping errors still reaches the reasoned plan; those decisions have no fabricated source ID or native effect. Input counts include repeated records and derived tags; per-kind counts describe distinct identified decisions plus invalid positions. The progress total counts only identified source decisions.

## Zendesk

Use the documented [account JSON export](https://support.zendesk.com/hc/en-us/articles/4408886165402-Exporting-data-to-a-JSON-CSV-or-XML-file), with one singular wrapped object per nonblank line, for example `{"user":{...}}` or `{"ticket":{...}}`. Ticket records must contain the complete comments array; a ticket description is not a substitute. Include the users needed to identify requesters and comment authors. Each comment needs its source ID, original creation timestamp and explicit `public` boolean. Public comments become messages; private comments become private notes.

Saved replies and Help Center articles are separate API supplements, not part of a claim that the account export contains every supported kind:

- Upload [Macros API](https://developer.zendesk.com/api-reference/ticketing/business-rules/macros/) records as `{"macro":{...}}`. One reply action, priority, built-in status and add/remove tags translate to native macros. Requester, assignee, current-user, ticket-title/link and organization-name placeholders translate to native placeholders; unknown expressions stay visible in review and block sending until resolved. Private replies become native notes. Restricted macros, template logic and placeholders inside HTML attributes are refused before markup conversion can discard them. Unsupported actions are listed individually. Import runs no actions: review the native macro preview before manually applying it; reply text becomes a composer draft and is never sent automatically. Repeat/undo also compare the macro action version and retain later native edits.
- Upload [Articles API](https://developer.zendesk.com/api-reference/help_center/help-center-api/articles/) records as `{"article":{...}}`. The `draft` flag and audience fields must be explicit. Public published articles stay published; drafts stay drafts. Restricted or unknown-audience articles are rejected.

A minimal file with one saved reply and one article, one record per line. The reply text is the `comment_value` action's `value`, as plain text or HTML:

```json
{"macro":{"id":301,"title":"Refund timing","restriction":null,"actions":[{"field":"comment_value","value":"Refunds reach your account within 5 working days."}],"created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}}
{"article":{"id":401,"title":"How refunds work","body":"<p>Refunds reach your account within 5 working days.</p>","draft":false,"user_segment_id":null,"created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}}
```

IDs must be positive safe integers or canonical positive decimal strings. String IDs remain strings, including IDs too large for a safe JavaScript number. Exact repeated records are collapsed; conflicting duplicate IDs are rejected. Ticket tags are actual exported strings, normalized for workspace uniqueness. User tags remain contact metadata and do not become conversation tags. No numeric vendor tag ID is invented. Standalone tag inventories are reported as unsupported.

### Offline Zendesk account files

Already downloaded account files can be packed locally without a service token:

```sh
node scripts/pack-zendesk-offline.mjs local-manifest.json > synthetic-hh-move.ndjson
```

Upload the resulting file through **Move in → Zendesk → Upload and review**.
The packer reads local files only, makes no network requests and never writes
native state. It accepts source JSON arrays, objects with `tickets`, `users` or
`organizations` arrays, `ticket_fields` supplements, and singular wrapped JSONL/NDJSON records. Split account
members can appear in any order. Unpacked uploads retain the existing singular
wrapper-per-line format; arbitrary account JSON collections require this packing
step. ZIP uploads may contain multiple such wrapped files, within the same limits.

The manifest is local packing metadata, not a Zendesk export schema. Paths are
relative to its directory; absolute paths, parent traversal, symlinks and files
outside that directory are refused. For example:

```json
{
  "format": "happytohelp-zendesk-offline-v1",
  "files": [
    {"kind":"ticket","path":"tickets.json"},
    {"kind":"user","path":"users.json"},
    {"kind":"organization","path":"organizations.json"},
    {"kind":"comments","path":"comments-1001.json","ticket_id":1001,"complete":true,"page":1,"pages":1},
    {"kind":"metrics","path":"metrics.json"},
    {"kind":"audits","path":"audits.json"}
  ],
  "attachments": [
    {"ticket_id":1001,"comment_id":101,"attachment_id":501,"path":"bytes/receipt.txt","size":5,"sha256":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}
  ]
}
```

Here the local file contains exactly `hello`. Its corresponding Zendesk comment
attachment must have `id:501`, `file_name`, `content_type` and `size:5`. Zendesk's
`content_url` is metadata, never a download instruction. Duplicate filenames are
fine; attachment IDs and local paths must have exactly one owner. The packer removes attachment download URLs entirely, including path-based
access tokens, and strips user information, queries and fragments from other
URL values before output; direct uploads with
credential-bearing links are refused before custody. Direct Zendesk attachment
URL metadata with any query, fragment or credential path is refused as well; pack it locally to
strip those access-bearing parts first. Original local files are not
uploaded by this command. Preserve them privately yourself when appropriate.

Comments files hold a `comments` array (or an array of comments), associated with
the manifest's explicit `ticket_id`. Supply every page, numbered from 1 through
`pages`, each marked `complete:true` only after reconciling it; a non-null
`next_page`, a missing page, source `comments_truncated`/`comments_incomplete`,
or a mismatched `comment_count` makes the ticket visibly incomplete and rejects
it in review. Supplied comments replace the ticket's embedded array. Without a
separate file, the embedded complete array remains supported. A description
never replaces missing comments. Identical repeated tickets reach the mounted review as exact repeated records and are counted once; differing
copies require correction before packing. Conflicting IDs in direct uploads
remain source-located review rejections.

Metric files hold `ticket_metric_events`; audit files hold `audits`. Each record
joins by its original `ticket_id`; for a per-ticket response that omits it, set
`ticket_id` on that manifest file. Empty event files can declare that ticket ID
to distinguish supplied-empty from missing history. Event IDs, instance IDs,
metric names, timestamps, audit status transitions, source targets and supplied
elapsed units remain inert private history. Unknown event types stay labeled as
unsupported. Privacy/redaction audit events refuse the ticket until the source
conversation is reconciled; old text is never treated as the redacted version.
Missing files stay unavailable; current status never supplies an invented SLA
result. Staff with current ticket access open **Details → Summary → Imported
status and SLA history**. Customers cannot read this private history.

Packing enrichments live only under a ticket's `_offline` object, identified by
`format:happytohelp-zendesk-offline-v1`: `attachments` binds `attachment_id`,
`comment_id`, relative `path`, `sha256` and canonical `base64`; `history` declares
`metrics` and `audits` as `missing` or `supplied`; `metric_events`, `audits` and
`provenance` retain their source file, digest, row and JSON pointer. These are
explicit local packing fields, never required fields in an untouched Zendesk
export. The review identifies packed file/row/pointer and source ticket ID;
provenance retains the original component locations inside private ticket custody.
Packed users, organizations and field definitions carry the same file/digest/row/pointer
as a list under `_offline_provenance`, retained in their guarded native source provenance.
The exact packed bytes bind the reviewed fingerprint.

Supplied bytes use the existing native media store and access rules, at most
48 KiB per file and 20 supplied files per ticket. Public comments keep public
attachments; internal notes keep teammate-only attachments. Types and bounds
match Freshdesk. URL-only attachments are visible omissions, never binary
successes. Digest, size or ownership mismatches reject the entire ticket before
native effects. Inert history is part of the native adapter's guarded
`move_in_origins.source_json`, its plans, repeat/undo and portable database;
there is no separate history store. Erasure removes the affected custody and
bytes and keeps source-identity replay fences.

Keep each packed upload and its decoded input within 2 MiB, each ticket with its
history and bytes within 128 KiB, and source plus derived records within 5,000.
Larger exports need separate manifest batches of complete tickets, each including
their users, organizations, field definitions and relevant history. Do not split
one ticket's conversation across independent imports. A complete ticket beyond
128 KiB cannot be imported by this bounded slice. Full configuration fidelity,
shared M3 opt-in/Business grants/catch-up transport, signed real-export
qualification, other vendors and final live cutover remain unproved.

## Intercom

The simplest route needs only an Intercom access token: **Settings → Project →
Move in → Intercom** shows a Terminal script that reads every conversation and
its contacts from the [Conversations API](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/conversations/conversation)
(`Intercom-Version: 2.16`) and writes `intercom-move-in-1.jsonl`, `-2` and so
on, 25 conversations each, with each conversation's contacts on lines before
it. A conversation with more than 500 parts is longer than the API returns at
once; its count no longer matches its parts and the review lists it as rejected.

Use the [conversation cloud export](https://www.intercom.com/help/en/articles/7029721-export-conversations-data-to-amazon-s3) configured for Data API **2.16**, in JSON or JSONL. The reader also accepts a top-level JSON array and convenience `contacts`/`conversations` arrays. ZIP may package these files and separate API supplements. Reporting CSV, macro-content CSV, PDF, text and NDJSON are unsupported.

Include [Contacts API](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/contacts) records for the single contact referenced by each conversation. A contact needs its original ID, valid email and Unix creation time. Conversation channel must be explicit in `channel.initial` (`email` or `messenger`), state must be `open`, `closed` or `snoozed`, and the conversation parts must be complete. When supplied, `conversation_parts.total_count` must be a nonnegative safe integer exactly equal to the supplied parts array length; malformed counts and mismatches are rejected. Comments become visible messages; notes remain private. Source authors retain their exported type and identity. Contact tags remain contact metadata; conversation tags become workspace tags. Duplicate contact or conversation IDs are reported as conflicts.

The initial conversation source has no documented message creation timestamp. Its displayed time is explicitly **conversation creation time**, with the original message timestamp recorded as unavailable. Part timestamps remain their original Unix timestamps. No message timestamp is fabricated.

Separate documented supplements are supported:

- [Macros 2.16](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/macros/macro): `type: "macro"`, `id`, `name`, body, ISO8601 creation/update strings, `visible_to: "everyone"`, and an `available_on` list containing `inbox`. Team-restricted macros are rejected. Both original HTML and plain text are inspected before conversion. Dynamic placeholders, including XML-like `<attribute>` elements and their fallback values, are rejected explicitly because native saved replies cannot preserve their behavior. The API's `{type:"list",data:[...]}` envelope is accepted. Unsupported sibling collections and unknown fields receive source-located omissions; their records count in the review.
- [Articles](https://developers.intercom.com/docs/references/rest-api/api.intercom.io/articles): `type: "article"`, source ID, title, body, Unix creation/update times and explicit `state: "published"` or `"draft"`. Unsupported audience restrictions are rejected. Publication state is preserved. HTML is converted to native Markdown; a provided article `body_markdown` is preserved.

Conversation exports do not establish that contacts, macros or articles are included automatically. Obtain the appropriate supplemental records through their documented APIs and permissions.

## Freshdesk

Choose **Freshdesk** in Move in. The page gives a script that uses the [Freshdesk API v2](https://developers.freshdesk.com/api/) with your API key (your profile picture, **Profile settings**, **Your API Key**). It writes `freshdesk-move-in-1.ndjson`, `-2` and so on, 50 tickets each, plus `freshdesk-move-in-saved-replies.ndjson`. Upload them one at a time.

Each line is one Freshdesk object in a singular wrapper: `{"ticket":{...}}`, `{"contact":{...}}`, `{"agent":{...}}` or `{"canned_response":{...}}`. A ticket is the [View a Ticket](https://developers.freshdesk.com/api/#view_a_ticket) response (the script adds `include=stats`) with a `conversations` array holding every page of [List All Conversations of a Ticket](https://developers.freshdesk.com/api/#list_all_ticket_notes). Include the contact for each requester and customer reply, and the agent for each agent reply or note; the script does both.

- The ticket description becomes the first message, from the requester, at the ticket's creation time. An outbound-email ticket (`source` 10) was written by an agent Freshdesk does not record, so that first message has no named author.
- Public replies become messages; private notes (`private: true`) stay private notes. Messages keep their original times and authors.
- Resolved (4) and closed (5) tickets, and spam, land closed. The closing time is `stats.closed_at` or `stats.resolved_at`, else the ticket's last update. Open (2), pending (3) and custom statuses stay open. Assignment is not activated.
- Agents stay as the authors of their messages and get no access. Contacts need a valid email; extra addresses (`other_emails`) are kept for erasure matching but not imported.
- Canned responses visible to all agents (`visibility` 0) become saved replies. Personal or group responses, and responses with placeholders such as `{{ticket.requester.name}}`, are rejected.
- Metadata-only attachments keep their names and sizes in your original file; the files themselves stay in Freshdesk. Freshdesk's attachment and avatar links contain signed keys, which an import must not keep, so the script removes them and an upload that still has one is refused with its line. The script also leaves out email address lists (to, cc, from) and empty custom fields; other custom fields stay in your original file.

### Explicitly supplied Freshdesk attachment bytes

In the singular-wrapped Freshdesk NDJSON format above, add `base64` and `sha256` to each attachment object in the ticket's `attachments` array or a conversation part's `attachments` array. Supply the bytes yourself; the importer never downloads a URL. The export script does not fetch attachment bytes. For example, the UTF-8 bytes `hello` are:

```json
{"id":80,"name":"receipt.txt","content_type":"text/plain","size":5,"base64":"aGVsbG8=","sha256":"2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"}
```

Use nonempty canonical padded base64, the exact byte size, and a lowercase SHA-256 digest. Each attachment is at most 48 KiB and each ticket has at most 20 supplied attachments across all messages and notes. Existing 128 KiB record and 2 MiB upload limits also apply. Supported types are plain text, PDF, PNG, JPEG, GIF and WebP. An invalid size, digest, filename, type or duplicate attachment ID rejects the whole ticket in review; metadata without supplied bytes remains an explicit omission.

Review shows filenames, digests and the source visibility before approval. Ticket-level attachments belong to the opening message; public conversation-part attachments belong to that message; private attachments belong to that private note. Private-note attachments are available only to teammates with ticket access, never to customer sessions. Small imported payloads are retained in native database storage with the media row, inside the same guarded transaction as their owning message or note. Resume and repeat preserve that ownership. Undo removes unchanged attachment rows and bytes together; any later native attachment edit stops undo. Contact erasure removes the payloads and import custody and fences replay. This bounded format does not establish other-vendor attachments, live cutover or outbound attachment delivery.

- Deleted tickets and contacts are rejected. Help articles come across with **Knowledge → Import → Freshdesk**.

```json
{"contact":{"id":7,"name":"Ada Customer","email":"ada@example.com","active":true,"created_at":"2024-01-02T09:00:00Z","updated_at":"2024-01-02T09:00:00Z"}}
{"agent":{"id":900,"contact":{"name":"Sam Agent","email":"sam@example.com","created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"},"created_at":"2024-01-01T00:00:00Z","updated_at":"2024-01-01T00:00:00Z"}}
{"ticket":{"id":5001,"subject":"Refund question","description":"<div>Where is my refund?</div>","status":4,"priority":1,"source":1,"requester_id":7,"tags":["billing"],"stats":{"resolved_at":"2024-01-02T09:30:00Z"},"created_at":"2024-01-02T09:01:00Z","updated_at":"2024-01-02T09:40:00Z","conversations":[{"id":50012,"body":"<p>Refund sent.</p>","incoming":false,"private":false,"user_id":900,"created_at":"2024-01-02T09:10:00Z","updated_at":"2024-01-02T09:10:00Z"}]}}
```

## Tags, repeat imports and undo

Imported tags appear on inbox rows and in the conversation's **Ticket → Summary → Tags**. Add or remove tags there, and use **Filter conversations by tag** in a workspace inbox. Tag names are unique within a workspace. A tag in another workspace cannot be attached or used as a filter.

Uploading again is safe. A rejected record is not imported and does not hold its source ID, so fix it in your file and upload the corrected file: records already imported are recognised and left as they are, and only the fixed record is added. An import made by an earlier release kept a rejected record's ID; the review then says so, and undoing that earlier import releases it. Uploading the identical completed export again reports that every record is already imported. It performs no application-row mutations, including import bookkeeping. D1 platform read metadata can still change. Under the owner decision of 2026-10-09, repeat and undo compare exact business state; only platform counters/sequences, audit and import journals are excluded. Changed source records, deleted imported targets and native target collisions are shown as conflicts for review. Native deletion is preserved. Applying a review checks the complete reviewed contact identity set again inside each publishing transaction, including case-insensitive email matches and intervening native identity changes; a collision stops publication until it is resolved. A collision present before the first publishing transaction prevents initial publication. If a collision arrives between committed batches, the refused transaction publishes nothing and the report retains the exact committed progress. Resume rechecks the conflict; **Undo whole import** can reverse unchanged records from a stopped import while preserving the competing native contact. Current target contents are also checked atomically.

**Undo whole import** removes unchanged records created by that import, in reverse dependency order. Original files and provenance remain available in the private import journal. A later native edit, note, or reference from another conversation blocks reversal with a conflict and is preserved; undo does not overwrite it. Opening history does not block undo: read markers for removed imported conversations are removed with them. Pre-existing native records and their read markers remain intact.

Contact erasure takes precedence over import custody. If an archive contains the erased contact, its original bytes, staged records and import journal are removed. This also applies to ordinary native contacts when staged source identities match a known email or external identity, including records rejected during review. Embedded source-author email aliases are indexed too. Malformed identity fields, malformed contact collections and unknown or opaque source fields make the identity index incomplete. Every whole value in those fields is hashed into a private index, so erasure removes such an import only when it holds the erased contact's email, external ID or source ID, or a known alias, and leaves other people's imports in place. Erasure retains the original identity and its complete known alias closure in its first transaction. If a native identity changed before that transaction, a bounded retry retains both snapshots; it also fences any identity seen after the committed transaction. Interrupted erasure keeps these hash-only fences, and concurrent native updates cannot overwrite the erasure state. After an erasure, an upload with an incomplete identity index is refused rather than retaining source bytes whose identity cannot be checked. Because a mixed archive is indivisible, that whole import and any import journals depending on its reused decisions become **Source erased** and cannot be resumed, replayed or undone. Other native records from that import remain in the workspace. The retained artifact digest prevents replay of the erased file. Hash-only identity fences also prevent differently packaged or changed exports from restoring a known erased source identity, requester or author. No erased email, external ID or source ID is stored as plaintext in those fences. Uploads index these identities before private custody is admitted. This admission scan shares the 2 MiB expanded-byte, 5,000-position and 128 KiB per-record limits; unsupported semantic identity shapes mark the index incomplete, while any exceeded structural or identity scan limit refuses upload before custody. Structural indexing refuses the upload when its position budget is reached. Identity extraction permits at most 4,096 schema nodes per record, 200,000 per upload, 40,000 identity hashes and 20,000 distinct identity links. Its 128 field diagnostics plus one truncation notice are a separate presentation budget: all understood aliases are indexed even after that notice. The upload route measures separately from the queued parser and remains subject to local capacity checks; local request duration does not establish hosted CPU usage. The route checks the identity fence atomically when recording the upload. Each object uses a unique opaque conditional write reservation so an in-flight writer cannot restore content after erasure deletes its key. If an upload is interrupted before it reaches background processing, upload the same file again to finish that reserved upload.

## Evidence and limitations

Records with an explicit type keep that meaning even when additional fields
have collection names or an unknown envelope property contains the record.
The original kind, ID, payload and native mapping survive such a parent; the
unsupported parent is reported at its source position. Conflicting record/list declarations, malformed record
discriminators and ambiguous wrappers are refused with a source location before
any private file or import is saved. JSON, JSONL and ZIP packaging use the same
record classification for review and erasure protection. Unknown envelope
containers that hide an explicit record under additional object or array layers
are refused as a whole at that container. Unwrap those records into a documented
collection. The bounded structural check examines discriminator keys, never
searches message text for identities, and preserves the payload boundary of an
identified record.

The [source-structure and erasure reference](moving-in-shapes.md) lists the
understood nested containers, nullable fields, opaque values and bounded audit
behavior. Field diagnostics carry the physical record line and exact JSON
pointer, including fields on rejected records. Unsupported structural content
cannot claim a complete custody index merely because its enclosing record maps.

These readers, including Freshdesk, have synthetic fixture coverage. The committed deterministic generator provides separate clean and malformed/duplicate 1,000-conversation corpora for each vendor. The capacity harness exercises upload, reviewed import, repeat and native undo in the native local Worker/D1/R2 runtime. It retains full ordered table snapshots and separately measures the protected D1 read counter. Repeat and undo must preserve exact business state, including private notes, tags, source-linked content and all other imported business rows. Only named platform counters/sequences, audit and import journals are excluded. Hash receipts cover those full ordered business snapshots; synthetic credential material is not written to evidence. Sampled used JavaScript heap peaks remain below 128 MiB after bounded child processing; the test records all available numeric isolate memory fields. These samples can miss peaks and do not measure total Worker memory. Local workerd does not enforce the deployed isolate memory limit, so this does not establish hosted memory acceptance. Real customer exports have not been supplied; this is documented-format, synthetic-only validation. It is not a claim of verified compatibility with every export variation.

The reader behavior is based on the pinned Lily Zendesk parser (`d24f3f7`) and Beacon Intercom parser (`fa1846b`), supplemented by the official API documents linked above. The shared import engine is copied byte-for-byte from the Base revision and paths recorded in `edition.json`; the product supplies its readers, native mappings, authority checks and UI. The selected D1 dependency closure excludes optional Node SQLite and HTTP-reader implementations.

Older originals from before the admission audit are reindexed from their actual private bytes before erasure removes them. At most two originals are checked per erasure request; a continuation response asks the owner to repeat erasure when more remain. The migration preserves native rows and conservatively clears old completeness claims. If an old original is missing, corrupted or outside the bounded audit, native erasure still completes and removes its custody. Future imports of that format in that workspace are then refused because the destroyed original cannot establish its missing aliases. This compatibility restriction applies only to unprocessable pre-audit custody; new uploads cannot enter that state.

The platform admission index's `move_in_contact_keys.email_digest` is lazy,
derived memoization. Business equality retains its exact project/contact links
and independently validates each populated digest against the native email;
NULL-to-correct-digest does not change business state. The contact row, email,
identity and every source/business link remain in the equality comparison.

The 9 October Base refresh requires additive migration
`118_import_kit_runtime.sql` before starting the updated Worker. Preserve the
previous 50 migration files and back up journals, identity tombstones and private
source objects together. This supplies the current official runtime dependency
schema; it does not expose new streaming or staging import workflows.

## Help Scout Inbox v2 and Docs v1

Choose **Help Scout Inbox v2 + Docs v1** in Move in. Upload unmodified API response
bodies in a JSON file, a JSON array, one response per JSONL line, or a ZIP of those
files. A convenience JSON object may group responses as
`{"responses":[...],"articleDrafts":[...]}`. The `articleDrafts` group holds the
original `{ "article": {...} }` responses fetched with `draft=true`; these bodies
are retained privately and never replace a published article. The alternative
`conversations`, `customers`, `tags`, `collections`, `categories`, `articles`
(list summaries), `threadPages`, and `articleDetails` arrays hold their named
records/responses. These are packaging conventions, not claimed provider exports.
All grouping uses the same syntax, identity and size admission checks.

Inbox accepts [v2 conversation lists and direct conversation details](https://developer.helpscout.com/mailbox-api/endpoints/conversations/get/),
[customer details](https://developer.helpscout.com/mailbox-api/endpoints/customers/get/),
[tag lists](https://developer.helpscout.com/mailbox-api/endpoints/tags/list/), and
[per-conversation thread-list responses](https://developer.helpscout.com/mailbox-api/endpoints/conversations/threads/list/).
HAL lists use `_embedded`, `page` and `_links`. Fetch conversations with the
intended mailbox and `status=all`, retain every page and its scope, and include
customer details with `_embedded.emails[].value`. One customer email is required
for a native contact; additional emails are identity-indexed but an ambiguous
native contact is rejected. Inline `primaryCustomer.email` alone is not a
customer detail. Staff authors never create users, memberships or assignments.

Each conversation requires every separate thread-list page with original
`page.number`, `size`, `totalElements`, `totalPages`, and `_links.self.href` under
`https://api.helpscout.net/v2/conversations/{id}/threads`. Intermediate pages need
the correct `next` link; the terminal page must have no `next`. Page numbers,
counts and distinct thread IDs must reconcile. The conversation's `threads`
count reconciles **published non-note threads only**. It cannot prove note or
draft coverage. Bare `_embedded.threads` arrays, truncated embedded chats,
`preview`, missing bodies, missing pages, and custom `complete:true` flags cannot
establish complete history. Inbox v3 is not selected by this format.

Published customer messages and replies become native messages; published
`type:note` threads become private notes. `draft`, `bounced`, `hidden`, `review`
and `underreview` threads are explicitly omitted from native sent history.
Unknown states and unsupported public thread kinds reject the conversation;
line-item events remain metadata. Attachments retain metadata, not downloaded
bytes. A thread's `savedReplyId` is only a reference: this format does **not**
claim to import saved replies. Unsupported fields and records appear in review.

Docs accepts [collection](https://developer.helpscout.com/docs-api/collections/list/)
and [category](https://developer.helpscout.com/docs-api/categories/list/) list
responses `{collections|categories:{page,pages,count,items}}`, abbreviated article
lists, and [article details](https://developer.helpscout.com/docs-api/articles/get/)
`{article:{...}}`. Exhaust each list's pages; counts and IDs must reconcile.
Collect article lists by collection to avoid overlapping category inventories.
A list summary without `text` is metadata only; include each article's body
detail, collection and every referenced category. Collections become native root
categories, their categories become children, and article/category links are
preserved. Site IDs, provider sorting options and other unrepresented fields
remain source provenance. Explicit private ancestry becomes unpublished native
categories and draft articles. Missing/unknown visibility or status rejects
publication. `notpublished` stays draft. Because a Docs detail body does not
identify the request's `draft` flag, `hasDraft:true` is ambiguous and is imported
only as a draft, even when its status says `published`. Keep separately fetched
draft bodies in `articleDrafts`; they never enter the public help center.

List counts establish only that the supplied scoped pages reconcile; they do
not prove provider permissions, snapshot consistency, inaccessible history or
site-wide completeness. Real account compatibility remains unverified: tests
use documented, synthetic API bodies only. The existing 1,000-conversation
capacity command now includes Help Scout under the same byte, heap, request,
statement, exact repeat and whole-import undo checks as the other formats.

Migration `121_move_in_categories.sql` narrows category deletion freshness to
articles linked to the affected category or descendants, and removes the
blanket article revision bump for inserting a new category. Existing article
foreign keys cannot refer to a category before it exists. This preserves exact
unrelated article state during reviewed category import and undo; category
updates continue to invalidate their existing publication evidence. Every publication batch rechecks already-created category fields against the
reviewed snapshot inside the transaction, so an intervening native privacy edit
stops remaining articles. Later native articles or child categories referencing
an imported category block whole-import
undo rather than losing those edits.


### Configuration and lifecycle mapping

A Zendesk file can also contain singular `group`, `view`, `schedule`, `trigger` and `automation` records. Include complete original timestamps. Groups import without members or a new default. Views with supported all-conditions import privately for the importing admin. Schedules retain supported weekly intervals, timezone and explicit holiday date ranges but start inactive. Supported triggers and hourly automations become native drafts: review the per-item changes, open their native settings from the import report, preview, then publish explicitly. Unsupported rule conditions or actions set the whole rule aside; a missing condition is never dropped to broaden a rule. Native rules process new journal events, and hourly automations run once per matching ticket episode. SLA policies, forms, memberships, brands and other vendors’ configuration equivalents are still incomplete.

New imports retain their explicit lifecycle and channel. Zendesk/Freshdesk distinguish final Closed from Solved; Help Scout/Intercom use a reopenable Closed state, which maps to native Solved. Historical owners are not granted native access or activated. Existing imported records are not rewritten when this mapping changes: a changed mapping meeting earlier native state remains a review conflict.
