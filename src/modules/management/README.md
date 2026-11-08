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
conversation open fires never read every conversation of a workspace. Migration 312 keeps derived tables,
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

D1's "D1 DB is overloaded" (`platform/d1-overload.ts`) is one rule for every request: a read (GET, HEAD)
that meets it at any D1 call, middleware and authentication included, is dispatched again as a whole after
250 ms, 500 ms and 1 s (the `app.fetch` wrapper, which the Worker entry and the dashboard's server
functions use), then answers 503 with `Retry-After: 3` and a JSON `{error}`; a write answers 503 at once and
is never re-run. The integration API (`/api/v1`) has its own error handler and answers an overload the same
way, in its own error shape (`{error:{code:'unavailable',message}}`). The Worker entry retries the same way for an overload thrown before routing (public site
and help host lookups; server-function paths are reserved so they do no such lookup). The bootstrap server
function carries 503 with its Retry-After; the session check treats 503 as neither signed out nor failed.
The dashboard shows a `role="status"` busy line and reads again after Retry-After (at most 10 s) while the
view is current, keeping what is on screen: the inbox list and its pages, the workspace shell
(`dashboard-state.tsx`), the conversation and its messages; other reads (`ui/native/transport.js`) wait
through a busy read instead of alerting.

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
