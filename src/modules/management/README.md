# Native product management

Hono routes over the edition's canonical D1 identity, conversation and media
records. The management module exports `routes` for `/api/management`,
`dashboardRoutes` for retained `/api/dashboard` contracts, `publicWidget` for
`/api/widget`, and `widgetEvents` for `/api/conversations`.

Project membership is rechecked on every request. `GET /bootstrap?projectId=` answers a
member with that project's workspace plus `sessionProjectId` (the project the session
is bound to, which the dashboard loader aligns with the URL through
`/api/identity/switch-project`) and `isPlatformAdmin`; a project the account does not
belong to and one that does not exist are refused identically with a 403 that says so;
a member whose role is below owner/admin is refused owner/admin actions with a 403 that
names the required role. Global inbox reads aggregate
only the current user's memberships. Platform administration additionally requires
an explicit `platform_admins` row; project ownership does not grant it. Widget
identity verification secrets are projected only in owner/admin widget settings, and
every project gets one at creation (migration `0106` backfills older projects).
`PUT /projects/:id/widget-settings` takes the widget settings object itself as the body
(`{theme, settings, text}`); the dashboard sends only the overrides a person edited and the
widget merges them over its own defaults (`src/modules/widget/js/context/defaults.js`).

Project settings, availability, per-audience default AI selection, AI profiles,
macros, plugins/order, contact details/blocking (a dashboard-created contact needs
a name, email or external ID), memberships/invitations, primary
project preference, profile and administration use typed field allowlists. The
retained dashboard reads original bucket IDs, messages and private notes from
canonical storage and maps original status/assignment/cursor contracts. Widget
collector actions use the customer-context module; selected insight pairs use
conversation admission; generation and operator suggestions use AI support.

Every workspace created by first-owner setup, `POST /projects` or email-verified registration is provisioned in its
creation batch by `provisioning/` (`workspaceDefaults`): one enabled starter assistant whose model follows the
installed provider key (`provisioning/models.ts`, OpenAI's when none), made the default for visitors and signed-in
users; a `starter_ai` settings marker recording what it was created with, so an untouched starter can be told from an
edited one; and, when the installation holds `INBOUND_EMAIL_TOKEN`, a reply-by-email mailbox named after the
workspace on `INBOUND_EMAIL_DOMAIN`, else `in.<website domain>`, else `localhost.test`, suffixed instead of conflicting
and enabled only when the installation sends mail. The workspace sends from the installation sender (`EMAIL_FROM`)
until its own domain is verified; `proposed_sender` (`support@<website domain>`) records the address it moves to.
Settings merge with `json_insert`, so nothing already present is
replaced; after the batch commits the one-time site read is queued. Demo inboxes are never provisioned. A default
assistant takes a new widget conversation only while its provider key is installed (`GET /projects/:id/ai` reports
which secret it needs, never key material), so without a key visitors stay with the team and no reply fails; an
explicit AI request still fails naming the missing secret. `tests/journeys/first-run.mjs` covers this through public routes.

For the messenger, Accept new conversations off takes precedence; otherwise the first active SLA-001 policy
(by position, then id) matching ordinary widget intake (normal priority, this workspace brand, no plan/form/field
context) supplies its active calendar's hours, timezone, holidays and closures, falling back to the widget's own
opening-hours setting when no calendar applies, then applying live presence.
Settings → Availability retains the widget schedule; SLA calendars and policy order are managed under Settings → Workflows.
`live-availability.ts` adds presence-based away for the widget settings door and the away reply
(`away-reply.ts`): while they say open, the team is away when no teammate who may reply is online, unless the visitor
assistant answers (enabled, provider key installed). Presence lives in `operator_presence` (migration 240), written only
by the workspace's operator stream (`conversations/socket.ts` with `collaboration/presence.ts` and `presence-store.ts`):
the dashboard reports its idle time every 20 seconds, a row counts until it expires (90 seconds past the last report, 10
after the last stream closes) and while its member was active within the lead's idle time. Member removal and workspace
deletion clear it; archives never carry it. Leads change it through `PUT /projects/:id/availability`, which records each
change of the setting or idle time in the security log; `GET /projects/:id/presence` lists who is online. The away
notice, header and reply show the lead's Widget settings → Texts → Human response time (default “Responds within
24 hours”) when away without a known reopening time, including presence-based away and acceptance switched off. A
calendar reopening remains the expected time when known. The away reply is the workspace speaking: reports, outcomes and automations never count it as a reply (migration 241).
`tests/journeys/widget.mjs` and `tests/journeys/widget-browser.mjs` cover it.

Pending invitations (`invitations.ts`, `invitation-store.ts`) are the unused invite links for one email in one
workspace, listed on `GET /projects/:projectId/agents` with `invitation_id` (the lower-cased email), `expires_at`
and a per-row `canManage` computed from the caller's role (owners: all; admins: invitations that grant the operator
role; operators: none). `POST .../invitations/:invitationId/link` issues another link (links are stored as hashes and
cannot be shown again), `POST .../resend` emails a fresh link and fails closed with 503 when no email provider is
configured, and `DELETE .../invitations/:invitationId` removes every unused link. Each re-reads the caller's membership of
the path's workspace and refuses what they may not manage. Using one link retires the others issued for the same email
(`identity/accounts.ts`). `tests/journeys/identity.mjs` covers the routes and role refusals on real local D1.

Inbox search (`inbox-search.ts`, both `GET /conversations` doors with `q=` or `search=`, all
history unless `search_scope=view`) finds a conversation by its contact's name, email, provided
name or provided email as a literal, ASCII case-insensitive substring (`%`, `_`, `\`, quotes and
FTS operators are ordinary characters), by its imported `#source` or bare source id, or by
message words through `inbox_message_search` (unquoted words in any order, quoted phrases in
order; migration 311 turns on its secure-delete, so an erased or rewritten message's words leave the index's storage); a result previews its newest matching message. A term longer than 200 characters is a 400
whose message the inbox shows. Terms of three or more characters read the contact trigram index
`inbox_contact_search` (migration 310: an FTS5 index over the `inbox_contact_identity` view, kept by
triggers on contacts, with secure-delete so a changed or erased identity leaves no trigrams), the
source-id index and the message index, so the query reads only candidate conversations; one- and
two-character terms keep the per-conversation substring test. The total comes with the page in
one statement. At a workspace of about 162,000 contacts and conversations (54,000
messages, 6,000 imported tickets) a selective term (an email, a name fragment matching a handful
of contacts, an order number, a source id) reads under 5,000 D1 rows per request, first page,
page-number page or cursor page alike; broad terms (one or two characters, `@`, a mailbox domain,
words in most messages) read more but at most 650,000. When D1 answers "D1 DB is overloaded",
the whole search is dispatched again after 250 ms, 500 ms and 1 s (`platform/d1-overload.ts`,
wrapped around `app.fetch` so the dashboard bootstrap's first page is covered too), then answers
503 with `Retry-After`; the inbox shows a busy line and retries by itself. `tests/journeys/inbox.mjs`
runs it on local D1.

Inbox reads at scale. The unsearched inbox list (both doors, `inbox-list.ts`), its counts
(`inbox-counts.ts`, carried by `/conversations/counts`, the bootstrap and mark-as-read) and the reads a
conversation open fires never read every conversation of a workspace. Migrations 313, 314 and 319 keep derived
tables, filled by the migration and kept by triggers on every table they derive from (messages, notes, merges,
conversations, AI rows and profiles, snooze schedules, imported-message sources, tag links, company links,
custom field values, reads and memberships), so plain-`INSERT` imports, restores and erasure keep them true; an
import or restore rebuilds them (`scripts/installer/inbox-entries-sql.mjs`) and an export rebuilds the subject
index after it (`scripts/installer/search-index-sql.mjs`). `tests/helpers/inbox/derived.mjs` checks each against a
fresh computation from its source rows.
- 313: `inbox_entries` holds one row per inbox conversation (one with a message or a note that is not merged away,
  exactly `inbox-visible.ts`) with the inbox sort key, the flags the views filter on, the contact's company, the
  unread revision, every ticket column a filter, view field or sort names and its tags (`tags_key`, the `tags`
  field of `tickets/filters.ts`), so a list request reads entries alone. `inbox_tallies` counts them by workspace,
  group, assignee and flags; `inbox_field_tallies` also by priority, status category, channel and status;
  `inbox_tag_tallies` by tag as well. `inbox_unread` holds each member's unread entries (a contact message that was
  not imported, above the member's read revision).
  An entry's `ai` and `ai_profile` flags hold only while the conversation is not released to the team (`ai-held.ts`,
  migration 314): in draft or off, a conversation whose visitor has written since its assistant last did
  (`inbox_visitor_waiting`; imported history never counts) is listed and counted as one without an assistant. A waiting
  change or a switch into or out of auto re-derives only the conversations it affects.
- 319: `inbox_unread_tallies` counts each member's unread rows by workspace, group, assignee and flags, so the
  counts' unread number, the bootstrap and mark-as-read sum a handful of rows. `inbox_counts` counts entries by
  family key: every entry, each set of one to four of an entry's tags (entries with at most eight tags; an entry
  with more is listed as a facet and counted one by one), each custom field value (`json_extract(value_json,'$')`,
  the value a filter compares) and field with a non-null value, and the UTC year, month and day of `created_at` and
  `updated_at` (integer times within 2^42 ms of 1970; others are counted one by one through a partial index). Each
  key has slots: the workspace, group and flags with none, one or all five of status category, status, assignee,
  priority and channel, the status category and assignee together (`sa`), or with the status too (`sia`); the status
  and priority slots also keep the status category. A request naming the columns of one slot sums a few rows per key,
  and a range of time buckets seeks the request's status and assignee before the bucket (`inbox_counts_range`). `inbox_facets` holds one row per tag and per custom field value of an entry,
  one per field an entry holds a non-null value of (its value NULL, or `''` for the empty string, so "is set" and
  "is not empty" are one range), carrying the entry's group, assignee, flags, status columns, times, tags and inbox
  order. Facets and entries are indexed in the inbox order and in each custom sort led by `updated_at`,
  `created_at` or priority, each also led by the group (a role that sees one group, or a group condition) or the
  status category (a view of one status in a custom sort), facets also in the inbox order by status category,
  assignee and the views' flags (resolved or not, AI, snoozed). `inbox_subject_search` is a trigram index
  (case-sensitive, over SQLite's `lower()`) of the entries' subjects and workspaces, over a view carrying every entry
  column, so a subject term's matches carry every column a condition or sort reads. Week indexes hold an order's
  week and then a time, so a time bound's page reads only entries inside the bound. Block indexes hold each 30-day
  block of `created_at` or `updated_at` (alone, or within a status category) in conversation id order.
Totals and pages (`inbox-shapes.ts`, with `inbox-families.ts`, `inbox-weeks.ts` and `inbox-order.ts`) for pages 1 to
10 of a request whose conditions are a subject term of three or more characters, tags, one custom field or one
time bound, alone or with conditions on status, status category, priority, channel, assignee and group:
- the role scope is read once per request (`resolvedInboxAccess`, the sets of `inboxAccess`) and bound as lists;
- a subject term reads the trigram index's matches in the request's workspaces, one row each, with every other
  condition and the sort keys read from the matches; the page is ordered as ORDER BY would order it
  (`inbox-order.ts`: NULL, numbers, text by code point, blobs) without reading the rows again;
- tags: any, all or none of up to four distinct tags (any combination of tags conditions) is a signed sum of the
  counts of entries holding each subset of them (the matches whose tags among them are exactly X, summed over the X
  the conditions admit); a custom field condition (`eq`, `in`, `ne`, `not_in`, `is_empty`, `is_not_empty`, `eq`/`ne`
  null; a number compares `CAST(... AS REAL)` for `eq`/`ne` as the filter does) is a sum, or a difference, of value
  and non-null counts; a time bound sums whole years, months and days on its side and counts its own day's entries;
- the page takes the cheapest of: walking a facet in the page's order (pinned to a group, status category, assignee
  or the view's flags when the request pins one), merging the first matches of each tag's (or each listed value's)
  facet, walking the inbox order or the sort's own index (pinned likewise), walking a time bound's order a week at a
  time, or reading once, in any order, every candidate of a facet, of every part of an any-of condition, of a time
  range, or of the rows (of a facet, of every part, or of every entry) holding one pinned status category (or a list
  of them), assignee or group, then ordering it. A read whole costs its exact size; a walk's cost is estimated as the
  matches' share of the rows it walks. A page past the total reads nothing;
- a sort an imported view carries (by status, status category or priority) counts the request's matches in each group
  of the sort's key (each count also read by that column, `inbox-sort-groups.ts`), so a walk of the sort's own index
  seeks to the page's first group and is costed by the groups it crosses (a view of unsolved tickets sorted by status
  no longer walks every closed ticket first); a page sorted by status with a time bound may instead read the statuses
  holding it, inside the bound, whole. A time bound's counts are read by group only where a status is involved;
- a page sorted by conversation id merges the 30-day blocks (of the time bound, or every creation block; each status
  category's apart when the request names some) walked in id order (`inbox-merge.ts`): every block's first match,
  then the block with the earliest frontier reads what is missing and the others their share once a page's worth is
  read, so whether ids follow creation or not, it reads about the page's matches. Conversation ids may follow
  creation, so a walk in id order (alone, or within a status or priority) of a bound before a moment, descending, or
  after one, ascending, is costed as if every non-matching row came first.
Two families, or two conditions of one, read every candidate of the smallest facet or time range once. Pages beyond
10, subject terms of one or two characters (and a NUL), a multiselect field, `contains`, `gt`/`lt` on a custom
field, a condition on another ticket column, a company and the unread view keep 313's reads (and read no more than
313 did). A subject term matching more than about 3,000 conversations in the request's workspaces reads one row
per match (still fewer than 313, which read every entry). The counts and facets leave out a custom field value
that is not valid JSON (the filter's own lookup raises on one).
Membership, deleted workspaces and the role's ticket scope (`access/ticket-scope.ts`) apply as before. Hidden widget
drafts are never read.
A page's 30 conversations are hydrated (`dashboard-data.ts`, `dashboard-messages.ts`, `tickets/presentation.ts`)
through the values the page's rows already hold (their contact, assignee, last message, status, group and workspace,
one `json_each` row and the related row each), never by reading the conversations again, and each distinct tag and
custom field of the page is read once rather than once per link or value; the list's tags are read once (the ticket
presentation's own tag read is skipped where the page's replace them). A page of imported tickets with many tags
and field values hydrates in about 1,300 to 1,500 rows (before: about 2,500 to 3,500).
Known limit. A probe of 10,703 pages on a local workspace of a large imported workspace's shape took 33 view bases
(subject, custom field, tag and time-bound shapes, alone and with conditions), crossed with six statuses and
assignees and with the inbox order plus ten import sorts, at pages 1, 2, 3, 10 and the last. 353 of those pages
read more than 5,000 D1 rows, at most 18,678, and every one of them read fewer rows than before this migration; the
rest read at most 5,000. Most of the 353 are sorted by id, priority or status. The cause: the block merge's statements
(`inbox-merge.ts`, over the block indexes `inbox_entries_created_block` and `inbox_entries_updated_block`) read every
entry of the bound they are given instead of stopping at their LIMIT. Until they stop at it, a page sorted by id,
priority or status on a large view can read more than 5,000 rows.
The counts, the bootstrap with counts and mark-as-read read 82 to 237 rows (313: 6,221 to 10,644, one row per unread
conversation). Migration 319 fills a workspace of that shape in 10.7 to 11.9 s (`wrangler d1 migrations apply`,
about 2 s of it Wrangler's start).
Writes. Every count row a trigger moves is found by its whole key (its keys and slots are joined before
`inbox_counts`, and a year's bucket carries no type affinity, so `inbox_counts_key` seeks every column): a reply's
single statement reads 1,168 rows (313: 6; before this, about 1.9 million at this size), and a ticket change reads
1,000 to 6,000 rows more than 313 on top of the route's own 48,000 to 309,000. Rows written per change grow with the
derived rows each entry keeps (a facet row per tag and field value, each with its indexes, and nine slots per count
key): a reply 398 (313: 53), a status change 1,024 to 1,247 (153 to 164), an assignee 1,576 to 1,603 (216 to 242), a
group 939 to 1,031 (140 to 154), a field value 448 to 563 (83), a subject edit 358 to 473 (82), a tag added 127 to 260
(65), measured through the routes (rows written include index rows).

Companies at scale. The company page (`GET /projects/:id/companies/:companyId`, `customers/read.ts`) still
answers every member and every ticket, unpaged and exactly as before, but reads in proportion to the company,
never the workspace: the company is looked up first, so a merged-away or unknown company's 404 reads nothing
more (about 10 rows); each membership is read once with its contact through `contact_companies_company` (the
members are the writable contacts, the member count is every membership, and a ticket is listed when its
contact is, `contactAvailableSql()`'s predicate on that same row); tickets are each member's conversations
through `conversations_contact_history`, sorted after, under the role's ticket scope evaluated once as sets
(`inboxAccess`); history comes through both of its company indexes; undo availability reuses this company's
state and reads only the other companies its entries changed. Its ceiling is 5,000 + 1.5 x (members +
tickets), about 3 rows per member and 4 per ticket: at a large imported workspace's shape (162,000 contacts and
conversations) a company of 946 members and 946 tickets reads 6,651 (6,231 for a teammate scoped to one group,
who sees 473 of them), a small company 50 to 90 and a company with no members 17, and 80,000 more hidden widget
drafts read the same rows. Its other reads stay as they were, under 5,000 at that shape and unchanged by the
drafts: the list 3,118 (it counts each company's members, two rows per membership), `?view=names` 96, ticket
settings and request forms with an account field (one row per company) about 100 to 120, a merge preview
2,235. Over the target and left as they were: linking, moving or unlinking a member of that 946-member company
reads about 11,700 (the change claims and rewrites the company's whole membership), and knowledge
entitlements read about 325,000 for their contact account pickers (their company pickers read under 1,000).
While D1 is overloaded the company list and an opened company keep what they show, say the workspace is busy
(`role="status"`) and read again after Retry-After; any other failure stays an alert.

Cutover. Settings > Cutover reads one request, `GET /api/move-in/projects/:projectId/cutover`
(`move-in/cutover/counts.ts`), whose answer is what the counts were when each walked the workspace's
conversations: the legacy journal has no workspace column, and a widget arrival differs from a hidden draft
only by its messages (926,699 rows at a large imported workspace's shape). Migration 318 keeps each counted
set, filled by the migration and kept by triggers on every table it derives from (conversations, messages,
`inbound_emails`, `move_in_conversations`, `legacy_import_rows`, `ticket_followups`), so plain-`INSERT`
imports, an undone import and a restore keep it true: `cutover_zendesk_conversations` (a Zendesk import still
in its workspace), `cutover_legacy_conversations` (a workspace conversation and each run whose journal maps it,
counted per workspace and run in `cutover_legacy_runs`), `cutover_widget_arrivals` (a widget conversation a
visitor wrote in, with its creation time) and `cutover_tallies` (per workspace, the three of all time). The
Zendesk and legacy counts are a tally; the last sweep reads the runs that touched the workspace and their state,
live (a chunk run sweeps when its package run completes); widget arrivals since a moment are one index range,
one row per arrival counted (with no moment, the tally); mail arrivals were already a covering-index range.
At that shape (162,000 conversations, 144,445 journaled, 5,997 imported from Zendesk) the read takes 977 rows,
960 of them the arrivals since the last sweep, and 80,000 more hidden drafts add none. Stated ceiling: 5,000 +
1 row per widget or mail arrival since the latest pull, sweep or step. Recording a step reloads through the same
read. A restore rebuilds the sets (`scripts/installer/cutover-bounds-sql.mjs`).

Contacts at scale. The contacts list (`GET /projects/:id/contacts`, both doors, `contact-list.ts`), which the
contacts page, its first page preloaded by the workspace navigation read, the ticket panel's and the company
member pickers and the identity link search ask, answers every request exactly as before and never reads every
contact of a workspace. Migration 318 adds, all filled by the migration, kept by triggers on contacts (so
plain-`INSERT` imports, the widget's `json_patch`, edits, soft deletes, erasure and plain `DELETE` keep them true)
and rebuilt from the restored rows after every import:
- an index per sort and direction in the list's own order (the sort key verbatim, then id ascending in either
  direction; `contacts_name_order` in 313 holds name ascending), and the same orders over only the contacts a term
  can match (`contacts_searchable_*`: live, with a name, email, provided name or provided email; hidden widget
  drafts have none);
- `contact_tallies`, each workspace's live contacts (`scripts/installer/contact-bounds-sql.mjs` rebuilds it);
- `contact_search`, an FTS5 trigram index like 310's over the same four values through `lower()`, holding each
  searchable live contact with its workspace in a scope column, so a phrase scoped to the workspace is a term's
  matches there, one row each. Each entry also carries the contact's id and its four sort keys (unindexed columns
  read through the `contact_search_identity` view, at no extra row), and each sort's band text, indexed: a text
  key's whole lowercased value through `lower()`, or a last seen's first ten hex digits (2^24 ms, about 4.7 hours),
  so a band, a prefix of that text, is one stretch of its order (`derivedSearchIndexes` and the portability
  policy's derived tables rebuild it).
A total without a term is the tally (one row). A page walks its order's index and stops after its rows
(`contact-walk.ts`); Next and Previous ask for the page after the last contact shown (`after=<id>`) or before the
first (`before=<id>`), with `page` the number it shows, so any page reads about its own rows: the rows tied with
the boundary on the key past its id, then the rows past its key, each from its own index position. A boundary that
is gone from the workspace, and a page before the first, answer the first page. A term of three or more characters
reads its matches with their keys from `contact_search` (`contact-matches.ts`), one row each, and orders them here
exactly as SQLite orders the keys (`contact-key-order.ts`: NOCASE text, integer last seen, then BINARY ids). With
a total it reads them all, so its cost is the total plus the page, wherever the matches fall in the order. Without
one a page seeks its rows past its boundary (`contact-seek.ts`, bands in `contact-bands.ts`): a walk of the
searchable contacts finds them where they are dense, starting at twice the rows the page needs and going on while
the matches it meets say the rest is within reach; where they are sparse, the term's bands past the walk take over.
A band is a stretch of the order whose order text (a text key through `lower()`, or a last seen's leading hex
digits) starts alike: for a text key at three characters, then six, nine and so on; for a last seen at eight hex
digits, then ten. Each band is found with one index step and
asked of `contact_search` for a match, so a stretch without matches costs about two rows a band whatever its
contacts; a band holding up to 150 matches is read whole with their keys; one holding more is walked while it is
dense and otherwise split into its finer bands. A seek may read 2,000 rows; past that a term with as many matches as
the rest of 4,900 leaves reads them whole, and a broader one seeks on. `instr` over `lower()` decides
each match exactly as the former `LIKE` did, without D1's 50-byte `LIKE` pattern limit (a term of 49 or more
bytes answered 500; it now answers its matches). One- and two-character terms keep the substring test, and their
count and page read the searchable contacts only. At a large imported workspace's shape (161,919 live contacts,
53,489 of them searchable; measured on local D1, every answer equal to the former list's) every first, Next and
Previous page of every sort and direction reads under 120 rows and the plain list 61; a term with a total reads
its matches plus about 160 (a mailbox domain matching 19,422 contacts 19,583, within 5,000 + 1.5 x the total);
without a total, 21 terms from one match to 40,588 (mailbox domains, names, `com`) on every sort and direction read
at most 3,800 on the first, a Next and a Previous page (half of them under 860), and every page that Next and
Previous reach through 17 such lists end to end (3,946 pages, among them the ticket picker's) at most 4,150; a two-character term 54,000 to 68,000 with its count (under
the 328,000 it read before); 80,000 more widget drafts read the same rows. Over the target, measured at the same
shape: a two-character term's pages without a total walk up to 12,300 where its matches are sparse (it read 166,000
before); a term whose matches are sparse inside one band that cannot split (one key value; most contacts tie on
last seen 0 and an empty country) reads that band's matches. A page by number deep in
the list steps over every earlier row with `OFFSET` (page 1,620 of 3,239 about 81,000), which the dashboard never
asks.

D1's "D1 DB is overloaded" (`platform/d1-overload.ts`) is one rule for every request: a read (GET, HEAD)
that meets it at any D1 call, middleware and authentication included, is dispatched again as a whole after
250 ms, 500 ms and 1 s (the `app.fetch` wrapper, which the Worker entry and the dashboard's server
functions use), then answers 503 with `Retry-After: 3` and a JSON `{error}`; a write answers 503 at once and
is never re-run. Browsers get a page instead of the JSON: a page load (a GET or HEAD that accepts `text/html`,
other than a script's fetch) gets the busy page, which loads itself again after Retry-After, and a native form
post gets its form back to send again (see `modules/public-site/README.md`); every other caller keeps the JSON. The integration API (`/api/v1`) has its own error handler and answers an overload the same
way, in its own error shape (`{error:{code:'unavailable',message}}`). The Worker entry retries the same way for an overload thrown before routing (public site
and help host lookups; server-function paths are reserved so they do no such lookup). The bootstrap server
function carries 503 with its Retry-After; the session check treats 503 as neither signed out nor failed.
The dashboard shows a `role="status"` busy line and reads again after Retry-After (at most 10 s) while the
view is current, keeping what is on screen: the inbox list and its pages, the workspace shell
(`dashboard-state.tsx`), the conversation and its messages; other reads (`ui/native/transport.js`) wait
through a busy read instead of alerting. A read that got no complete answer (a dropped connection or a
restarting runtime: `fetch()` rejecting, or the body cut before its end, `ui/dashboard/utils/busy.js`) is busy
too and is read again the same way; the bootstrap's streamed nested reads settle busy when their answer is cut;
a write is never repeated. A dashboard document cut mid-stream recovers by itself (`platform/document-recovery.ts`):
the Worker sends it uncompressed with a small recovery script first and an end marker last, and a document that
stops arriving shows the busy look, waits for `/health` and reloads once.

Because a read can be dispatched more than once, and a 503 is asked again, a read's side effects follow
`platform/read-effects.ts`. A record a read makes (the help center's view and search events and read receipt,
the public search event, settings, export, step-up refusal and `knowledge.read` audit rows) is held on the
request and written by the outermost middleware (`app.ts`, the public site and the help host) as the
dispatch's last D1 statement, all in one atomic batch: an answer of 503 records nothing, and an overload of that
batch re-dispatches the read. Work that cannot wait for the answer runs once per request (`oncePerRequest`): the
OAuth callbacks' state consumption and provider exchange (Zendesk, GitHub, mailbox), the scoped API's rate
counter and authorization receipt, the mobile ticket frontier and the knowledge search budget. The help and
portal sign-in links are spent by their request's last D1 statement, their audit row in the same transaction.
`tests/helpers/public-site/overload.mjs` proves the view, search and sign-in links at every D1 position.

Owners and admins can permanently erase a contact's personal data
(`contact-erasure.ts`, `contact-erasure/`): R2 objects are staged in
`contact_erasure_objects` and deleted first, including the legacy files of the contact's
messages, delegations and internal notes and their variants, found through the legacy journal
(`contact-erasure/archive.ts`) and counted in `attachments`; then the legacy journal's copies of
the contact's rows are cleared in bounded D1 calls (rowid slices, then the rows the contact's
legacy sets are read from, by id), and one D1 batch removes or redacts
the contact's identity, sessions, message content, attachments, customer context,
notes, AI assist options and output, imported bucket summaries, delegated-work
output and delivery addresses,
and records a non-identifying `contact_erasures` audit row. Message identity,
revision and frontier are kept (`messages.erased_at`); a client-supplied
`local_id` becomes `erased:<message id>`, a prefix admission reserves, while the
server-minted `email:<hash>` and `generation:<id>` ids later reads depend on stay
(a caller-chosen generation id must be a UUID, `ai-support/generation-id.ts`). Repeating an erasure is safe
and completes an interrupted one. `tests/journeys/erasure.mjs` proves it on real
local D1/R2; docs/PRIVACY.md describes the operator-facing behaviour.
The same batch redacts `inbound_emails.evidence_json` (migration 0104) to the
classifier's `reasons` (`contact-erasure/inbound-evidence.ts`). Request counters
(`abuse_counters`) are not erased: they hold only counts under SHA-256 keys and
expire within a day.

Migrations 0070/0071 own management records; 0103 owns contact erasure. Related core and AI migrations remain
necessary: management is an integrated capability, not a replacement database.
`tests/journeys/inbox.mjs` uses real local D1/R2, covering tenant and admin boundaries,
secret projection, original inbox filters/bucket history, notes/participants,
contact collection, missing provider configuration and email ingress identity.
Browser behavior is verified by the dashboard/widget integration lane separately.
