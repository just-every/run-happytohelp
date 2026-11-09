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
conversation open fires never read every conversation of a workspace. Migration 313 keeps derived tables,
filled by the migration and kept by triggers on every table they derive from (messages, notes, merges,
conversations, AI rows and profiles, snooze schedules, imported-message sources, tag links, company links,
reads and memberships), so plain-`INSERT` imports, restores and erasure keep them true. `inbox_entries`
holds one row per inbox conversation (one with a message or a note that is not merged away, exactly
`inbox-visible.ts`) with the inbox sort key, the flags the views filter on, the contact's company, the
unread revision, every ticket column a filter, view field or sort names and its tags (`tags_key`, the
`tags` field of `tickets/filters.ts`), so a list request reads entries alone. `inbox_tallies` counts those
entries by workspace, group, assignee and flags; `inbox_field_tallies` also by priority, status category,
channel and status; `inbox_tag_tallies` by tag as well. `inbox_unread` holds each member's unread entries
(a contact message that was not imported, above the member's read revision) with their flags and sort key.
An entry's `ai` and `ai_profile` flags hold only while the conversation is not released to the team
(`ai-held.ts`, migration 314): in draft or off, a conversation whose visitor has written since its assistant
last did (`inbox_visitor_waiting`; imported history never counts) is listed and counted as one without an
assistant. A waiting change or a switch into or out of auto re-derives only the conversations it affects.
Totals (`inbox-conditions.ts` classifies a request's conditions):
- a standard view, the counts other than unread, and any view, saved view or structured `filters` whose
  conditions name only status, status category, priority, channel, assignee and group, alone or with one
  tags condition (any of its tags, or none of them; that is what a Zendesk view import writes), are tally
  sums. A tags condition naming several tags adds each tag's tally and subtracts, through the links of all
  but the largest tag, the matches an earlier tag already counted (about 3 rows per such link);
- otherwise the total counts the matches within the smallest candidate set an index gives: a company's
  entries, the links of a tags condition, or the entries a ticket column's own index holds for an
  equality, list or range condition (id, requester, submitter, subject, brand, created, updated, version,
  status, group, assignee, priority, status category, channel, submitter type), one row per candidate; with
  no such condition, every inbox entry of the workspace (one row each);
- a cursor page's tally total is the tally less the matching entries before the cursor.
A page walks an entry index that leads with the workspace and what the request pins (the view's flags, the
assignee, a company, or a single status category, priority or channel) in the inbox order, or the member's
unread rows, and stops after its rows; a custom sort led by a ticket column or tags walks that column's own
index (sorting only within its equal values). It sorts the candidate set instead when the walk would read
more. A tags condition's links and a time condition before a moment (its matches lie at the far end of the
inbox order, which follows activity) are read once, in order, for the total and the page together. A page
past the total reads nothing.
Membership, deleted workspaces and the role's ticket scope (`access/ticket-scope.ts`) are evaluated once
per request as sets (`inbox-entries.ts`). Hidden widget drafts are never read. At a large workspace's shape
(about 162,000 conversations, 18,000 in the inbox, 54,000 messages) a standard view, filter control (teammate,
tag, a company of 2,700 contacts), `status=`/`priority=`/`channel=`, cursor page or page by number reads
under 5,000 D1 rows (about 1,500 to 3,400, most of it the page's hydration). Measured on a local workspace
of that shape (18,163 inbox entries, owner, workspace door), saved views and structured `filters`/`sort`:
under the target, one tag (999 matches) 3,783, a tag with priorities 3,167, none of a tag 2,622, a tag
with a status 2,815, a status 2,664, a requester, subject or ids about 220 to 330, created after a moment
3,756; within the ceiling (5,000 + 1.5 x the total), a brand 5,668 (3,000 matches), priority sorted by
tags 5,536 (830), two tags 6,616 (5,178), every submitter type but one 20,558 (17,247), updated before a
moment 5,962 (1,773), updated after one 11,223 (8,375), a sort led by a custom field 6,002 (830). Each read
of a conversation open reads under 2,000; the inbox's company filter reads
`GET /projects/:id/companies?view=names`, one row per company (14 rows for one company), where the full list
counts each company's members, two rows per linked contact (362 for one company of 180 contacts; 1,904 to
7,307 at that shape). Stated ceilings (D1 counts one row per record counted): the
unread view reads one row per unread conversation (5,000 + 1.5 x its total; about 7,300 for 5,151 unread),
and the counts, the bootstrap with counts and mark-as-read read up to 5,000 + 1.5 x the counts' sum (about
5,500) and the workspace navigation read (document or server function) 12,000 + 1.5 x (the counts plus the
shown view's total) (about 7,900), because the unread count is per member (a per-member tally would bring
them under the target). Over the ceiling, measured at the same shape and never growing with widget drafts
(80,000 more read the same rows), each because no index or tally narrows it:
- a condition no index narrows (text `contains`, `ne`/`not_in` on a ticket column, `is_empty`/`is_not_empty`,
  `eq` null, a custom field) reads every inbox entry for its total, one row each (two for a custom field,
  whose value is looked up per entry), then walks the order for its page: subject contains 18,181 rows at
  total 0 and 27,541 at 1,166; brand empty, submitter null and submitter type ne about 18,200 at total 0;
  none of a tag with subject contains 25,303 (7,214); a custom field 34,072 (7,200); tags empty 20,413 and
  not empty 20,795 stay within their ceilings. A trigram index over the subject (as `inbox_contact_search`
  does for contacts) and an entry column per custom field with its own index would bound them;
- a tags condition with a condition the tallies do not count, or two tags conditions, reads the links of
  its tags (about 3 rows per link) and its matches in order: a tag with a brand 6,050 (176 matches), two
  tags both present 7,715 (261), four tags 21,889 (8,678); a tags condition naming several tags subtracts
  through the links of all but its largest tag. A role that sees few groups reads every link of the tag
  (links carry no group): VIP or Billing for a teammate scoped to one group, page 3, 6,962 (473 matches).
  A tally of tag pairs or a per-tag entry table would bound them;
- a time condition before a moment reads its candidates and sorts its matches, about 2 rows per match, so
  it passes the ceiling above about 5,000 matches: created before a moment 9,620 (3,548 matches, within),
  35,052 (15,968, over). Its matches lie at the far end of the inbox order, so a walk would read the whole
  order instead; an inbox-order index led by a time bucket would bound it.

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
only by its messages (926,699 rows at a large imported workspace's shape). Migration 317 keeps each counted
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
contact of a workspace. Migration 317 adds, all filled by the migration, kept by triggers on contacts (so
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
